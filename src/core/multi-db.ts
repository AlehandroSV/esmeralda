import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface DatabaseConfig {
  name: string;
  driver: string;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  schemaPath?: string;
  migrationPath?: string;
  seedPath?: string;
  /** Max connections for this pool */
  max_connections?: number;
  /** "primary" or "read" — identifies read replicas when using jade.database.addReplicas() */
  role?: "primary" | "read";
  /** Replica configs registered via jade.database.addReplicas() */
  replicas?: DatabaseConfig[];
}

export interface MultiDbConfig {
  databases: Record<string, DatabaseConfig>;
  default?: string;
}

// Parse multi-database config from jade.config.lua
export function parseMultiDbConfig(projectRoot: string): MultiDbConfig | null {
  const configPath = path.join(projectRoot, "jade.config.lua");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  // Read and parse the config file
  const content = fs.readFileSync(configPath, "utf-8");

  // Check if it has multiple database definitions
  if (!content.includes("databases")) {
    return null;
  }

  // Use Lua to parse the config
  try {
    const script = `
      local config = dofile("${configPath.replace(/\\/g, "\\\\")}")
      local result = {}
      if config.databases then
        result.databases = {}
        for name, db in pairs(config.databases) do
          local entry = {
            name = name,
            driver = db.driver or "postgresql",
            host = db.host,
            port = db.port,
            database = db.database,
            user = db.user,
            password = db.password,
            schemaPath = db.schemaPath,
            migrationPath = db.migrationPath,
            seedPath = db.seedPath,
          }
          if db.max_connections then entry.max_connections = db.max_connections end
          if db.role then entry.role = db.role end
          if type(db.replicas) == "table" and #db.replicas > 0 then
            entry.replicas = {}
            for i, r in ipairs(db.replicas) do
              entry.replicas[i] = {
                name = r.name or ("replica_" .. i),
                driver = r.driver or db.driver or "postgresql",
                host = r.host,
                port = r.port,
                database = r.database or db.database,
                user = r.user,
                password = r.password,
                role = "read",
              }
            end
          end
          result.databases[name] = entry
        end
        result.default = config.default or next(config.databases)
      end
      return result
    `;
    const output = execSync(`lua -e "${script.replace(/"/g, '\\"')}"`, {
      cwd: projectRoot,
      encoding: "utf-8",
    });
    return JSON.parse(output);
  } catch {
    return null;
  }
}

// Get database config for a specific database name
export function getDatabaseConfig(
  projectRoot: string,
  dbName?: string
): { configPath: string; migrationsDir: string; seedsDir: string } | null {
  const multiDb = parseMultiDbConfig(projectRoot);

  if (multiDb && multiDb.databases) {
    const name = dbName || multiDb.default || Object.keys(multiDb.databases)[0];
    const db = multiDb.databases[name];
    if (!db) {
      return null;
    }

    return {
      configPath: path.join(projectRoot, "jade.config.lua"),
      migrationsDir: path.join(
        projectRoot,
        db.migrationPath || `migrations/${name}`
      ),
      seedsDir: path.join(projectRoot, db.seedPath || `seeds/${name}`),
    };
  }

  // Single database mode
  return {
    configPath: path.join(projectRoot, "jade.config.lua"),
    migrationsDir: path.join(projectRoot, "migrations"),
    seedsDir: path.join(projectRoot, "seeds"),
  };
}

// Get all database names
export function getDatabaseNames(projectRoot: string): string[] {
  const multiDb = parseMultiDbConfig(projectRoot);
  if (multiDb && multiDb.databases) {
    return Object.keys(multiDb.databases);
  }
  return [];
}
