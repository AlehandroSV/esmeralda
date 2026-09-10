import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { LuaBridge, LUA_JSON_ENCODER } from "../core/lua-bridge.js";
import { getConfigPathForEnv, LUA_CONFIG_LOAD } from "../core/config.js";

function findSchemaFile(projectRoot: string): string | null {
  const schemaDir = path.join(projectRoot, "schema");
  if (fs.existsSync(schemaDir)) {
    const jadeFiles = fs.readdirSync(schemaDir).filter(f => f.endsWith(".jade"));
    if (jadeFiles.length > 0) {
      return path.join(schemaDir, jadeFiles[0]);
    }
  }
  return null;
}

function findJadeSource(projectRoot: string): string | null {
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
  const envPath = process.env.JADE_PATH;
  if (envPath && fs.existsSync(path.join(envPath, "jade", "init.lua"))) {
    return envPath;
  }
  return null;
}

export function registerDev(program: Command): void {
  program
    .command("dev")
    .description("Watch .jade schema and auto-regenerate on changes")
    .option("-f, --file <path>", "Schema file path (default: auto-detect)")
    .option("--run", "Auto-run migrations on change")
    .action(async (options: { file?: string; run?: boolean }) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        const schemaPath = options.file
          ? path.resolve(projectRoot, options.file)
          : findSchemaFile(projectRoot);

        if (!schemaPath || !fs.existsSync(schemaPath)) {
          Logger.error("No .jade schema file found.");
          Logger.info("Create schema/models.jade or specify with -f");
          process.exit(1);
        }

        Logger.info(`Watching: ${path.relative(projectRoot, schemaPath)}`);
        Logger.info("Press Ctrl+C to stop\n");

        let lastContent = fs.readFileSync(schemaPath, "utf-8");
        let debounceTimer: NodeJS.Timeout | null = null;

        // Initial generate
        await runGenerate(projectRoot, schemaPath, options.run);

        // Watch for changes
        fs.watch(schemaPath, { persistent: true }, (eventType) => {
          if (eventType !== "change") return;

          // Debounce: wait 300ms for file to stabilize
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            try {
              const currentContent = fs.readFileSync(schemaPath, "utf-8");
              if (currentContent === lastContent) return;
              lastContent = currentContent;

              Logger.info(`\nChange detected in ${path.basename(schemaPath)}`);
              await runGenerate(projectRoot!, schemaPath, options.run);
            } catch (err: any) {
              Logger.error(`Generate failed: ${err.message}`);
            }
          }, 300);
        });

        // Keep process alive
        await new Promise(() => {});
      } catch (error: unknown) {
        if (error instanceof AppError) {
          Logger.error(error.message);
        } else {
          Logger.error(String(error));
        }
        process.exit(1);
      }
    });
}

async function runGenerate(
  projectRoot: string,
  schemaPath: string,
  autoRun?: boolean
): Promise<void> {
  const jadeSrc = findJadeSource(projectRoot);
  const luaPackagePath = [
    projectRoot.replace(/\\/g, "/") + "/?.lua",
    projectRoot.replace(/\\/g, "/") + "/?/init.lua",
    ...(jadeSrc ? [jadeSrc.replace(/\\/g, "/") + "/?.lua", jadeSrc.replace(/\\/g, "/") + "/?/init.lua"] : []),
  ].join(";");

  const bridge = new LuaBridge("lua", luaPackagePath);
  const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);
  const migrationName = "auto_" + Date.now();

  const script = `
${LUA_JSON_ENCODER}
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
local f = io.open(ARGS.schemaDefPath, "r")
if not f then error("Cannot open: " .. ARGS.schemaDefPath) end
local content = f:read("*a")
f:close()
local schema = jade.Declarative.parsedeclarativeSchema(content)
local model_files = jade.Declarative.generateAllModels(schema)
local migration = jade.Declarative.generateMigration(schema, ARGS.migrationName)
local result = { models = {}, migration = migration }
for filename, file_content in pairs(model_files) do
    table.insert(result.models, { filename = filename, content = file_content })
end
print(_json_encode(result))
  `;

  const result: { models: Array<{ filename: string; content: string }>; migration: string } =
    await bridge.executeSafeJson(script, {
      configPath,
      envConfigPath,
      schemaDefPath: schemaPath,
      migrationName,
    });

  // Write models
  const modelsDir = path.join(projectRoot, "jade", "generated");
  fs.mkdirSync(modelsDir, { recursive: true });
  for (const file of result.models) {
    fs.writeFileSync(path.join(modelsDir, file.filename), file.content, "utf-8");
  }

  // Write migration
  const timestamp = Date.now().toString();
  const migrationDir = path.join(projectRoot, "migrations");
  fs.mkdirSync(migrationDir, { recursive: true });
  const migrationFile = path.join(migrationDir, `${timestamp}_${migrationName}.lua`);
  fs.writeFileSync(migrationFile, result.migration, "utf-8");

  Logger.success(`Regenerated ${result.models.length} model(s) + migration`);

  // Auto-run migration if --run
  if (autoRun) {
    const runScript = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
jade.migration.init(jade.driver())
local migration = dofile(ARGS.migrationPath)
migration.up()
    `;
    await bridge.executeSafe(runScript, {
      configPath,
      envConfigPath,
      migrationPath: migrationFile.replace(/\\/g, "/"),
    });
    Logger.info("  Migration applied");
  }
}
