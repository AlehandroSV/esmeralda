import { Command } from "commander";
import * as path from "path";
import { Logger } from "../utils/logger.js";
import { ensureDir, writeFile, fileExists } from "../core/file-manager.js";

interface InitOptions {
  name?: string;
}

function initInDirectory(targetPath: string, projectName: string): void {
  Logger.info(`Initializing Jade in: ${targetPath}`);

  // Create directories
  ensureDir(path.join(targetPath, "schema"));
  ensureDir(path.join(targetPath, "migrations"));
  ensureDir(path.join(targetPath, "seeds"));

  // Create jade.config.lua only if it doesn't exist
  const configPath = path.join(targetPath, "jade.config.lua");
  if (!fileExists(configPath)) {
    writeFile(
      configPath,
      `return {
    database = {
        driver = "postgresql",
        host = "localhost",
        port = 5432,
        database = "${projectName}",
        user = "postgres",
        password = ""
    }
}
`
    );
    Logger.info("  Created jade.config.lua");
  } else {
    Logger.info("  jade.config.lua already exists, skipping");
  }

  // Create schema/init.lua only if it doesn't exist
  const schemaInitPath = path.join(targetPath, "schema", "init.lua");
  if (!fileExists(schemaInitPath)) {
    writeFile(
      schemaInitPath,
      `-- Schema definitions
-- Require your entity files here

return {}
`
    );
    Logger.info("  Created schema/init.lua");
  } else {
    Logger.info("  schema/init.lua already exists, skipping");
  }
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize Jade in current directory or scaffold a new project")
    .option("-n, --name <name>", "Project name (creates a new directory)")
    .action(async (options: InitOptions) => {
      if (options.name) {
        // Mode 1: Create a new project directory
        const projectPath = path.resolve(process.cwd(), options.name);

        if (fileExists(projectPath)) {
          Logger.error(`Directory "${options.name}" already exists.`);
          Logger.info("Use `esmeralda init` inside it to initialize Jade.");
          return;
        }

        ensureDir(projectPath);
        initInDirectory(projectPath, options.name);

        Logger.success(`Project "${options.name}" created successfully!`);
        Logger.info("Next steps:");
        Logger.info(`  cd ${options.name}`);
        Logger.info("  Add your entities in schema/");
      } else {
        // Mode 2: Initialize Jade in the current directory
        const cwd = process.cwd();
        const dirName = path.basename(cwd);

        if (fileExists(path.join(cwd, "jade.config.lua"))) {
          Logger.warn("Jade is already initialized in this directory.");
          return;
        }

        initInDirectory(cwd, dirName);

        Logger.success("Jade initialized successfully!");
        Logger.info("Add your entities in schema/");
      }
    });
}
