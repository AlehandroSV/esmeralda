import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

interface RollbackOptions {
  steps?: string;
}

export function registerMigrateRollback(program: Command): void {
  program
    .command("migrate rollback")
    .description("Rollback last migration(s)")
    .option("-s, --steps <number>", "Number of migrations to rollback", "1")
    .action(async (options: RollbackOptions) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        Logger.error("Not a Jade project. Run 'esmeralda init' first.");
        process.exit(1);
      }

      const migrationsDir = path.join(projectRoot, "migrations");
      if (!fs.existsSync(migrationsDir)) {
        Logger.error("Migrations directory not found.");
        return;
      }

      const steps = parseInt(options.steps || "1", 10);

      Logger.info(`Rolling back ${steps} migration(s)...`);

      try {
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
        Logger.error("Rollback failed:");
        Logger.error(error.message);
        process.exit(1);
      }
    });
}
