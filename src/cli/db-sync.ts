import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { execFile } from "child_process";

const exec = promisify(execFile);

import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { parseSchemaFile, mapType } from "../core/schema-parser.js";
import { loadState, saveState } from "../core/schema-state.js";
import { DiffEngine, type TableDef, type ColumnDef, type DiffResult } from "../core/diff-engine.js";
import { ensureDir } from "../core/file-manager.js";
import { detectDriver, getDialect, type SQLDialect, type DriverKind } from "../core/sql-dialect.js";

/* ─── DB introspection helpers ──────────────────────────────── */

async function introspectDatabase(projectRoot: string, dialect: SQLDialect, driverKind: DriverKind): Promise<TableDef[]> {
  const configPath = path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\");

  // Get table list
  const listScript = `
    local jade = require("jade")
    local cfg = dofile("${configPath}")
    jade.configure(cfg)
    local rows = jade.driver():execute([[${dialect.tableListQuery()}]])
    local names = {}
    for _, r in ipairs(rows) do
      ${tableListExtractor(driverKind)}
    end
    print(require("dkjson").encode(names))
  `;

  const { stdout: tblOut } = await exec("lua", ["-e", listScript]);
  const tableNames = JSON.parse(tblOut.trim()) as string[];
  const result: TableDef[] = [];

  for (const tname of tableNames) {
    const colQuery = dialect.columnListQuery(tname);
    const colScript = `
      local jade = require("jade")
      local cfg = dofile("${configPath}")
      jade.configure(cfg)
      local cols = jade.driver():execute([[${colQuery}]])
      print(require("dkjson").encode(cols))
    `;

    const { stdout: colOut } = await exec("lua", ["-e", colScript]);
    const rawCols = JSON.parse(colOut.trim()) as any[];

    if (rawCols.length === 0) continue;

    const parsedCols: ColumnDef[] = normalizeColumns(rawCols, driverKind);

    result.push({ name: tname, columns: parsedCols });
  }

  return result;
}

function tableListExtractor(driverKind: DriverKind): string {
  if (driverKind === "sqlite") {
    return "table.insert(names, r.table_name or r.name)";
  }
  return "table.insert(names, r.table_name)";
}

function normalizeColumns(raw: any[], driverKind: DriverKind): ColumnDef[] {
  if (driverKind === "sqlite") {
    return raw.map((c: any) => ({
      name: c.name,
      type: normalizeSqliteType(c.type),
      length: extractLength(c.type) || undefined,
      nullable: c.notnull !== 1 ? true : undefined,
      default: c.dflt_value,
    }));
  }
  return raw.map((c: any) => ({
    name: c.column_name,
    type: normalizeColumnType(c.data_type),
    length: c.character_maximum_length || undefined,
    nullable: c.is_nullable !== "NO" ? true : undefined,
    default: c.column_default,
  }));
}

function normalizeSqliteType(typeStr: string): string {
  if (!typeStr) return "TEXT";
  const upper = typeStr.toUpperCase();
  if (upper.includes("INT")) return "INTEGER";
  if (upper.includes("CHAR") || upper.includes("TEXT")) return "VARCHAR";
  if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB")) return "FLOAT";
  return "TEXT";
}

