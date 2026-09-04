import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { parseSchemaFile, mapType } from "../core/schema-parser.js";
import { DiffEngine, type TableDef, type ColumnDef, type DiffResult, type IndexDef } from "../core/diff-engine.js";
import { ensureDir } from "../core/file-manager.js";
import { LuaBridge } from "../core/lua-bridge.js";
import { getConfigPathForEnv, LUA_CONFIG_LOAD } from "../core/config.js";

/* ─── DB introspection helpers ──────────────────────────────── */

async function introspectDatabase(projectRoot: string): Promise<TableDef[]> {
  const bridge = new LuaBridge();
  const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);

  const listScript = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
local rows = jade.driver():execute([[
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name
]])
local names = {}
for _, r in ipairs(rows) do table.insert(names, r.table_name) end
print(require("dkjson").encode(names))
  `;

  const tableNames: string[] = await bridge.executeSafeJson(listScript, { configPath, envConfigPath });
  const result: TableDef[] = [];

  for (const tname of tableNames) {
    const colScript = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
local cols = jade.driver():execute([[
  SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = ']] .. ARGS.tname:gsub("'", "''") .. [[' AND table_schema = 'public'
  ORDER BY ordinal_position
]])
print(require("dkjson").encode(cols))
    `;

    const cols: any[] = await bridge.executeSafeJson(colScript, { configPath, envConfigPath, tname });

    if (cols.length === 0) continue;

    const parsedCols: ColumnDef[] = cols.map((c) => ({
      name: c.column_name,
      type: normalizeColumnType(c.data_type),
      length: c.character_maximum_length || undefined,
      nullable: c.is_nullable !== "NO" ? true : undefined,
      default: c.column_default,
    }));

    // Get indexes for this table
    const idxScript = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
local rows = jade.driver():execute([[
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = ']] .. ARGS.tname:gsub("'", "''") .. [[' AND schemaname = 'public'
  ORDER BY indexname
]])
local result = {}
for _, r in ipairs(rows) do
  local unique = r.indexdef:match("UNIQUE") ~= nil
  local cols_str = r.indexdef:match("%((.+)%)")
  local cols = {}
  if cols_str then
    for col in cols_str:gmatch("[^,]+") do
      col = col:match("^%s*(.-)%s*$")
      table.insert(cols, col)
    end
  end
  table.insert(result, { name = r.indexname, columns = cols, unique = unique })
end
print(require("dkjson").encode(result))
    `;

    let indexes: IndexDef[] = [];
    try {
      const idxResult: any[] = await bridge.executeSafeJson(idxScript, { configPath, envConfigPath, tname });
      // Filter out primary key indexes (they're managed by the column definition)
      indexes = idxResult
        .filter((idx: any) => !idx.name.endsWith("_pkey"))
        .map((idx: any) => ({
          name: idx.name,
          columns: idx.columns,
          unique: idx.unique || undefined,
        }));
    } catch {
      // Index introspection might fail on non-PostgreSQL drivers
    }

    result.push({ name: tname, columns: parsedCols, indexes: indexes.length > 0 ? indexes : undefined });
  }

  return result;
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
        // Also generate implicit unique indexes from :unique() columns
        const implicitIndexes: IndexDef[] = ent.columns
          .filter(c => c.unique)
          .map(c => ({
            name: `${ent.tableName}_${c.name}_key`,
            columns: [c.name],
            unique: true,
          }));
        const allIndexes = [...(ent.indexes || []), ...implicitIndexes];
        result.push({ name: ent.name, columns: cols, indexes: allIndexes.length > 0 ? allIndexes : undefined });
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

  for (const ai of diff.addIndexes) {
    lines.push(`  + INDEX ${ai.index.name} ON ${ai.table} (${ai.index.columns.join(", ")})${ai.index.unique ? " UNIQUE" : ""}`);
  }

  for (const di of diff.dropIndexes) {
    lines.push(`  - INDEX ${di.index} ON ${di.table}`);
  }

  return lines;
}

/* ─── Generate SQL from diff ────────────────────────────────── */

function generateSyncSQL(diff: DiffResult): { upSql: string; downSql: string } {
  const upParts: string[] = [];
  const downParts: string[] = [];

  for (const t of diff.createTables) {
    upParts.push(generateCreateTable(t));
    downParts.push(`\n-- Drop created tables\nDROP TABLE IF EXISTS ${quote(t.name)} CASCADE;\n`);
  }

  for (const ac of diff.addColumns) {
    upParts.push(
      `ALTER TABLE ${quote(ac.table)} ADD COLUMN ${quote(ac.column.name)} ${toSQLType(ac.column)}${toSQLDefault(ac.column)}`
    );
    downParts.push(`ALTER TABLE ${quote(ac.table)} DROP COLUMN IF EXISTS ${quote(ac.column.name)};\n`);
  }

  for (const mc of diff.modifyColumns) {
    const col = mc.column;
    upParts.push(
      `ALTER TABLE ${quote(mc.table)} DROP COLUMN IF EXISTS ${quote(col.name)}; ALTER TABLE ${quote(mc.table)} ADD COLUMN ${quote(col.name)} ${toSQLType(col)}${toSQLDefault(col)}`
    );
    downParts.push(`ALTER TABLE ${quote(mc.table)} DROP COLUMN IF EXISTS ${quote(col.name)};\n`);
  }

  for (const dc of diff.dropColumns) {
    upParts.push(`ALTER TABLE ${quote(dc.table)} DROP COLUMN IF EXISTS ${quote(dc.column)};`);
  }

  for (const tn of diff.dropTables) {
    upParts.push(`DROP TABLE IF EXISTS ${quote(tn)} CASCADE;`);
  }

  // Index changes
  for (const ai of diff.addIndexes) {
    const unique = ai.index.unique ? "UNIQUE " : "";
    const cols = ai.index.columns.map(c => quote(c)).join(", ");
    upParts.push(`CREATE ${unique}INDEX ${quote(ai.index.name)} ON ${quote(ai.table)} (${cols});`);
    downParts.push(`DROP INDEX IF EXISTS ${quote(ai.index.name)};`);
  }

  for (const di of diff.dropIndexes) {
    upParts.push(`DROP INDEX IF EXISTS ${quote(di.index)};`);
    // Down: would need original index definition — skip for now
  }

  return {
    upSql: joinStatements(upParts),
    downSql: joinStatements(downParts),
  };
}

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toSQLType(col: ColumnDef): string {
  switch (col.type.toUpperCase()) {
    case "INTEGER":
      return "INTEGER";
    case "BIGINT":
      return "BIGINT";
    case "SERIAL":
      return "SERIAL";
    case "VARCHAR":
      return `VARCHAR(${col.length || 255})`;
    case "TEXT":
      return "TEXT";
    case "FLOAT":
      return "DOUBLE PRECISION";
    case "DECIMAL":
      return `DECIMAL(10,2)`;
    case "BOOLEAN":
      return "BOOLEAN";
    case "TIMESTAMP":
      return "TIMESTAMP";
    case "TIMESTAMPTZ":
      return "TIMESTAMPTZ";
    case "DATE":
      return "DATE";
    case "UUID":
      return "UUID";
    case "JSON":
      return "JSON";
    case "JSONB":
      return "JSONB";
    default:
      return "TEXT";
  }
}

function toSQLDefault(col: ColumnDef): string {
  if (col.default == null) return "";
  if (typeof col.default === "string") {
    return ` DEFAULT '${col.default.replace(/'/g, "''")}'`;
  }
  return ` DEFAULT ${col.default}`;
}

