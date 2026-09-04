import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { LuaBridge } from "../core/lua-bridge.js";
import { getConfigPathForEnv, LUA_CONFIG_LOAD } from "../core/config.js";

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

        await bridge.executeSafe(script, {
          configPath,
          envConfigPath,
          steps,
        });

        Logger.success("Rollback complete!");
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          throw AppError.rollbackFailed(error);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}