function extractLength(typeStr: string): number | null {
  if (!typeStr) return null;
  const match = typeStr.match(/\((\d+)\)/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeColumnType(raw: string): string {
  const map: Record<string, string> = {
    integer: "INTEGER",
    bigint: "BIGINT",
    smallint: "INTEGER",
    serial: "SERIAL",
    bigserial: "BIGINT",
    numeric: "DECIMAL",
    real: "FLOAT",
    "double precision": "FLOAT",
    varchar: "VARCHAR",
    "character varying": "VARCHAR",
    text: "TEXT",
    boolean: "BOOLEAN",
    date: "DATE",
    timestamp: "TIMESTAMP",
    "timestamp without time zone": "TIMESTAMP",
    "timestamp with time zone": "TIMESTAMPTZ",
    uuid: "UUID",
    json: "JSON",
    jsonb: "JSONB",
    datetime: "TIMESTAMP",
    tinyint: "BOOLEAN",
  };
  return map[raw] || "TEXT";
}

/* ─── Parse local schema → TableDef[] ───────────────────────── */

function parseLocalSchema(projectRoot: string): TableDef[] {
  const schemaDir = path.join(projectRoot, "schema");
  if (!fs.existsSync(schemaDir)) return [];

  const files = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith(".lua") && f !== "init.lua");

  const result: TableDef[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(schemaDir, file), "utf-8");
    try {
      const entities = parseSchemaFile(content);
      for (const ent of entities) {
        const cols: ColumnDef[] = ent.columns.map((c) => ({
          name: c.name,
          type: mapType(c.type).toUpperCase(),
          length: c.length || undefined,
          nullable: !c.notNull ? true : undefined,
        }));
        result.push({ name: ent.name, columns: cols });
      }
    } catch {
      Logger.warn(`  Could not parse ${file}, skipping`);
    }
  }

  return result;
}

/* ─── Display diff ──────────────────────────────────────────── */

function formatDiff(diff: DiffResult): string[] {
  const lines: string[] = [];

  for (const t of diff.createTables) {
    lines.push(`  + CREATE TABLE ${t.name}`);
    for (const c of t.columns) {
      lines.push(`      + ${c.name} (${c.type}${c.length ? `(${c.length})` : ""})${!c.nullable ? " NOT NULL" : ""}`);
    }
  }

  for (const tn of diff.dropTables) {
    lines.push(`  - DROP TABLE ${tn}`);
  }

  for (const ac of diff.addColumns) {
    lines.push(`  + ${ac.table}.${ac.column.name} (${ac.column.type}${ac.column.length ? `(${ac.column.length})` : ""})${!ac.column.nullable ? " NOT NULL" : ""}`);
  }

  for (const dc of diff.dropColumns) {
    lines.push(`  - ${dc.table}.${dc.column} (dropped)`);
  }

  for (const mc of diff.modifyColumns) {
    lines.push(`  ~ ${mc.table}.${mc.column.name} → ${mc.column.type}${mc.column.length ? `(${mc.column.length})` : ""}${!mc.column.nullable ? " NOT NULL" : ""}`);
  }

  return lines;
}

/* ─── Generate SQL from diff using dialect ───────────────────── */

function generateSyncSQL(diff: DiffResult, dialect: SQLDialect): { upSql: string; downSql: string } {
  const upParts: string[] = [];
  const downParts: string[] = [];
  const cascade = dialect.cascadeDrop();

  // Create tables
  for (const t of diff.createTables) {
    upParts.push(generateCreateTableSQL(t, dialect));
    downParts.push(`DROP TABLE IF EXISTS ${dialect.quoteIdentifier(t.name)}${cascade};`);
  }

  // Add columns
  for (const ac of diff.addColumns) {
    upParts.push(
      `ALTER TABLE ${dialect.quoteIdentifier(ac.table)} ADD COLUMN ${dialect.quoteIdentifier(ac.column.name)} ${dialect.mapType(ac.column.type, ac.column.length)}`
    );
    downParts.push(`ALTER TABLE ${dialect.quoteIdentifier(ac.table)} DROP COLUMN IF EXISTS ${dialect.quoteIdentifier(ac.column.name)};`);
  }

  // Modify columns — simplified to drop+add
  for (const mc of diff.modifyColumns) {
    const col = mc.column;
    upParts.push(
      `ALTER TABLE ${dialect.quoteIdentifier(mc.table)} DROP COLUMN IF EXISTS ${dialect.quoteIdentifier(col.name)};`
    );
    upParts.push(
      `ALTER TABLE ${dialect.quoteIdentifier(mc.table)} ADD COLUMN ${dialect.quoteIdentifier(col.name)} ${dialect.mapType(col.type, col.length)}`
    );
    downParts.push(`ALTER TABLE ${dialect.quoteIdentifier(mc.table)} DROP COLUMN IF EXISTS ${dialect.quoteIdentifier(col.name)};`);
  }

  // Drop columns
  for (const dc of diff.dropColumns) {
    upParts.push(`ALTER TABLE ${dialect.quoteIdentifier(dc.table)} DROP COLUMN IF EXISTS ${dialect.quoteIdentifier(dc.column)};`);
  }

  // Drop tables
  for (const tn of diff.dropTables) {
    upParts.push(`DROP TABLE IF EXISTS ${dialect.quoteIdentifier(tn)}${cascade};`);
  }

  return {
    upSql: joinStatements(upParts),
    downSql: joinStatements(downParts),
  };
}

