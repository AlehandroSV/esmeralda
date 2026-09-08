import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { Logger, AppError, handleError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { LuaBridge } from "../core/lua-bridge.js";
import { getConfigPathForEnv, LUA_CONFIG_LOAD } from "../core/config.js";
import { parseSchemaFile } from "../core/schema-parser.js";

interface SchemaGenerateOptions {
  name?: string;
  output?: string;
}

/** Find Jade source directory by searching parent directories */
function findJadeSource(projectRoot: string): string | null {
  // Check common relative paths from project root
  const candidates = [
    path.join(projectRoot, "jade", "src"),
    path.join(projectRoot, "..", "jade", "src"),
    path.join(projectRoot, "..", "..", "jade", "src"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "jade", "init.lua"))) {
      return candidate;
    }
  }
  // Check JADE_PATH environment variable
  const envPath = process.env.JADE_PATH;
  if (envPath && fs.existsSync(path.join(envPath, "jade", "init.lua"))) {
    return envPath;
  }
  return null;
}

export function registerGenerate(program: Command): void {
  program
    .command("generate")
    .description("Generate migration from .jade schema (standard)")
    .option("-n, --name <name>", "Migration name")
    .option("--preview", "Preview SQL without generating file")
    .option("-o, --output <dir>", "Output directory (default: schema/)")
    .option("-f, --file <path>", "Schema file path (default: auto-detect)")
    .action(async (options: SchemaGenerateOptions & { file?: string; preview?: boolean }) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        Logger.info("Generating from .jade schema...");

        // Find schema file: explicit flag > .jade in schema/ > schema.lua
        let schemaDefPath: string;
        if (options.file) {
          schemaDefPath = path.resolve(projectRoot, options.file);
        } else {
          const jadeDir = path.join(projectRoot, "schema");
          const jadeFiles = fs.existsSync(jadeDir)
            ? fs.readdirSync(jadeDir).filter(f => f.endsWith(".jade"))
            : [];
          if (jadeFiles.length > 0) {
            schemaDefPath = path.join(jadeDir, jadeFiles[0]);
          } else {
            schemaDefPath = path.join(projectRoot, "schema.lua");
          }
        }

        if (!fs.existsSync(schemaDefPath)) {
          Logger.error("Schema file not found.");
          Logger.info("");
          Logger.info("Expected one of:");
          Logger.info("  - schema/models.jade  (declarative .jade file)");
          Logger.info("  - schema.lua          (Lua table format)");
          Logger.info("");
          Logger.info("Or specify explicitly:");
          Logger.info("  esmeralda schema-generate -f path/to/schema.jade");
          process.exit(1);
        }

        const isJade = schemaDefPath.endsWith(".jade");
        Logger.info(`  Using: ${path.relative(projectRoot, schemaDefPath)}`);

        const outputDir = options.output || "schema";
        const jadeSrc = findJadeSource(projectRoot);
        const luaPackagePath = [
          projectRoot.replace(/\\/g, "/") + "/?.lua",
          projectRoot.replace(/\\/g, "/") + "/?/init.lua",
          ...(jadeSrc ? [jadeSrc.replace(/\\/g, "/") + "/?.lua", jadeSrc.replace(/\\/g, "/") + "/?/init.lua"] : []),
        ].join(";");
        const bridge = new LuaBridge("lua", luaPackagePath);
        const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);

        let script: string;
        if (isJade) {
          // Parse .jade file by reading it inside Lua
          script = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
local f = io.open(ARGS.schemaDefPath, "r")
if not f then error("Cannot open file: " .. ARGS.schemaDefPath) end
local content = f:read("*a")
f:close()
local schema = jade.Declarative.parsedeclarativeSchema(content)
local files = jade.Declarative.toLuaFiles({ models = schema.models })
local result = {}
for filename, file_content in pairs(files) do
    table.insert(result, { filename = filename, content = file_content })
end
print(require("dkjson").encode(result))
          `;
        } else {
          // Parse schema.lua using dofile
          script = `
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
        }

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

function findSchemaFile(projectRoot: string): { path: string; isJade: boolean } | null {
  const schemaDir = path.join(projectRoot, "schema");
  if (fs.existsSync(schemaDir)) {
    const jadeFiles = fs.readdirSync(schemaDir).filter(f => f.endsWith(".jade"));
    if (jadeFiles.length > 0) {
      return { path: path.join(schemaDir, jadeFiles[0]), isJade: true };
    }
  }
  const luaPath = path.join(projectRoot, "schema.lua");
  if (fs.existsSync(luaPath)) {
    return { path: luaPath, isJade: false };
  }
  return null;
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
      const schemaFile = findSchemaFile(projectRoot);
      const schemaDir = path.join(projectRoot, "schema");

      if (!schemaFile) {
        Logger.error("No schema file found. Create schema/models.jade or schema.lua.");
        process.exit(1);
      }

      Logger.info(`  Using: ${path.relative(projectRoot, schemaFile.path)}`);

      // Support both schema.lua (declarative) and schema/ (entity files)
      const useSchemaDir = !schemaFile && fs.existsSync(schemaDir);

      if (useSchemaDir) {
        // Read schema from entity files in schema/ directory
        const files = fs.readdirSync(schemaDir).filter(f => f.endsWith(".lua") && f !== "init.lua");
        const entities: string[] = [];
        for (const file of files) {
          const content = fs.readFileSync(path.join(schemaDir, file), "utf-8");
          const parsed = parseSchemaFile(content);
          for (const ent of parsed) {
            entities.push(ent.tableName);
          }
        }

        if (entities.length === 0) {
          Logger.warn("No entities found in schema/");
          return;
        }

        Logger.info(`Found ${entities.length} entities in schema/`);
        Logger.info("Use 'esmeralda db sync' to compare and apply changes.");
        return;
      }

      const schemaPath = schemaFile.path;
      const isJade = schemaFile.isJade;

      let schemaLoadLua: string;
      if (isJade) {
        schemaLoadLua = `local f = io.open(ARGS.schemaPath, "r")\nif not f then error("Cannot open: " .. ARGS.schemaPath) end\nlocal content = f:read("*a")\nf:close()\nlocal parsed = jade.Declarative.parsedeclarativeSchema(content)\nlocal schema_def = { models = parsed.models }`;
      } else {
        schemaLoadLua = `local schema_def = dofile(ARGS.schemaPath)`;
      }

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

${schemaLoadLua}
local diff = jade.Declarative.diff(current_schema, schema_def)
print(require("dkjson").encode(diff))
      `;

      const diff = await bridge.executeSafeJson(script, {
        configPath,
        envConfigPath,
        schemaPath,
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
