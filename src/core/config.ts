import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

export interface DatabaseConfig {
  driver: "postgresql" | "mysql" | "sqlite" | "mariadb";
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  schemaPath?: string;
  migrationPath?: string;
  seedPath?: string;
  max_connections?: number;
  role?: "primary" | "read";
  replicas?: DatabaseConfig[];
}

export interface JadeConfig {
  database: DatabaseConfig;
  databases?: Record<string, DatabaseConfig>;
  default?: string;
  schema?: { path: string };
  migrations?: { path: string };
  seeds?: { path: string };
}

const SUPPORTED_DRIVERS = ["postgresql", "mysql", "sqlite", "mariadb"];

/**
 * Lua snippet that loads config with environment-specific overrides.
 * Use in LuaBridge scripts: `LUA_CONFIG_LOAD + "\\n" + restOfScript`
 * Requires ARGS.configPath and ARGS.envConfigPath to be set.
 */
export const LUA_CONFIG_LOAD = `
local _ok, _cfg = pcall(dofile, ARGS.configPath)
if not _ok then io.stderr:write("Failed to load config: " .. tostring(_cfg)); os.exit(1) end
local _eok, _ecfg = pcall(dofile, ARGS.envConfigPath)
if _eok and type(_ecfg) == "table" then for _k, _v in pairs(_ecfg) do _cfg[_k] = _v end end
`;

/**
 * Parse jade.config.lua by executing it via Lua and returning the result as JSON.
 * Supports both single-database and multi-database config formats.
 * Also loads environment-specific overrides from jade.config.{env}.lua if JADE_ENV is set.
 */
export async function parseConfigFile(configPath: string): Promise<JadeConfig> {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const env = process.env.JADE_ENV || "development";
  const dir = path.dirname(configPath);
  const envConfigPath = path.join(dir, `jade.config.${env}.lua`);

  const script = `
local ok, config = pcall(dofile, ARGS.configPath)
if not ok then
  io.stderr:write("Failed to load config: " .. tostring(config) .. "\\n")
  os.exit(1)
end
if type(config) ~= "table" then
  io.stderr:write("Config file must return a table\\n")
  os.exit(1)
end

local envOk, envConfig = pcall(dofile, ARGS.envConfigPath)
if envOk and type(envConfig) == "table" then
  for k, v in pairs(envConfig) do
    config[k] = v
  end
end

local json = require("dkjson")
print(json.encode(config))
  `;

  try {
    const { stdout, stderr } = await exec("lua", [
      "-e",
      `ARGS = ${JSON.stringify({ configPath, envConfigPath })}\n${script}`,
    ]);

    const output = stdout.trim();
    if (!output) {
      throw new Error(stderr || "Config file returned empty output");
    }

    return JSON.parse(output);
  } catch (error: any) {
    if (error.message?.includes("Config file")) {
      throw error;
    }
    throw new Error(
      `Failed to parse config file: ${configPath}\n${error.message}`
    );
  }
}

/**
 * Apply environment variable overrides to database config.
 * Supports: JADE_DB_HOST, JADE_DB_PORT, JADE_DB_NAME, JADE_DB_USER, JADE_DB_PASSWORD, JADE_DB_DRIVER
 */
export function applyEnvOverrides(config: JadeConfig): JadeConfig {
  const result = { ...config };

  if (result.database) {
    result.database = { ...result.database };

    if (process.env.JADE_DB_HOST) result.database.host = process.env.JADE_DB_HOST;
    if (process.env.JADE_DB_PORT) result.database.port = parseInt(process.env.JADE_DB_PORT, 10);
    if (process.env.JADE_DB_NAME) result.database.database = process.env.JADE_DB_NAME;
    if (process.env.JADE_DB_USER) result.database.user = process.env.JADE_DB_USER;
    if (process.env.JADE_DB_PASSWORD) result.database.password = process.env.JADE_DB_PASSWORD;
    if (process.env.JADE_DB_DRIVER) {
      const driver = process.env.JADE_DB_DRIVER as DatabaseConfig["driver"];
      result.database.driver = driver;
    }
  }

  if (result.databases) {
    const overridden: Record<string, DatabaseConfig> = {};
    for (const [name, db] of Object.entries(result.databases)) {
      overridden[name] = { ...db };
      if (process.env.JADE_DB_HOST) overridden[name].host = process.env.JADE_DB_HOST;
      if (process.env.JADE_DB_PORT) overridden[name].port = parseInt(process.env.JADE_DB_PORT, 10);
      if (process.env.JADE_DB_NAME) overridden[name].database = process.env.JADE_DB_NAME;
      if (process.env.JADE_DB_USER) overridden[name].user = process.env.JADE_DB_USER;
      if (process.env.JADE_DB_PASSWORD) overridden[name].password = process.env.JADE_DB_PASSWORD;
    }
    result.databases = overridden;
  }

  return result;
}

