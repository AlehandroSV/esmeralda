import { Command } from "commander";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { writeFile, ensureDir } from "../core/file-manager.js";
import { getDatabaseConfig } from "../core/multi-db.js";

interface SeedCreateOptions {
  database?: string;
}

export function registerSeedCreate(db: Command): void {
  db
    .command("seed-create")
    .alias("sc")
    .description("Create a new seed file")
    .argument("[name]", "Seed name (without extension)")
    .option("-d, --database <name>", "Database to seed")
    .action(async (name?: string, options?: SeedCreateOptions) => {
      try {
        if (!name) {
          throw AppError.seedNameRequired();
        }

        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        // Get seeds directory based on database option
        let seedsDir: string;
        if (options?.database) {
          const dbConfig = getDatabaseConfig(projectRoot, options.database);
          if (!dbConfig) {
            throw new Error(`Database "${options.database}" not found in config.`);
          }
          seedsDir = dbConfig.seedsDir;
        } else {
          seedsDir = path.join(projectRoot, "seeds");
        }

        ensureDir(seedsDir);

        const timestamp = Date.now();
        const filename = `${timestamp}_${name}.lua`;
        const filePath = path.join(seedsDir, filename);

        const content = `-- Seed: ${name}
-- Created by Esmeralda
-- ${new Date().toISOString()}

local Jade = require("jade")

return {
  -- Simple format example: direct table inserts
  data = {
    {
      table = "users",
      data = {
        { name = "Admin User", email = "admin@example.com", active = true },
        { name = "Test User", email = "test@example.com", active = true },
      },
    },
  },

  -- Factory format example (optional): define factories for use with faker
  factories = {},

  -- Faker helpers (optional): return functions that generate random data
  -- faker = {
  --   name = function() return os.time() % 1000 .. "_user" end,
  --   email = function(name) return name .. "@example.com" end,
  -- }
}
`;

        writeFile(filePath, content);

        Logger.success(`Seed created: ${filename}`);
        Logger.info(`Edit: ${filePath}`);
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          Logger.error("Failed to create seed file:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}
