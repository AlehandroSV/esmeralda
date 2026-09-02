import { Command } from "commander";
import * as path from "path";
import { Logger, AppError, handleError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { writeFile, ensureDir } from "../core/file-manager.js";

interface MigrateCreateOptions {
  name?: string;
  database?: string;
}

export function registerMigrateCreate(migrate: Command): void {
  migrate
    .command("create")
    .description("Create a new empty migration file")
    .argument("[name]", "Migration name")
    .option("-d, --database <name>", "Database to create migration for")
    .action(async (name?: string, options?: MigrateCreateOptions) => {
      try {
        if (!name) {
          throw AppError.migrationNameRequired();
        }

        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        // Get migrations directory based on database option
        let migrationsDir: string;
        if (options?.database) {
          const { getDatabaseConfig } = await import("../core/multi-db.js");
          const dbConfig = getDatabaseConfig(projectRoot, options.database);
          if (!dbConfig) {
            throw new Error(`Database "${options.database}" not found in config.`);
          }
          migrationsDir = dbConfig.migrationsDir;
        } else {
          migrationsDir = path.join(projectRoot, "migrations");
        }

        ensureDir(migrationsDir);

        const timestamp = Date.now();
        const filename = `${timestamp}_${name}.lua`;
        const filePath = path.join(migrationsDir, filename);

        const content = `-- Migration: ${name}
-- Created by Esmeralda
-- ${new Date().toISOString()}

local Jade = require("jade")

local M = {}

function M.up()
    -- TODO: implement up migration
end

function M.down()
    -- TODO: implement down migration
end

return M
`;

        writeFile(filePath, content);

        Logger.success(`Migration created: ${filename}`);
        Logger.info(`Edit: ${filePath}`);
      } catch (error: unknown) {
        handleError(error);
      }
    });
}