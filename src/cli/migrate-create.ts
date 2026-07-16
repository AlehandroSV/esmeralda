import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { writeFile, ensureDir } from "../core/file-manager.js";

interface MigrateCreateOptions {
  name?: string;
}

export function registerMigrateCreate(migrate: Command): void {
  migrate
    .command("create")
    .description("Create a new empty migration file")
    .argument("[name]", "Migration name")
    .action(async (name?: string) => {
      try {
        if (!name) {
          throw AppError.migrationNameRequired();
        }

        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        const migrationsDir = path.join(projectRoot, "migrations");
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
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          Logger.error("Failed to create migration:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}