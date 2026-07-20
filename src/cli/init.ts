import { Command } from "commander";
import * as path from "path";
import * as readline from "readline";
import { Logger } from "../utils/logger.js";
import { ensureDir, writeFile, fileExists } from "../core/file-manager.js";

interface InitOptions {
  name?: string;
  yes?: boolean;
}

export interface DatabaseConfig {
  driver: "postgresql" | "mysql" | "sqlite";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const DEFAULT_CONFIG: DatabaseConfig = {
  driver: "postgresql",
  host: "localhost",
  port: 5432,
  database: "",
  user: "postgres",
  password: "",
};

const DRIVER_DEFAULTS: Record<string, { port: number; user: string }> = {
  postgresql: { port: 5432, user: "postgres" },
  mysql: { port: 3306, user: "root" },
  sqlite: { port: 0, user: "" },
};

export function promptUser(projectName: string): Promise<DatabaseConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string, defaultValue: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(`${question} (${defaultValue}): `, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  };

  return new Promise(async (resolve) => {
    try {
      Logger.info("Interactive initialization mode");
      Logger.info("Press Enter to accept defaults (shown in parentheses)\n");

      const name = await ask("Project name", projectName);
      const driver = (await ask("Database driver (postgresql, mysql, sqlite)", DEFAULT_CONFIG.driver)) as DatabaseConfig["driver"];
      const defaults = DRIVER_DEFAULTS[driver] || DRIVER_DEFAULTS.postgresql;

      const host = await ask("Database host", DEFAULT_CONFIG.host);
      const portStr = await ask("Database port", String(defaults.port));
      const port = parseInt(portStr, 10) || defaults.port;
      const dbUser = await ask("Database user", defaults.user);
      const password = await ask("Database password", DEFAULT_CONFIG.password);

      resolve({
        driver,
        host,
        port,
        database: name,
        user: dbUser,
        password,
      });
    } finally {
      rl.close();
    }
  });
}

export function generateConfigContent(projectName: string, config: DatabaseConfig): string {
  return `return {
    database = {
        driver = "${config.driver}",
        host = "${config.host}",
        port = ${config.port},
        database = "${config.database}",
        user = "${config.user}",
        password = "${config.password}"
    }
}
`;
}

export function initInDirectory(
  targetPath: string,
  projectName: string,
  config?: DatabaseConfig
): void {
  Logger.info(`Initializing Jade in: ${targetPath}`);

  // Create directories
  ensureDir(path.join(targetPath, "schema"));
  ensureDir(path.join(targetPath, "migrations"));
  ensureDir(path.join(targetPath, "seeds"));

  // Create jade.config.lua only if it doesn't exist
  const configPath = path.join(targetPath, "jade.config.lua");
  if (!fileExists(configPath)) {
    const dbConfig = config || { ...DEFAULT_CONFIG, database: projectName };
    writeFile(configPath, generateConfigContent(projectName, dbConfig));
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
    .option("-y, --yes", "Skip prompts and use defaults")
    .action(async (options: InitOptions) => {
      try {
        if (options.name) {
          // Mode 1: Create a new project directory (non-interactive)
          const projectPath = path.resolve(process.cwd(), options.name);

          if (fileExists(projectPath)) {
            Logger.error(`Directory "${options.name}" already exists.`);
            Logger.info("Use `esmeralda init` inside it to initialize Jade.");
            return;
          }

          ensureDir(projectPath);

          let config: DatabaseConfig | undefined;
          if (options.yes) {
            config = { ...DEFAULT_CONFIG, database: options.name };
          }

          initInDirectory(projectPath, options.name, config);

          Logger.success(`Project "${options.name}" created successfully!`);
          Logger.info("Next steps:");
          Logger.info(`  cd ${options.name}`);
          Logger.info("  Add your entities in schema/");
        } else {
          // Mode 2: Initialize Jade in the current directory
          const cwd = process.cwd();
          const dirName = path.basename(cwd);

          let config: DatabaseConfig | undefined;

          if (options.yes) {
            // Use defaults without prompting
            config = { ...DEFAULT_CONFIG, database: dirName };
          } else if (process.stdin.isTTY) {
            // Interactive mode: prompt user for configuration
            config = await promptUser(dirName);
          }
          // If not TTY and no --yes, use defaults (pipe/CI mode)

          initInDirectory(cwd, dirName, config);

          Logger.success("Jade initialized successfully!");
          Logger.info("Add your entities in schema/");
        }
      } catch (error: any) {
        Logger.error("Failed to initialize Jade:");
        Logger.error(error.message);
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}
