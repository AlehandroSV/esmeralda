import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { parseSchemaFile } from "../core/schema-parser.js";
import { saveState } from "../core/schema-state.js";
import { detectDriver, getDialect, type SQLDialect, type DriverKind } from "../core/sql-dialect.js";
import { LuaBridge, LUA_JSON_ENCODER } from "../core/lua-bridge.js";

/* ─── Interfaces ────────────────────────────────────────────── */

interface PullOptions {
  table?: string;
  database?: string;
  full?: boolean;
  relations?: boolean;
  scopes?: boolean;
}

interface NormalizedColumn {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
  column_default: string | null;
}

interface NormalizedForeignKey {
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

interface NormalizedUniqueConstraint {
  constraint_name: string;
  column_name: string;
}

interface TableMetadata {
  columns: NormalizedColumn[];
  foreignKeys: NormalizedForeignKey[];
  uniqueConstraints: NormalizedUniqueConstraint[];
  hasDeletedAt: boolean;
  hasCreatedAt: boolean;
  hasUpdatedAt: boolean;
}

/* ─── Command registration ──────────────────────────────────── */

export function registerDbPull(db: Command): void {
  db
    .command("pull")
    .description("Introspect database and generate entity files")
    .option("-t, --table <name>", "Introspect specific table only")
    .option("-d, --database <name>", "Database to introspect")
    .option("--full", "Generate all: relations, validations, scopes")
    .option("--relations", "Generate relations only")
    .option("--scopes", "Generate scopes and soft delete")
    .action(async (options: PullOptions) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        const driverKind = detectDriver(projectRoot);
        const dialect = getDialect(driverKind);
        Logger.info(`Introspecting database (${driverKind})...`);

        const configPath = path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\");

        // Get table list using dialect-specific query
        const listScript = `
          ${LUA_JSON_ENCODER}
          local jade = require("jade")
          local config = dofile("${configPath}")
          jade.configure(config)
          local tables = jade.driver():execute([[${dialect.tableListQuery()}]])
          local result = {}
          for _, row in ipairs(tables) do
            ${tableListExtractor(driverKind)}
          end
          print(_json_encode(result))
        `;

        const bridge = new LuaBridge();
        const tables = await bridge.executeSafeJson(listScript);

        Logger.info(`Found ${tables.length} tables`);

        // Generate entity files for each table
        const schemaDir = path.join(projectRoot, "schema");
        fs.mkdirSync(schemaDir, { recursive: true });

        // Collect all metadata for cross-table relation inference
        const allMetadata: Record<string, TableMetadata> = {};

        for (const tableName of tables) {
          if (options.table && tableName !== options.table) continue;
          allMetadata[tableName] = await introspectTable(bridge, configPath, dialect, driverKind, tableName);
        }

        // Generate entity files
        for (const tableName of Object.keys(allMetadata)) {
          Logger.info(`  Generating entity: ${tableName}`);
          const meta = allMetadata[tableName];
          const entityName = toPascalCase(tableName);
          const luaContent = generateEntityLua(entityName, tableName, meta, allMetadata, options);

          const filePath = path.join(schemaDir, `${tableName}.lua`);
          fs.writeFileSync(filePath, luaContent, "utf-8");
        }

        // Save schema state as baseline for future generate commands
        const generatedFiles = Object.keys(allMetadata).map((t) => `${t}.lua`);

        const entities = [];
        for (const file of generatedFiles) {
          const content = fs.readFileSync(path.join(schemaDir, file), "utf-8");
          entities.push(...parseSchemaFile(content));
        }

        if (entities.length > 0) {
          saveState(projectRoot, entities);
          Logger.info(`  Saved schema state (.esmeralda-state.json) with ${entities.length} entities`);
        }

        Logger.success("Entity files generated in schema/");
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          Logger.error("Failed to introspect database:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}

/* ─── Introspection ─────────────────────────────────────────── */

async function introspectTable(
  bridge: LuaBridge,
  configPath: string,
  dialect: SQLDialect,
  driverKind: DriverKind,
  tableName: string,
): Promise<TableMetadata> {
  // Get columns
  const columnQuery = dialect.columnListQuery(tableName);
  const columnScript = `
    ${LUA_JSON_ENCODER}
    local jade = require("jade")
    local config = dofile("${configPath}")
    jade.configure(config)
    local cols = jade.driver():execute([[${columnQuery}]])
    print(_json_encode(cols))
  `;
  const rawColumns = await bridge.executeSafeJson(columnScript);
  const columns = normalizeColumns(rawColumns, driverKind);

  // Get foreign keys
  let foreignKeys: NormalizedForeignKey[] = [];
  try {
    const fkQuery = dialect.foreignKeyQuery(tableName);
    const fkScript = `
      ${LUA_JSON_ENCODER}
      local jade = require("jade")
      local config = dofile("${configPath}")
      jade.configure(config)
      local fks = jade.driver():execute([[${fkQuery}]])
      print(_json_encode(fks))
    `;
    foreignKeys = normalizeForeignKeys(await bridge.executeSafeJson(fkScript), driverKind);
  } catch {
    // Foreign keys query might fail, continue without them
  }

  // Get unique constraints
  let uniqueConstraints: NormalizedUniqueConstraint[] = [];
  try {
    const uqQuery = dialect.uniqueConstraintsQuery(tableName);
    const uqScript = `
      ${LUA_JSON_ENCODER}
      local jade = require("jade")
      local config = dofile("${configPath}")
      jade.configure(config)
      local uqs = jade.driver():execute([[${uqQuery}]])
      print(_json_encode(uqs))
    `;
    uniqueConstraints = normalizeUniqueConstraints(await bridge.executeSafeJson(uqScript), driverKind);
  } catch {
    // Unique constraints query might fail
  }

  // Detect patterns
  const columnNames = columns.map((c) => c.column_name);
  const hasDeletedAt = columnNames.includes("deleted_at");
  const hasCreatedAt = columnNames.includes("created_at");
  const hasUpdatedAt = columnNames.includes("updated_at");

  return { columns, foreignKeys, uniqueConstraints, hasDeletedAt, hasCreatedAt, hasUpdatedAt };
}

/* ─── Normalization helpers ─────────────────────────────────── */

function tableListExtractor(driverKind: DriverKind): string {
  if (driverKind === "sqlite") {
    return "table.insert(result, row.table_name or row.name)";
  }
  return "table.insert(result, row.table_name)";
}

function normalizeColumns(raw: any[], driverKind: DriverKind): NormalizedColumn[] {
  if (driverKind === "sqlite") {
    return raw.map((c: any) => ({
      column_name: c.name,
      data_type: normalizeSqliteType(c.type),
      character_maximum_length: extractLength(c.type),
      is_nullable: c.notnull === 1 ? "NO" : "YES",
      column_default: c.dflt_value,
    }));
  }
  return raw;
}

function normalizeSqliteType(typeStr: string): string {
  if (!typeStr) return "text";
  const upper = typeStr.toUpperCase();
  if (upper.includes("INT")) return "integer";
  if (upper.includes("CHAR") || upper.includes("CLOB") || upper.includes("TEXT")) return "text";
  if (upper.includes("BLOB")) return "blob";
  if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB")) return "real";
  return "text";
}

function extractLength(typeStr: string): number | null {
  if (!typeStr) return null;
  const match = typeStr.match(/\((\d+)\)/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeForeignKeys(raw: any[], driverKind: DriverKind): NormalizedForeignKey[] {
  if (driverKind === "sqlite") {
    return raw.map((fk: any) => ({
      column_name: fk.from,
      foreign_table_name: fk.table,
      foreign_column_name: fk.to,
    }));
  }
  return raw;
}

function normalizeUniqueConstraints(raw: any[], driverKind: DriverKind): NormalizedUniqueConstraint[] {
  if (driverKind === "sqlite") {
    // SQLite PRAGMA index_list returns: seq, name, unique, origin, partial
    // Filter unique indexes, then get column info via index_info
    return raw
      .filter((idx: any) => idx.unique === 1)
      .map((idx: any) => ({
        constraint_name: idx.name,
        column_name: idx.name, // Will be resolved separately if needed
      }));
  }
  return raw;
}

/* ─── Helpers ───────────────────────────────────────────────── */

function toPascalCase(str: string): string {
  return str
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function singularize(str: string): string {
  if (str.endsWith("ies")) return str.slice(0, -3) + "y";
  if (str.endsWith("ses") || str.endsWith("xes") || str.endsWith("zes"))
    return str.slice(0, -2);
  if (str.endsWith("us") || str.endsWith("ss"))
    return str;
  if (str.endsWith("s"))
    return str.slice(0, -1);
  return str;
}

function mapColumnType(col: NormalizedColumn): string {
  const typeMap: Record<string, string> = {
    integer: "Integer",
    bigint: "BigInt",
    smallint: "Integer",
    serial: "Integer",
    bigserial: "BigInt",
    numeric: "Decimal",
    decimal: "Decimal",
    real: "Float",
    "double precision": "Float",
    varchar: "String",
    "character varying": "String",
    text: "Text",
    char: "String",
    boolean: "Boolean",
    date: "Date",
    "timestamp with time zone": "Timestamp",
    "timestamp without time zone": "Timestamp",
    timestamp: "Timestamp",
    datetime: "Timestamp",
    uuid: "UUID",
    json: "JSON",
    jsonb: "JSON",
    enum: "Enum",
    tinyint: "Boolean",
    blob: "Text",
  };
  return typeMap[col.data_type] || "Text";
}

function isUniqueColumn(col: NormalizedColumn, uniqueConstraints: NormalizedUniqueConstraint[]): boolean {
  return uniqueConstraints.some((uq) => uq.column_name === col.column_name);
}

/* ─── Entity generation ─────────────────────────────────────── */

function generateEntityLua(
  entityName: string,
  tableName: string,
  meta: TableMetadata,
  allMetadata: Record<string, TableMetadata>,
  options: PullOptions,
): string {
  const lines: string[] = [];
  const generateRelations = options.full || options.relations;
  const generateScopes = options.full || options.scopes;

  // Header comment with metadata
  lines.push(`-- Entity: ${entityName}`);
  lines.push(`-- Table: ${tableName}`);
  lines.push(`-- Columns: ${meta.columns.length} | Indexes: ${meta.uniqueConstraints.length} | FKs: ${meta.foreignKeys.length}`);
  lines.push(`-- Generated by esmeralda db pull`);
  lines.push(``);
  lines.push(`local Jade = require("jade")`);
  lines.push(``);

  // Entity definition
  lines.push(`return Jade.Entity("${tableName}", {`);

  // Primary key section
  const pkCols = meta.columns.filter(
    (c) =>
      c.column_default?.includes("nextval") ||
      c.column_name === "id" ||
      (c.data_type === "varchar" && c.character_maximum_length === 25 && /^(id|cuid)$/.test(c.column_name)),
  );

  for (const col of pkCols) {
    lines.push(generateColumnDef(col, meta.uniqueConstraints, true));
  }

  // Regular columns
  const regularCols = meta.columns.filter((c) => !pkCols.includes(c));
  for (const col of regularCols) {
    lines.push(generateColumnDef(col, meta.uniqueConstraints, false));
  }

  lines.push(`})`);

  // Relations section
  if (generateRelations && meta.foreignKeys.length > 0) {
    lines.push(``);
    lines.push(`-- Relations`);

    for (const fk of meta.foreignKeys) {
      const foreignEntity = toPascalCase(fk.foreign_table_name);
      const foreignEntitySingular = singularize(foreignEntity);
      lines.push(`${entityName}:belongsTo(${foreignEntitySingular}, { foreign_key = "${fk.column_name}" })`);
    }

    // Infer hasMany: find tables that have FK pointing to this table
    for (const [otherTable, otherMeta] of Object.entries(allMetadata)) {
      if (otherTable === tableName) continue;
      for (const fk of otherMeta.foreignKeys) {
        if (fk.foreign_table_name === tableName) {
          const otherEntity = toPascalCase(otherTable);
          lines.push(`${entityName}:hasMany(${otherEntity}, { foreign_key = "${fk.column_name}" })`);
        }
      }
    }

    // Detect pivot tables (hasAndBelongsToMany)
    if (meta.foreignKeys.length === 2) {
      const [fk1, fk2] = meta.foreignKeys;
      const otherTable = fk1.foreign_table_name === tableName ? fk2.foreign_table_name : fk1.foreign_table_name;
      const otherEntity = toPascalCase(otherTable);
      lines.push(`-- Pivot table detected: ${tableName}`);
      lines.push(`-- ${entityName}:hasAndBelongsToMany(${otherEntity}, { pivot = "${tableName}" })`);
    }
  }

  // Validations section
  if (options.full) {
    const validations = generateValidations(meta);
    if (validations.length > 0) {
      lines.push(``);
      lines.push(`-- Validations`);
      for (const v of validations) {
        lines.push(v);
      }
    }
  }

  // Scopes section
  if (generateScopes) {
    const suggestedScopes = suggestScopes(meta, entityName);
    if (suggestedScopes.length > 0) {
      lines.push(``);
      lines.push(`-- Suggested scopes`);
      for (const s of suggestedScopes) {
        lines.push(s);
      }
    }

    // Soft delete
    if (meta.hasDeletedAt) {
      lines.push(``);
      lines.push(`-- Soft delete`);
      lines.push(`${entityName}:softDelete()`);
    }
  }

  return lines.join("\n") + "\n";
}

function generateColumnDef(col: NormalizedColumn, uniqueConstraints: NormalizedUniqueConstraint[], isPk: boolean): string {
  const typeName = mapColumnType(col);
  let colDef = `    ${col.column_name} = Jade.${typeName}()`;

  // Detect CUID (varchar(25)) and NanoID (varchar(21))
  if (typeName === "String" && col.character_maximum_length === 25 && /^(id|cuid)$/.test(col.column_name)) {
    colDef = `    ${col.column_name} = Jade.CUID():primaryKey()`;
  } else if (typeName === "String" && col.character_maximum_length === 21) {
    colDef = `    ${col.column_name} = Jade.NanoID():unique()`;
  } else if (typeName === "Enum") {
    colDef = `    ${col.column_name} = Jade.Enum(/* TODO: specify values */)`;
  } else if (col.character_maximum_length && typeName === "String") {
    colDef = `    ${col.column_name} = Jade.String(${col.character_maximum_length})`;
  }

  // Primary key
  if (isPk && !colDef.includes(":primaryKey()")) {
    colDef += ":primaryKey()";
  }

  // NOT NULL
  if (col.is_nullable === "NO") {
    colDef += ":notNull()";
  }

  // UNIQUE constraint
  if (isUniqueColumn(col, uniqueConstraints)) {
    colDef += ":unique()";
  }

  // Defaults
  if (col.column_default) {
    if (col.column_default.includes("nextval")) {
      // Already handled as primary key
    } else if (col.column_default === "true" || col.column_default === "false") {
      colDef += `:default(${col.column_default})`;
    } else if (
      col.column_default.includes("CURRENT_TIMESTAMP") ||
      col.column_default.includes("now()") ||
      col.column_default.includes("NOW()")
    ) {
      colDef += `:defaultNow()`;
    } else if (col.column_default === "NULL") {
      // No default needed for NULL
    } else {
      // String or numeric default
      const numVal = Number(col.column_default);
      if (!isNaN(numVal)) {
        colDef += `:default(${col.column_default})`;
      } else {
        const cleaned = col.column_default.replace(/^'|'$/g, "").replace(/''/g, "'");
        colDef += `:default("${cleaned}")`;
      }
    }
  }

  return colDef + ",";
}

function generateValidations(meta: TableMetadata): string[] {
  const lines: string[] = [];

  for (const col of meta.columns) {
    // NOT NULL → validatePresenceOf
    if (col.is_nullable === "NO" && col.column_name !== "id" && !col.column_default?.includes("nextval")) {
      lines.push(`${col.column_name}:validatePresenceOf("${col.column_name}")`);
    }

    // UNIQUE → validateUniquenessOf
    if (isUniqueColumn(col, meta.uniqueConstraints)) {
      lines.push(`${col.column_name}:validateUniquenessOf("${col.column_name}")`);
    }
  }

  return lines;
}

function suggestScopes(meta: TableMetadata, entityName: string): string[] {
  const lines: string[] = [];

  for (const col of meta.columns) {
    // Boolean column → scope
    if (col.data_type === "boolean" || col.data_type === "tinyint") {
      lines.push(`${entityName}:scope("${col.column_name}", { ${col.column_name} = true })`);
    }

    // Status/role columns → scopes by value
    if (col.column_name === "status" || col.column_name === "role") {
      lines.push(`-- ${entityName}:scope("active", { status = "active" })`);
      lines.push(`-- ${entityName}:scope("admin", { role = "admin" })`);
    }
  }

  return lines;
}