function generateCreateTableSQL(table: TableDef, dialect: SQLDialect): string {
  const parts: string[] = [
    `CREATE TABLE IF NOT EXISTS ${dialect.quoteIdentifier(table.name)} (\n`,
  ];

  for (let i = 0; i < table.columns.length; i++) {
    const c = table.columns[i];
    let line = `    ${dialect.quoteIdentifier(c.name)} ${dialect.mapType(c.type, c.length)}`;

    if (!c.nullable && !(c.default != null)) {
      line += " NOT NULL";
    }

    if (c.default != null) {
      line += ` DEFAULT ${dialect.mapDefault(c.default, c.type)}`;
    }

    parts.push(line + ",");
  }

  // Primary key on first column if it looks like an ID
  const pkCol = table.columns.find((c) => /id$/i.test(c.name));
  if (pkCol) {
    parts.push(`    PRIMARY KEY (${dialect.quoteIdentifier(pkCol.name)})`);
  }

  parts.push("\n);\n");
  return parts.join("");
}

function joinStatements(parts: string[]): string {
  return parts.filter((s) => s.trim()).join("\n");
}

/* ─── Run migration via Lua ─────────────────────────────────── */

async function runMigrateScript(projectRoot: string, fileName: string): Promise<boolean> {
  const migrationsDir = path.join(projectRoot, "migrations");
  const configPath = path.join(projectRoot, "jade.config.lua");
  const migPath = path.join(migrationsDir, fileName);

  const singleLineScript = `
local jade = require("jade")
local cfg = dofile("${configPath.replace(/\\/g, "\\\\")}")
jade.configure(cfg)
local driver = jade.driver()

local f = io.open("${migPath.replace(/\\/g, "\\\\")}", "r")
if not f then
  print("ERROR: Cannot read migration file")
  os.exit(1)
end
local sql = f:read("*all")
f:close()

for stmt in sql:gmatch("[^;]+;?") do
  local trimmed = stmt:match("^%s*(.-)%s*$")
  if trimmed and #trimmed > 0 then
    local ok, err = pcall(function() driver:execute(trimmed) end)
    if not ok then
      print("ERROR: " .. tostring(err))
      os.exit(1)
    end
    print("  Applied: " .. trimmed:sub(1, 60))
  end
end
print("OK")
`;

  try {
    await exec("lua", ["-e", singleLineScript]);
    return true;
  } catch {
    return false;
  }
}

/* ─── Main sync operation ───────────────────────────────────── */

interface SyncOptions {
  preview?: boolean;
  force?: boolean;
  database?: string;
}

