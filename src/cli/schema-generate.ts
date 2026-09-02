import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { Logger, AppError, handleError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { LuaBridge } from "../core/lua-bridge.js";
import { getConfigPathForEnv, LUA_CONFIG_LOAD } from "../core/config.js";

interface SchemaGenerateOptions {
  name?: string;
  output?: string;
}

export function registerSchemaGenerate(program: Command): void {
  program
    .command("schema-generate")
    .description("Generate schema files from declarative schema definition")
    .option("-n, --name <name>", "Schema name (default: schema)")
    .option("-o, --output <dir>", "Output directory (default: schema/)")
    .action(async (options: SchemaGenerateOptions) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        Logger.info("Generating schema from declarative definition...");

        const schemaDefPath = path.join(projectRoot, "schema.lua");
        if (!fs.existsSync(schemaDefPath)) {
          throw AppError.schemaFileNotFound();
          Logger.info("Example:");
          Logger.info(`
local Jade = require("jade")

local schema = Jade.Declarative.define(function(d)
    d:model("User", {
        name = "string",
        email = "string(100)",
        validations = {
            name = { presence = true },
            email = { uniqueness = true },
        },
    }):model("Post", {
        title = "string",
        body = "text",
        relations = {
            user = { type = "belongsTo", model = "User" },
        },
    })
end)

return schema
`);
          process.exit(1);
        }

        const outputDir = options.output || "schema";
        const bridge = new LuaBridge();
        const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);

        const script = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
local schema_def = dofile(ARGS.schemaDefPath)
local files = jade.Declarative.toLuaFiles(schema_def)
local result = {}
for filename, content in pairs(files) do
    table.insert(result, { filename = filename, content = content })
end
print(require("dkjson").encode(result))
        `;

        const files: Array<{ filename: string; content: string }> = await bridge.executeSafeJson(script, {
          configPath,
          envConfigPath,
          schemaDefPath,
        });

        const outputPath = path.join(projectRoot, outputDir);
        fs.mkdirSync(outputPath, { recursive: true });

        for (const file of files) {
          const filePath = path.join(outputPath, file.filename);
          fs.writeFileSync(filePath, file.content, "utf-8");
          Logger.info(`  Generated: ${file.filename}`);
        }

        Logger.success(`Schema files generated in ${outputDir}/`);
      } catch (error: unknown) {
        handleError(error);
      }
    });
}

interface SchemaDiffOptions {
  preview?: boolean;
}

function schemaDiffAction(options: SchemaDiffOptions): void {
  (async () => {
    try {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        throw AppError.notInitialized();
      }

      Logger.info("Comparing schema with database...");

      const bridge = new LuaBridge();
      const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);
      const schemaLuaPath = path.join(projectRoot, "schema.lua");

      const script = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)

local tables = jade.driver():execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
local current_schema = { models = {} }

for _, row in ipairs(tables) do
    local table_name = row.table_name
    local cols = jade.driver():execute("SELECT column_name, data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns WHERE table_name = '" .. table_name:gsub("'", "''") .. "' ORDER BY ordinal_position")

    local fields = {}
    for _, col in ipairs(cols) do
        local field = {
            name = col.column_name,
            type = col.data_type,
            not_null = col.is_nullable == "NO",
        }
        if col.character_maximum_length then
            field.length = col.character_maximum_length
        end
        if col.column_default and col.column_default:find("nextval") then
            field.primary_key = true
        end
        fields[col.column_name] = field
    end

    current_schema.models[table_name] = {
        tableName = table_name,
        fields = fields,
    }
end

local schema_def = dofile(ARGS.schemaLuaPath)
local diff = jade.Declarative.diff(current_schema, schema_def)
print(require("dkjson").encode(diff))
      `;

      const diff = await bridge.executeSafeJson(script, {
        configPath,
        envConfigPath,
        schemaLuaPath,
      });

      if (diff.tables_to_create.length > 0) {
        Logger.info("Tables to create:");
        for (const table of diff.tables_to_create) {
          Logger.info(`  + ${table.tableName}`);
        }
      }

      if (diff.tables_to_drop.length > 0) {
        Logger.info("Tables to drop:");
        for (const table of diff.tables_to_drop) {
          Logger.info(`  - ${table.tableName}`);
        }
      }

      if (diff.tables_to_alter.length > 0) {
        Logger.info("Tables to alter:");
        for (const table of diff.tables_to_alter) {
          Logger.info(`  ~ ${table.model.tableName}`);
          if (table.changes.columns_to_add.length > 0) {
            for (const col of table.changes.columns_to_add) {
              Logger.info(`    + ${col.name}`);
            }
          }
          if (table.changes.columns_to_drop.length > 0) {
            for (const col of table.changes.columns_to_drop) {
              Logger.info(`    - ${col.name}`);
            }
          }
        }
      }

      if (diff.tables_to_create.length === 0 && diff.tables_to_drop.length === 0 && diff.tables_to_alter.length === 0) {
        Logger.info("No changes detected.");
        return;
      }

      if (options.preview) {
        Logger.info("Preview mode - no migration generated.");
        return;
      }

      Logger.info("Generating migration...");
      Logger.success("Migration generation not yet implemented.");
    } catch (error: unknown) {
      handleError(error);
    }
  })();
}

export function registerSchemaDiff(db: Command): void {
  db.command("diff")
    .description("Compare current schema with database and generate migration")
    .option("--preview", "Preview changes without generating migration")
    .action(schemaDiffAction);

  db.command("schema-diff")
    .description("Compare current schema with database and generate migration (alias for 'db diff')")
    .option("--preview", "Preview changes without generating migration")
    .action(schemaDiffAction)
    .addHelpText("after", "\nTip: Use 'db diff' instead.");
}
