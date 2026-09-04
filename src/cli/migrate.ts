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

interface RollbackOptions {
  steps?: number;
  database?: string;
}

function hasDockerCompose(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "docker-compose.yml")) ||
         fs.existsSync(path.join(projectRoot, "docker-compose.yaml"));
}

async function runInDocker(script: string, projectRoot: string): Promise<{ stdout: string }> {
  const composeFile = fs.existsSync(path.join(projectRoot, "docker-compose.yml"))
    ? "docker-compose.yml" : "docker-compose.yaml";
  const composeContent = fs.readFileSync(path.join(projectRoot, composeFile), "utf-8");

  const serviceMatch = composeContent.match(/^\s{2}(\w+):/m);
  const serviceName = serviceMatch ? serviceMatch[1] : "api";

  const luaBins = ["luajit", "lua5.4", "lua5.3", "lua5.1", "lua"];
  let luaBin = luaBins[0];

  for (const bin of luaBins) {
    try {
      await exec("docker", [
        "compose", "exec", "-T", serviceName,
        "sh", "-c", `which ${bin} 2>/dev/null`
      ], { cwd: projectRoot });
      luaBin = bin;
      break;
    } catch {
      continue;
    }
  }

  return await exec("docker", [
    "compose", "exec", "-T", serviceName,
    luaBin, "-e", script
  ], { cwd: projectRoot });
}

function escapeLuaString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

async function runLocal(script: string): Promise<void> {
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

        if (options.preview) {
          Logger.info("Pending migrations:");
          for (const file of files) {
            Logger.info(`  - ${file}`);
          }
          return;
        }

        Logger.info("Running migrations via Jade...");

        // Delegate to Jade's migration system for atomicity
        const configPath = useDocker
          ? "/app/" + path.relative(projectRoot, path.join(projectRoot, "jade.config.lua")).replace(/\\/g, "/")
          : path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\");

        const migrationsPath = useDocker
          ? "/app/" + path.relative(projectRoot, migrationsDir).replace(/\\/g, "/")
          : migrationsDir.replace(/\\/g, "\\\\");

        const safeConfigPath = escapeLuaString(configPath);
        const safeMigrationsPath = escapeLuaString(migrationsPath);

        // Use Jade's migration.migrate() which handles atomicity and tracking
        const script = `
local jade = require("jade")
local config = dofile("${safeConfigPath}")
jade.configure(config)
jade.migration.init(jade.driver())

local tracker = require("jade.migration.tracker")
local applied = tracker.getAppliedMigrations(jade.driver())

-- Scan migration files
local files = {}
local dir = "${safeMigrationsPath}"
local pfile = io.popen('ls "' .. dir .. '" 2>/dev/null || dir "' .. dir .. '" /b 2>nul')
if pfile then
  for fname in pfile:lines() do
    if fname:match("%.lua$") and not fname:match("^_") then
      files[#files + 1] = fname
    end
  end
  pfile:close()
end
table.sort(files)

-- Filter pending
local pending = {}
for _, f in ipairs(files) do
  if not applied[f] then
    pending[#pending + 1] = f
  end
end

if #pending == 0 then
  print("No pending migrations")
  os.exit(0)
end

-- Apply each pending migration using Jade's runner for atomicity
local migration_runner = require("jade.migration.runner")
local success_count = 0
for _, fname in ipairs(pending) do
  local fpath = dir .. "/" .. fname
  local migration = dofile(fpath)
  local ok, err = pcall(function()
    migration_runner.run(jade.driver(), migration, "up")
  end)
  if ok then
    tracker.recordMigration(jade.driver(), fname)
    success_count = success_count + 1
    print("  Applied: " .. fname)
  else
    print("  FAILED: " .. fname .. " - " .. tostring(err))
    os.exit(1)
  end
end

print("Applied " .. success_count .. " migration(s)")
        `;

        if (useDocker) {
          await runInDocker(script, projectRoot);
        } else {
          await runLocal(script);
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

  // Rollback command
  migrate
    .command("rollback")
    .description("Rollback the last N migrations")
    .option("-n, --steps <number>", "Number of migrations to rollback", "1")
    .option("-d, --database <name>", "Database to rollback")
    .action(async (options: RollbackOptions) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        const steps = parseInt(String(options.steps), 10) || 1;
        const useDocker = hasDockerCompose(projectRoot);

        const configPath = useDocker
          ? "/app/" + path.relative(projectRoot, path.join(projectRoot, "jade.config.lua")).replace(/\\/g, "/")
          : path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\");

        const safeConfigPath = escapeLuaString(configPath);

        Logger.info(`Rolling back ${steps} migration(s) via Jade...`);

        const script = `
local jade = require("jade")
local config = dofile("${safeConfigPath}")
jade.configure(config)
jade.migration.init(jade.driver())

local result = jade.migration.rollback(jade.driver(), { steps = ${steps} })
for _, r in ipairs(result) do
  if r.success then
    print("  Rolled back: " .. r.name)
  else
    print("  FAILED: " .. r.name .. " - " .. tostring(r.error))
  end
end
        `;

        if (useDocker) {
          await runInDocker(script, projectRoot);
        } else {
          await runLocal(script);
        }

        Logger.success("Rollback complete!");
      } catch (error: any) {
        Logger.error("Rollback failed:");
        Logger.error(error.message);
        if (process.env.DEBUG) console.error(error.stack);
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

        const files = fs.readdirSync(migrationsDir)
          .filter(f => f.endsWith(".lua") && !f.startsWith("_"))
          .sort();

        const useDocker = hasDockerCompose(projectRoot);

        const configPath = useDocker
          ? "/app/" + path.relative(projectRoot, path.join(projectRoot, "jade.config.lua")).replace(/\\/g, "/")
          : path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\");

        const safeConfigPath = escapeLuaString(configPath);

        // Use Jade's migration.status() which is driver-aware
        const script = `
local jade = require("jade")
local config = dofile("${safeConfigPath}")
jade.configure(config)
jade.migration.init(jade.driver())
local status = jade.migration.status(jade.driver())
print(require("dkjson").encode(status))
        `;

        let statusResult: { executed: string[]; pending: string[] };
        if (useDocker) {
          const { stdout } = await runInDocker(script, projectRoot);
          statusResult = JSON.parse(stdout.trim());
        } else {
          const { stdout } = await exec("lua", ["-e", script]);
          statusResult = JSON.parse(stdout.trim());
        }

        Logger.info("Migration Status:");
        Logger.info("");

        const appliedSet = new Set(statusResult.executed);

        for (const file of files) {
          if (appliedSet.has(file)) {
            Logger.success(`  ✓ ${file}`);
          } else {
            Logger.warn(`  ○ ${file} (pending)`);
          }
        }

        Logger.info("");
        Logger.info(`Applied: ${statusResult.executed.length}, Pending: ${statusResult.pending.length}`);
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