async function runSync(options: SyncOptions): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    throw AppError.notInitialized();
  }

  /* ── Security: block production ── */
  if (process.env.JADE_ENV === "production") {
    Logger.error("db sync is not allowed in production environment.");
    Logger.info("Use 'esmeralda migrate' instead.");
    process.exit(1);
  }

  const driverKind = detectDriver(projectRoot);
  const dialect = getDialect(driverKind);
  Logger.info(`Detected driver: ${driverKind}`);

  /* ── 1. Introspect current DB schema ── */
  Logger.info("Introspecting current database schema...");
  const currentDb: TableDef[] = await introspectDatabase(projectRoot, dialect, driverKind);

  /* ── 2. Parse local schema files ── */
  Logger.info("Reading local schema files from schema/...");
  const desiredSchema: TableDef[] = parseLocalSchema(projectRoot);

  /* ── 3. Compute diff ── */
  const engine = new DiffEngine();
  const diff = engine.compute(desiredSchema, currentDb);

  if (engine.isEmpty(diff)) {
    Logger.success("Schema is in sync — no changes needed.");
    return;
  }

  /* ── 4. Display differences ── */
  Logger.info("");
  Logger.info("Differences found:");
  const diffLines = formatDiff(diff);
  for (const line of diffLines) {
    console.log(line);
  }

  if (options.preview) {
    Logger.info("");
    Logger.info("(Preview mode — nothing was applied)");
    return;
  }

  /* ── 5. Generate migration SQL & file ── */
  Logger.info("");
  Logger.info("Generating migration...");

  const { upSql, downSql } = generateSyncSQL(diff, dialect);
  const timestamp = Date.now().toString().slice(0, 14);

  // Generate descriptive name from diff
  const parts: string[] = [];
  if (diff.createTables.length > 0) parts.push("create_" + diff.createTables.map(t => t.name).join("_"));
  if (diff.dropTables.length > 0) parts.push("remove_" + diff.dropTables.join("_"));
  if (diff.addColumns.length > 0) {
    const tables = [...new Set(diff.addColumns.map(a => a.table))];
    parts.push("add_columns_" + tables.join("_"));
  }
  if (diff.dropColumns.length > 0) {
    const tables = [...new Set(diff.dropColumns.map(d => d.table))];
    parts.push("drop_columns_" + tables.join("_"));
  }
  const migName = parts.length > 0 ? parts.join("_and_") : "sync_schema";
  const fileName = `${timestamp}_${migName}_sync_schema.lua`;
  const migrationsDir = path.join(projectRoot, "migrations");
  ensureDir(migrationsDir);

  const fullPath = path.join(migrationsDir, fileName);
  const migrationContent = `-- Auto-generated by 'esmeralda db sync'\n-- Generated at: ${new Date().toISOString()}\n-- Driver: ${driverKind}\n\nM.up = function()\n${indent(upSql, "    ")}\nend\n\nM.down = function()\n${indent(downSql, "    ")}\nend\n`;

  fs.writeFileSync(fullPath, migrationContent, "utf-8");
  Logger.info(`  Created migrations/${fileName}`);

  /* ── 6. Apply (or prompt) ── */
  if (options.force) {
    Logger.info("Applying migration (--force)...");
  } else {
    Logger.info("");
    const apply = await promptYesNo("Apply migration?");
    if (!apply) {
      Logger.info("Skipped. Migration file left in migrations/ for manual execution.");
      return;
    }
  }

  /* ── 7. Execute migration ── */
  Logger.info("Applying migration...");
  const success = await runMigrateScript(projectRoot, fileName);

  if (!success) {
    Logger.error("Failed to apply migration.");
    Logger.warn(`  Migration file: migrations/${fileName}`);
    Logger.info("  You can manually apply it with: esmeralda migrate");
    process.exit(1);
  }

  Logger.success("Schema synced successfully.");
}

/* ─── Helpers ───────────────────────────────────────────────── */

function indent(text: string, prefix: string): string {
  return text.split("\n").map((line) => prefix + line).join("\n");
}

function promptYesNo(question: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N]: `, (answer: string) => {
      const yes = answer.trim().toLowerCase() === "y";
      rl.close();
      resolve(yes);
    });
  });
}

/* ─── Register command ──────────────────────────────────────── */

export function registerDbSync(db: Command): void {
  db
    .command("sync")
    .description("Automatically sync database schema to match local definition (like prisma db push)")
    .option("--preview", "Show what would be done without applying")
    .option("--force", "Skip confirmation prompt and apply immediately")
    .action(async (options: SyncOptions) => {
      try {
        await runSync(options);
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) Logger.info(`Suggestion: ${error.suggestion}`);
        } else {
          Logger.error("db sync failed:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) console.error(error.stack);
        process.exit(1);
      }
    });
}
