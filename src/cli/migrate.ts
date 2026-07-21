import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

interface MigrateOptions {
  preview?: boolean;
  database?: string;
}

function hasDockerCompose(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "docker-compose.yml")) ||
         fs.existsSync(path.join(projectRoot, "docker-compose.yaml"));
}

async function runInDocker(script: string, projectRoot: string): Promise<{ stdout: string }> {
  // Find the api service name from docker-compose.yml
  const composeFile = fs.existsSync(path.join(projectRoot, "docker-compose.yml"))
    ? "docker-compose.yml" : "docker-compose.yaml";
  const composeContent = fs.readFileSync(path.join(projectRoot, composeFile), "utf-8");

  // Extract first service name (usually "api")
  const serviceMatch = composeContent.match(/^\s{2}(\w+):/m);
  const serviceName = serviceMatch ? serviceMatch[1] : "api";

  const luaBins = ["luajit", "lua5.4", "lua5.3", "lua5.1", "lua"];
  for (const bin of luaBins) {
    try {
      return await exec("docker", [
        "compose", "exec", "-T", serviceName,
        bin, "-e", script
      ], { cwd: projectRoot });
    } catch (err: any) {
      const msg = (err.message || "") + " " + (err.stderr || "") + " " + (err.stdout || "");
      if (msg.includes("executable file not found") || msg.includes("not found") || msg.includes("ENOENT")) continue;
      throw err;
    }
  }
  throw new Error("No Lua interpreter found in Docker container");
}

/** Escape a string for safe embedding in a Lua string literal */
function escapeLuaString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

async function runLocal(script: string): Promise<void> {
  // Try luajit first, then lua
  try {
    await exec("luajit", ["-e", script]);
  } catch {
    await exec("lua", ["-e", script]);
  }
}

export function registerMigrate(program: Command): Command {
  const migrate = program
    .command("migrate")
    .description("Run pending migrations")
    .option("-d, --database <name>", "Database to migrate (for multi-database)")
    .option("--preview", "Show SQL without executing")
    .action(async (options: MigrateOptions) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        // Get migrations directory based on database option
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

        // List migration files
        const files = fs.readdirSync(migrationsDir)
          .filter(f => f.endsWith(".lua") && !f.startsWith("_"))
          .sort();

        if (files.length === 0) {
          Logger.warn("No migrations found.");
          return;
        }

        const useDocker = hasDockerCompose(projectRoot);
        if (useDocker) {
          Logger.info("Using Docker to run migrations");
        }

        Logger.info(`Found ${files.length} migration(s)`);
        Logger.info("Running migrations...");

        // Execute each migration
        for (const file of files) {
          Logger.info(`  Applying: ${file}`);

          if (options.preview) {
            Logger.info(`    [preview] Would execute migration`);
            continue;
          }

          try {
            let configPath: string;
            let migrationPath: string;

            if (useDocker) {
              // Convert Windows paths to Docker container paths (/app/...)
              const relativeConfig = path.relative(projectRoot, path.join(projectRoot, "jade.config.lua")).replace(/\\/g, "/");
              const relativeMigration = path.relative(projectRoot, path.join(migrationsDir, file)).replace(/\\/g, "/");
              configPath = "/app/" + relativeConfig;
              migrationPath = "/app/" + relativeMigration;
            } else {
              configPath = path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\");
              migrationPath = path.join(migrationsDir, file).replace(/\\/g, "\\\\");
            }

            // Escape paths for safe embedding in Lua strings
            const safeConfigPath = escapeLuaString(configPath);
            const safeMigrationPath = escapeLuaString(migrationPath);
            const safeFileName = escapeLuaString(file);

            const script = `
local jade = require("jade")
local config = dofile("${safeConfigPath}")
jade.configure(config)
jade.migration.init(jade.driver())
local migration = dofile("${safeMigrationPath}")
migration.up()
local tracker = require("jade.migration.tracker")
tracker.recordMigration(jade.driver(), "${safeFileName}")
print("  OK: ${safeFileName}")
            `;

            if (useDocker) {
              await runInDocker(script, projectRoot);
            } else {
              await runLocal(script);
            }

            Logger.success(`  Applied: ${file}`);
          } catch (error: any) {
            throw AppError.migrationFailed(file, error);
          }
        }

        Logger.success("All migrations applied!");
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          Logger.error("Migration failed:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });

  // Status command
  migrate
    .command("status")
    .description("Show migration status")
    .action(async () => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        const migrationsDir = path.join(projectRoot, "migrations");
        if (!fs.existsSync(migrationsDir)) {
          throw AppError.migrationsDirNotFound();
        }

        // List migration files
        const files = fs.readdirSync(migrationsDir)
          .filter(f => f.endsWith(".lua") && !f.startsWith("_"))
          .sort();

        const useDocker = hasDockerCompose(projectRoot);

        // Get applied migrations from tracker
        let configPath: string;
        if (useDocker) {
          const relativeConfig = path.relative(projectRoot, path.join(projectRoot, "jade.config.lua")).replace(/\\/g, "/");
          configPath = "/app/" + relativeConfig;
        } else {
          configPath = path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\");
        }

        const safeConfigPath = escapeLuaString(configPath);

        const script = `
local jade = require("jade")
local config = dofile("${safeConfigPath}")
jade.configure(config)
jade.migration.init(jade.driver())
local tracker = require("jade.migration.tracker")
local applied = tracker.getAppliedMigrations(jade.driver())
local result = {}
for name, _ in pairs(applied) do
    table.insert(result, name)
end
table.sort(result)
print(require("dkjson").encode(result))
        `;

        let applied: string[] = [];
        if (useDocker) {
          const { stdout } = await runInDocker(script, projectRoot);
          applied = JSON.parse(stdout.trim());
        } else {
          const { stdout } = await exec("lua", ["-e", script]);
          applied = JSON.parse(stdout.trim());
        }

        // Show status
        Logger.info("Migration Status:");
        Logger.info("");

        const appliedSet = new Set(applied);

        for (const file of files) {
          if (appliedSet.has(file)) {
            Logger.success(`  ✓ ${file}`);
          } else {
            Logger.warn(`  ○ ${file} (pending)`);
          }
        }

        const pending = files.filter(f => !appliedSet.has(f));
        Logger.info("");
        Logger.info(`Applied: ${applied.length}, Pending: ${pending.length}`);
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          Logger.error("Failed to get migration status:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });

  return migrate;
}