/**
 * Validate a JadeConfig and return a list of error messages (empty if valid).
 */
export function validateConfig(config: JadeConfig): string[] {
  const errors: string[] = [];

  if (!config.database && !config.databases) {
    errors.push("database configuration is required");
    return errors;
  }

  if (config.database) {
    errors.push(...validateDatabaseConfig(config.database, "database"));
  }

  if (config.databases) {
    for (const [name, db] of Object.entries(config.databases)) {
      errors.push(...validateDatabaseConfig(db, `databases.${name}`));
    }
  }

  return errors;
}

function validateDatabaseConfig(db: DatabaseConfig, prefix: string): string[] {
  const errors: string[] = [];

  if (!db.driver) {
    errors.push(`${prefix}.driver is required`);
  } else if (!SUPPORTED_DRIVERS.includes(db.driver)) {
    errors.push(
      `${prefix}.driver "${db.driver}" is not supported (use: ${SUPPORTED_DRIVERS.join(", ")})`
    );
  }

  if (db.driver !== "sqlite") {
    if (!db.host) errors.push(`${prefix}.host is required for ${db.driver}`);
    if (!db.port) errors.push(`${prefix}.port is required for ${db.driver}`);
  }

  if (!db.database) {
    errors.push(`${prefix}.database is required`);
  }

  return errors;
}

/**
 * Get the resolved config file path for a project root.
 */
export function getConfigPath(projectRoot: string): string | null {
  for (const ext of [".lua", ".ts", ".js"]) {
    const candidate = path.join(projectRoot, `jade.config${ext}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Get config path and optional environment-specific override path.
 * CLI files can pass both to Lua scripts for env-aware config loading.
 */
export function getConfigPathForEnv(projectRoot: string): { configPath: string; envConfigPath: string } {
  const configPath = getConfigPath(projectRoot);
  if (!configPath) {
    throw new Error(
      `No jade.config.lua found in ${projectRoot}. Run 'esmeralda init' to create one.`
    );
  }
  const env = process.env.JADE_ENV || "development";
  const envConfigPath = path.join(projectRoot, `jade.config.${env}.lua`);
  return { configPath, envConfigPath };
}

/**
 * Load, parse, validate, and apply env overrides for the project config.
 * This is the main entry point for CLI commands.
 */
export async function loadConfig(projectRoot: string): Promise<JadeConfig> {
  const configPath = getConfigPath(projectRoot);
  if (!configPath) {
    throw new Error(
      `No jade.config.lua found in ${projectRoot}. Run 'esmeralda init' to create one.`
    );
  }

  const config = await parseConfigFile(configPath);
  const withOverrides = applyEnvOverrides(config);

  const validationErrors = validateConfig(withOverrides);
  if (validationErrors.length > 0) {
    throw new Error(
      `Invalid configuration:\n  - ${validationErrors.join("\n  - ")}`
    );
  }

  return withOverrides;
}

/**
 * Load config for a specific environment.
 * Sets JADE_ENV before loading, which triggers jade.config.{env}.lua overlay.
 */
export async function loadConfigForEnvironment(
  projectRoot: string,
  env: string
): Promise<JadeConfig> {
  const previous = process.env.JADE_ENV;
  process.env.JADE_ENV = env;
  try {
    return await loadConfig(projectRoot);
  } finally {
    if (previous !== undefined) {
      process.env.JADE_ENV = previous;
    } else {
      delete process.env.JADE_ENV;
    }
  }
}
