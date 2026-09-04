import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { parseSchemaFile } from "../core/schema-parser.js";
import { saveState } from "../core/schema-state.js";
import { detectDriver, getDialect, type SQLDialect, type DriverKind } from "../core/sql-dialect.js";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

export function registerDbPull(db: Command): void {
  db
    .command("pull")
    .description("Introspect database and generate entity files")
    .option("-t, --table <name>", "Introspect specific table only")
    .option("-d, --database <name>", "Database to introspect")
    .action(async (options: { table?: string; database?: string }) => {
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
          local jade = require("jade")
          local config = dofile("${configPath}")
          jade.configure(config)
          local tables = jade.driver():execute([[${dialect.tableListQuery()}]])
          local result = {}
          for _, row in ipairs(tables) do
            ${tableListExtractor(driverKind)}
          end
          print(require("dkjson").encode(result))
        `;

        const { stdout } = await exec("lua", ["-e", listScript]);
        const tables = JSON.parse(stdout.trim());

        Logger.info(`Found ${tables.length} tables`);

        // Generate entity files for each table
        const schemaDir = path.join(projectRoot, "schema");
        fs.mkdirSync(schemaDir, { recursive: true });

        for (const tableName of tables) {
          if (options.table && tableName !== options.table) continue;

          Logger.info(`  Generating entity: ${tableName}`);

          // Get columns using dialect-specific query
          const columnQuery = dialect.columnListQuery(tableName);
          const columnScript = `
            local jade = require("jade")
            local config = dofile("${configPath}")
            jade.configure(config)
            local cols = jade.driver():execute([[${columnQuery}]])
            print(require("dkjson").encode(cols))
          `;

          const { stdout: colOutput } = await exec("lua", ["-e", columnScript]);
          const rawColumns = JSON.parse(colOutput.trim());
          const columns = normalizeColumns(rawColumns, driverKind);

          // Get foreign keys using dialect-specific query
          let foreignKeys: any[] = [];
          try {
            const fkQuery = dialect.foreignKeyQuery(tableName);
            const fkScript = `
              local jade = require("jade")
              local config = dofile("${configPath}")
              jade.configure(config)
              local fks = jade.driver():execute([[${fkQuery}]])
              print(require("dkjson").encode(fks))
            `;
            const { stdout: fkOutput } = await exec("lua", ["-e", fkScript]);
            foreignKeys = normalizeForeignKeys(JSON.parse(fkOutput.trim()), driverKind);
          } catch {
            // Foreign keys query might fail, continue without them
          }

          // Generate Lua entity file
          const entityName = tableName.charAt(0).toUpperCase() + tableName.slice(1);
          const luaContent = generateEntityLua(entityName, tableName, columns, foreignKeys);

          const filename = `${tableName}.lua`;
          const filePath = path.join(schemaDir, filename);
          fs.writeFileSync(filePath, luaContent, "utf-8");
        }

        // Save schema state as baseline for future generate commands
        const generatedFiles = tables
          .filter((t: string) => !options.table || t === options.table)
          .map((t: string) => `${t}.lua`);

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

/* ─── Normalization helpers ─────────────────────────────────── */

interface NormalizedColumn {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
  column_default: string | null;
}

function tableListExtractor(driverKind: DriverKind): string {
  if (driverKind === "sqlite") {
    return "table.insert(result, row.table_name or row.name)";
  }
  return "table.insert(result, row.table_name)";
}

function normalizeColumns(raw: any[], driverKind: DriverKind): NormalizedColumn[] {
  if (driverKind === "sqlite") {
    // SQLite PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
    return raw.map((c: any) => ({
      column_name: c.name,
      data_type: normalizeSqliteType(c.type),
      character_maximum_length: extractLength(c.type),
      is_nullable: c.notnull === 1 ? "NO" : "YES",
      column_default: c.dflt_value,
    }));
  }
  // PostgreSQL and MySQL return information_schema format directly
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

interface NormalizedForeignKey {
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

function normalizeForeignKeys(raw: any[], driverKind: DriverKind): NormalizedForeignKey[] {
  if (driverKind === "sqlite") {
    // SQLite PRAGMA foreign_key_list returns: id, seq, table, from, to, on_update, on_delete, match
    return raw.map((fk: any) => ({
      column_name: fk.from,
      foreign_table_name: fk.table,
      foreign_column_name: fk.to,
    }));
  }
  return raw;
}

/* ─── Entity generation ─────────────────────────────────────── */

function generateEntityLua(entityName: string, tableName: string, columns: any[], foreignKeys: any[]): string {
  const lines: string[] = [];

  lines.push(`local Jade = require("jade")`);
  lines.push(``);
  lines.push(`return Jade.Entity("${tableName}", {`);

  for (const col of columns) {
    const typeMap: Record<string, string> = {
      "integer":     "Integer",
      "bigint":      "BigInt",
      "smallint":    "Integer",
      "serial":      "Integer",
      "bigserial":   "BigInt",
      "numeric":     "Decimal",
      "decimal":     "Decimal",
      "real":        "Float",
      "double precision": "Float",
      "varchar":     "String",
      "character varying": "String",
      "text":        "Text",
      "char":        "String",
      "boolean":     "Boolean",
      "date":        "Date",
      "timestamp with time zone": "Timestamp",
      "timestamp without time zone": "Timestamp",
      "timestamp":   "Timestamp",
      "datetime":    "Timestamp",
      "uuid":        "UUID",
      "json":        "JSON",
      "jsonb":       "JSON",
      "enum":        "Enum",
      "tinyint":     "Boolean",
      "blob":        "Text",
    };

    const typeName = typeMap[col.data_type] || "Text";
    let colDef = `    ${col.column_name} = Jade.${typeName}()`;

    // Detect CUID (varchar(25)) and NanoID (varchar(21)) by column name heuristics
    if (typeName === "String" && col.character_maximum_length === 25) {
      if (/^(id|cuid)$/.test(col.column_name)) {
        colDef = `    ${col.column_name} = Jade.CUID():primaryKey()`;
      } else {
        colDef = `    ${col.column_name} = Jade.String(${col.character_maximum_length})`;
      }
    }
    if (typeName === "String" && col.character_maximum_length === 21) {
      colDef = `    ${col.column_name} = Jade.NanoID():unique()`;
    }
    if (typeName === "Enum") {
      colDef = `    ${col.column_name} = Jade.Enum(/* TODO: specify values */)`;
    }

    if (col.character_maximum_length && typeName === "String" && !col.cuidDefault && !col.nanoidDefault) {
      colDef = `    ${col.column_name} = Jade.String(${col.character_maximum_length})`;
    }

    if (col.is_nullable === "NO") {
      colDef += ":notNull()";
    }

    if (col.column_default && col.column_default.includes("nextval")) {
      if (!/^(id|cuid)$/.test(col.column_name) || col.character_maximum_length !== 25) {
        colDef += ":primaryKey()";
      }
    } else if (col.column_default === "true" || col.column_default === "false") {
      colDef += `:default(${col.column_default})`;
    }

    lines.push(colDef + ",");
  }

  lines.push(`})`);

  // Add relations based on foreign keys
  if (foreignKeys.length > 0) {
    lines.push(``);
    lines.push(`-- Relations`);

    for (const fk of foreignKeys) {
      const foreignEntity = fk.foreign_table_name.charAt(0).toUpperCase() + fk.foreign_table_name.slice(1, -1);
      lines.push(`-- ${entityName}:belongsTo(${foreignEntity}, { foreign_key = "${fk.column_name}" })`);
    }
  }

  return lines.join("\n");
}
