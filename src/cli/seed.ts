import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { LuaBridge } from "../core/lua-bridge.js";

function hasDockerCompose(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "docker-compose.yml")) ||
         fs.existsSync(path.join(projectRoot, "docker-compose.yaml"));
}

export function registerSeed(db: Command): void {
  db
    .command("seed")
    .description("Run seed files")
    .argument("[name]", "Seed file name (without extension)")
    .option("-d, --database <name>", "Database to seed")
    .action(async (name?: string, options?: { database?: string }) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        let seedsDir: string;
        if (options?.database) {
          const { getDatabaseConfig } = await import("../core/multi-db.js");
          const dbConfig = getDatabaseConfig(projectRoot, options.database);
          if (!dbConfig) {
            throw new Error(`Database "${options.database}" not found in config.`);
          }
          seedsDir = dbConfig.seedsDir;
        } else {
          seedsDir = path.join(projectRoot, "seeds");
        }

        if (!fs.existsSync(seedsDir)) {
          throw AppError.seedsDirNotFound();
        }

        let files = fs.readdirSync(seedsDir).filter(f => f.endsWith(".lua"));

        if (name) {
          files = files.filter(f => f.includes(name));
        }

        if (files.length === 0) {
          Logger.warn("No seed files found.");
          return;
        }

        const useDocker = hasDockerCompose(projectRoot);
        if (useDocker) {
          Logger.info("Using Docker to run seeds");
        }

        Logger.info(`Running ${files.length} seed file(s)...`);

        const bridge = new LuaBridge();
        const configPath = path.join(projectRoot, "jade.config.lua");

        const script = `
local jade = require("jade")
local config = dofile(ARGS.configPath)
jade.configure(config)
dofile(ARGS.seedPath)
        `;

        for (const file of files) {
          Logger.info(`  Seeding: ${file}`);

          try {
            const seedPath = path.join(seedsDir, file);

            if (useDocker) {
              await bridge.executeSafeDocker(script, { configPath, seedPath }, projectRoot);
            } else {
              await bridge.executeSafe(script, { configPath, seedPath });
            }

            Logger.success(`  Seeded: ${file}`);
          } catch (error: any) {
            throw AppError.seedFailed(file, error);
          }
        }

        Logger.success("All seeds executed!");
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          Logger.error("Failed to run seeds:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}
