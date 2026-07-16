import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

interface RollbackOptions {
  steps?: string;
}

export function registerMigrateRollback(migrate: Command): void {
  migrate
    .command("rollback")
    .description("Rollback last migration(s)")
    .option("-s, --steps <number>", "Number of migrations to rollback", "1")
    .action(async (options: RollbackOptions) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        const migrationsDir = path.join(projectRoot, "migrations");
        if (!fs.existsSync(migrationsDir)) {
          throw AppError.migrationsDirNotFound();
        }

        const steps = parseInt(options.steps || "1", 10);

        Logger.info(`Rolling back ${steps} migration(s)...`);

        const script = `
          local jade = require("jade")
          local config = dofile("${path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\")}")
          jade.configure(config)
          jade.migration.init(jade.driver())
          jade.migration.rollback(jade.driver(), ${steps})
        `;

        await exec("lua", ["-e", script]);
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