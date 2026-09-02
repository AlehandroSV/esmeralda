import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError, handleError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { LuaBridge } from "../core/lua-bridge.js";
import { getConfigPathForEnv, LUA_CONFIG_LOAD } from "../core/config.js";

interface MigrateOptions {
  preview?: boolean;
  database?: string;
}

function hasDockerCompose(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "docker-compose.yml")) ||
         fs.existsSync(path.join(projectRoot, "docker-compose.yaml"));
}

export function registerMigrate(program: Command): Command {
  const migrate = program
    .command("migrate")
    .description("Run pending migrations")
    .option("-d, --database <name>", "Database to migrate (for multi-database)")
    .option("--preview", "Show SQL without executing")
    .action(async (options: MigrateOptions) => {
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
          return;
        }

        const useDocker = hasDockerCompose(projectRoot);
        if (useDocker) {
          Logger.info("Using Docker to run migrations");
        }

        Logger.info(`Found ${files.length} migration(s)`);
        Logger.info("Running migrations...");

        const bridge = new LuaBridge();
        const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);

        const script = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
jade.migration.init(jade.driver())
local migration = dofile(ARGS.migrationPath)
migration.up()
local tracker = require("jade.migration.tracker")
tracker.recordMigration(jade.driver(), ARGS.fileName)
print("  OK: " .. ARGS.fileName)
        `;

        for (const file of files) {
          Logger.info(`  Applying: ${file}`);

          if (options.preview) {
            Logger.info(`    [preview] Would execute migration`);
            continue;
          }

          try {
            const migrationPath = path.join(migrationsDir, file);

            if (useDocker) {
              await bridge.executeSafeDocker(script, {
                configPath,
                envConfigPath,
                migrationPath,
                fileName: file,
              }, projectRoot);
            } else {
              await bridge.executeSafe(script, {
                configPath,
                envConfigPath,
                migrationPath,
                fileName: file,
              });
            }

            Logger.success(`  Applied: ${file}`);
          } catch (error: any) {
            throw AppError.migrationFailed(file, error);
          }
        }

        Logger.success("All migrations applied!");
      } catch (error: unknown) {
        handleError(error);
      }
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
        const bridge = new LuaBridge();
        const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);

        const script = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
jade.migration.init(jade.driver())
local tracker = require("jade.migration.tracker")
local applied = tracker.getAppliedMigrations(jade.driver())
local result = {}
for name, _ in pairs(applied) do
    table.insert(result, name)
end
table.sort(result)
print(require("dkjson").encode(result))
        `;

        let applied: string[];
        if (useDocker) {
          applied = await bridge.executeSafeDockerJson(script, { configPath, envConfigPath }, projectRoot);
        } else {
          applied = await bridge.executeSafeJson(script, { configPath, envConfigPath });
        }

        Logger.info("Migration Status:");
        Logger.info("");

        const appliedSet = new Set(applied);

        for (const file of files) {
          if (appliedSet.has(file)) {
            Logger.success(`  ✓ ${file}`);
          } else {
            Logger.warn(`  ○ ${file} (pending)`);
          }
        }

        const pending = files.filter(f => !appliedSet.has(f));
        Logger.info("");
        Logger.info(`Applied: ${applied.length}, Pending: ${pending.length}`);
      } catch (error: unknown) {
        handleError(error);
      }
    });

  return migrate;
}
