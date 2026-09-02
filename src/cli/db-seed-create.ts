import { Command } from "commander";
import * as path from "path";
import { Logger, AppError, handleError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { writeFile, ensureDir } from "../core/file-manager.js";
import { getDatabaseConfig } from "../core/multi-db.js";

/** Generate a 14-digit timestamp compatible with Jade's os.date("%Y%m%d%H%M%S") */
function jadeTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

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

        const timestamp = jadeTimestamp();
        const filename = `${timestamp}_${name}.lua`;
        const filePath = path.join(seedsDir, filename);

        const content = `-- Seed: ${name}
-- Created by Esmeralda
-- ${new Date().toISOString()}

return {
  {
    table = "users",
    data = {
      { name = "Admin User", email = "admin@example.com", active = true },
      { name = "Test User", email = "test@example.com", active = true },
    },
  },
}
`;

        writeFile(filePath, content);

        Logger.success(`Seed created: ${filename}`);
        Logger.info(`Edit: ${filePath}`);
      } catch (error: unknown) {
        handleError(error);
      }
    });
}
