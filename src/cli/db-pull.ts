import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { parseSchemaFile } from "../core/schema-parser.js";
import { saveState } from "../core/schema-state.js";
import { LuaBridge, validateLuaIdentifier } from "../core/lua-bridge.js";

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

        Logger.info("Introspecting database...");

        const bridge = new LuaBridge();
        const configPath = path.join(projectRoot, "jade.config.lua");

        // Get table list
        const listScript = `
local jade = require("jade")
local config = dofile(ARGS.configPath)
jade.configure(config)
local tables = jade.driver():execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
local result = {}
for _, row in ipairs(tables) do
    table.insert(result, row.table_name)
end
print(require("dkjson").encode(result))
        `;

        const tables: string[] = await bridge.executeSafeJson(listScript, { configPath });

        Logger.info(`Found ${tables.length} tables`);

        const schemaDir = path.join(projectRoot, "schema");
        fs.mkdirSync(schemaDir, { recursive: true });

        for (const tableName of tables) {
          if (options.table && tableName !== options.table) continue;

          Logger.info(`  Generating entity: ${tableName}`);

          // Get columns for this table — pass tableName via ARGS to avoid injection
          const columnScript = `
local jade = require("jade")
local config = dofile(ARGS.configPath)
jade.configure(config)
local cols = jade.driver():execute("SELECT column_name, data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns WHERE table_name = '" .. ARGS.tableName:gsub("'", "''") .. "' ORDER BY ordinal_position")
print(require("dkjson").encode(cols))
          `;

          const columns: any[] = await bridge.executeSafeJson(columnScript, {
            configPath,
            tableName,
          });

          // Get foreign keys for this table
          let foreignKeys: any[] = [];
          try {
            const fkScript = `
local jade = require("jade")
local config = dofile(ARGS.configPath)
jade.configure(config)
local fks = jade.driver():execute([[
  SELECT
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = ']] .. ARGS.tableName:gsub("'", "''") .. [['
  AND tc.table_schema = 'public'
]])
print(require("dkjson").encode(fks))
            `;

            foreignKeys = await bridge.executeSafeJson(fkScript, {
              configPath,
              tableName,
            });
          } catch {
            // Foreign keys query might fail, continue without them
          }

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
      "uuid":        "UUID",
      "json":        "JSON",
      "jsonb":       "JSON",
      "enum":        "Enum",
    };

    const typeName = typeMap[col.data_type] || "Text";
    let colDef = `    ${col.column_name} = Jade.${typeName}()`;

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
