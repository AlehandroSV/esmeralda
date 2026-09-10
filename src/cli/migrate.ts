import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { LuaBridge, LUA_JSON_ENCODER } from "../core/lua-bridge.js";

interface MigrateOptions {
  preview?: boolean;
  database?: string;
}

function hasDockerCompose(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "docker-compose.yml")) ||
         fs.existsSync(path.join(projectRoot, "docker-compose.yaml"));
}


async function runPendingMigrations(options: MigrateOptions): Promise<void> {
  try {
    const projectRoot = findProjectRoot();
    if (!projectRoot) {
      throw AppError.notInitialized();
    }

    let migrationsDir: string;
    if (options.database) {
      const { getDatabaseConfig } = await import("../core/multi-db.js");
      const dbConfig = getDatabaseConfig(projectRoot, options.database);
      if (!dbConfig) {
        throw new Error(`Database "${options.database}" not found in config.`);
      }
      migrationsDir = dbConfig.migrationsDir;
    } else {
      migrationsDir = path.join(projectRoot, "migrations");
    }

    if (!fs.existsSync(migrationsDir)) {
      throw AppError.migrationsDirNotFound();
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith(".lua") && !f.startsWith("_"))
      .sort();

    if (files.length === 0) {
      Logger.warn("No migrations found.");
      Logger.info("Run `esmeralda generate` to create migrations from schema/models.jade");
      return;
    }

    const useDocker = hasDockerCompose(projectRoot);
    if (useDocker) {
      Logger.info("Using Docker to run migrations");
    }

    Logger.info(`Found ${files.length} migration(s)`);

    if (options.preview) {
      Logger.info("Pending migrations:");
      for (const file of files) {
        Logger.info(`  - ${file}`);
      }
      return;
    }

    Logger.info("Running migrations via Jade...");

    const configPath = path.join(projectRoot, "jade.config.lua");
    const bridge = new LuaBridge();

    // Use Jade's migration.migrate() which handles atomicity and tracking
    const script = `
local jade = require("jade")
local config = dofile(ARGS.configPath)
jade.configure(config)
jade.migration.init(jade.driver())

local tracker = require("jade.migration.tracker")
local applied = tracker.getAppliedMigrations(jade.driver())

-- Scan migration files
local files = {}
local dir = ARGS.migrationsPath
local pfile = io.popen('ls "' .. dir .. '" 2>/dev/null || dir "' .. dir .. '" /b 2>nul')
if pfile then
  for fname in pfile:lines() do
    if fname:match("%.lua$") and not fname:match("^_") then
      files[#files + 1] = fname
    end
  end
  pfile:close()
end
table.sort(files)

-- Filter pending
local pending = {}
for _, f in ipairs(files) do
  if not applied[f] then
    pending[#pending + 1] = f
  end
end

if #pending == 0 then
  print("No pending migrations")
  os.exit(0)
end

-- Apply each pending migration using Jade's runner for atomicity
local migration_runner = require("jade.migration.runner")
local success_count = 0
for _, fname in ipairs(pending) do
  local fpath = dir .. "/" .. fname
  local migration = dofile(fpath)
  local ok, err = pcall(function()
    migration_runner.run(jade.driver(), migration, "up")
  end)
  if ok then
    tracker.recordMigration(jade.driver(), fname)
    success_count = success_count + 1
    print("  Applied: " .. fname)
  else
    print("  FAILED: " .. fname .. " - " .. tostring(err))
    os.exit(1)
  end
end

print("Applied " .. success_count .. " migration(s)")
        `;

    if (useDocker) {
      await bridge.executeSafeDocker(script, { configPath, migrationsPath: migrationsDir }, projectRoot);
    } else {
      await bridge.executeSafe(script, { configPath, migrationsPath: migrationsDir });
    }

    Logger.success("All migrations applied!");
  } catch (error: any) {
    if (error instanceof AppError) {
      Logger.error(error.message);
      if (error.suggestion) {
        Logger.info(`Suggestion: ${error.suggestion}`);
      }
    } else {
      Logger.error("Migration failed:");
      Logger.error(error.message);
    }
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

export function registerMigrate(program: Command): Command {
  const migrate = program
    .command("migrate")
    .description("Run pending migrations (dev). Prefer `esmeralda migrate dev` in scripts.")
    .option("-d, --database <name>", "Database to migrate (for multi-database)")
    .option("--preview", "Show SQL without executing")
    .action(async (options: MigrateOptions) => {
      await runPendingMigrations(options);
    });

  // Explicit development entrypoint (Prisma-like surface)
  migrate
    .command("dev")
    .description("Apply pending migrations to the development database")
    .option("-d, --database <name>", "Database to migrate (for multi-database)")
    .option("--preview", "Show pending migrations without executing")
    .action(async (options: MigrateOptions) => {
      await runPendingMigrations(options);
    });

  // Status command
  migrate
    .command("status")
    .description("Show migration status")
    .action(async () => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        const migrationsDir = path.join(projectRoot, "migrations");
        if (!fs.existsSync(migrationsDir)) {
          throw AppError.migrationsDirNotFound();
        }

        const files = fs.readdirSync(migrationsDir)
          .filter(f => f.endsWith(".lua") && !f.startsWith("_"))
          .sort();

        const useDocker = hasDockerCompose(projectRoot);
        const configPath = path.join(projectRoot, "jade.config.lua");
        const bridge = new LuaBridge();

        // Use Jade's migration.status() which is driver-aware
        const script = `
${LUA_JSON_ENCODER}
local jade = require("jade")
local config = dofile(ARGS.configPath)
jade.configure(config)
jade.migration.init(jade.driver())
local status = jade.migration.status(jade.driver())
print(_json_encode(status))
        `;

        let statusResult: { executed: string[]; pending: string[] };
        if (useDocker) {
          statusResult = await bridge.executeSafeDockerJson(script, { configPath }, projectRoot);
        } else {
          statusResult = await bridge.executeSafeJson(script, { configPath });
        }

        Logger.info("Migration Status:");
        Logger.info("");

        const appliedSet = new Set(statusResult.executed);

        for (const file of files) {
          if (appliedSet.has(file)) {
            Logger.success(`  ✓ ${file}`);
          } else {
            Logger.warn(`  ○ ${file} (pending)`);
          }
        }

        Logger.info("");
        Logger.info(`Applied: ${statusResult.executed.length}, Pending: ${statusResult.pending.length}`);
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          Logger.error("Failed to get migration status:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });

  return migrate;
}
