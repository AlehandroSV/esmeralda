import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError, handleError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { LuaBridge } from "../core/lua-bridge.js";
import { getConfigPathForEnv, LUA_CONFIG_LOAD } from "../core/config.js";

function hasDockerCompose(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "docker-compose.yml")) ||
         fs.existsSync(path.join(projectRoot, "docker-compose.yaml"));
}

interface RollbackOptions {
  steps?: string;
  database?: string;
}

export function registerMigrateRollback(migrate: Command): void {
  migrate
    .command("rollback")
    .description("Rollback last migration(s)")
    .option("-s, --steps <number>", "Number of migrations to rollback", "1")
    .option("-d, --database <name>", "Database to rollback")
    .action(async (options: RollbackOptions) => {
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

        const steps = parseInt(options.steps || "1", 10);
        const useDocker = hasDockerCompose(projectRoot);

        if (useDocker) {
          Logger.info("Using Docker for rollback");
        }

        Logger.info(`Rolling back ${steps} migration(s)...`);

        const bridge = new LuaBridge();
        const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);

        const script = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
jade.migration.init(jade.driver())
jade.migration.rollback(jade.driver(), ARGS.steps)
        `;

        if (useDocker) {
          await bridge.executeSafeDocker(script, { configPath, envConfigPath, steps }, projectRoot);
        } else {
          await bridge.executeSafe(script, { configPath, envConfigPath, steps });
        }

        Logger.success("Rollback complete!");
      } catch (error: unknown) {
        handleError(error instanceof AppError ? error : AppError.rollbackFailed(error as Error));
      }
    });
}