function generateCreateTable(table: TableDef): string {
  const parts: string[] = [
    `CREATE TABLE IF NOT EXISTS ${quote(table.name)} (\n`,
  ];

  for (let i = 0; i < table.columns.length; i++) {
    const c = table.columns[i];
    let line = `    ${quote(c.name)} ${toSQLType(c)}`;

    if (!c.nullable && !(c.default != null)) {
      line += " NOT NULL";
    }

    line += toSQLDefault(c);
    parts.push(line + ",");
  }

  const pkCol = table.columns.find((c) => /id$/i.test(c.name));
  if (pkCol) {
    parts.push(`    PRIMARY KEY (${quote(pkCol.name)})`);
  }

  parts.push("\n);\n");
  return parts.join("");
}

function joinStatements(parts: string[]): string {
  return parts.filter((s) => s.trim()).join("\n");
}

/* ─── Run migration via Lua ─────────────────────────────────── */

async function runMigrateScript(projectRoot: string, fileName: string): Promise<boolean> {
  const bridge = new LuaBridge();
  const migrationsDir = path.join(projectRoot, "migrations");
  const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);
  const migPath = path.join(migrationsDir, fileName);

  const script = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
local driver = jade.driver()

local f = io.open(ARGS.migPath, "r")
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
    print("  ✓ Applied: " .. trimmed:sub(1, 60))
  end
end
print("OK")
  `;

  try {
    await bridge.executeSafe(script, { configPath, envConfigPath, migPath });
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

  if (process.env.JADE_ENV === "production") {
    Logger.error("db sync is not allowed in production environment.");
    Logger.info("Use 'esmeralda migrate' instead.");
    process.exit(1);
  }

  Logger.info("Introspecting current database schema...");
  const currentDb: TableDef[] = await introspectDatabase(projectRoot);

  Logger.info("Reading local schema files from schema/...");
  const desiredSchema: TableDef[] = parseLocalSchema(projectRoot);

  const engine = new DiffEngine();
  const diff = engine.compute(desiredSchema, currentDb);

  if (engine.isEmpty(diff)) {
    Logger.success("Schema is in sync — no changes needed.");
    return;
  }

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

  Logger.info("");
  Logger.info("Generating migration...");

  const { upSql, downSql } = generateSyncSQL(diff);
  const timestamp = Date.now().toString().slice(0, 14);

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
  const migrationContent = `-- Auto-generated by 'esmeralda db sync'\n-- Generated at: ${new Date().toISOString()}\n\nM.up = function()\n${indent(upSql, "    ")}\nend\n\nM.down = function()\n${indent(downSql, "    ")}\nend\n`;

  fs.writeFileSync(fullPath, migrationContent, "utf-8");
  Logger.info(`  Created migrations/${fileName}`);

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
