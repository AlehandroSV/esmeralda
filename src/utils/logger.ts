export class Logger {
  static info(message: string): void {
    console.log(`\x1b[36m[info]\x1b[0m ${message}`);
  }

  static success(message: string): void {
    console.log(`\x1b[32m[success]\x1b[0m ${message}`);
  }

  static warn(message: string): void {
    console.log(`\x1b[33m[warn]\x1b[0m ${message}`);
  }

  static error(message: string): void {
    console.error(`\x1b[31m[error]\x1b[0m ${message}`);
  }

  static sql(sql: string): void {
    console.log(`\x1b[35m[sql]\x1b[0m ${sql}`);
  }

  static debug(message: string): void {
    if (process.env.DEBUG) {
      console.log(`\x1b[90m[debug]\x1b[0m ${message}`);
    }
  }
}

export class AppError extends Error {
  code: string;
  suggestion?: string;

  constructor(code: string, message: string, suggestion?: string) {
    super(message);
    this.code = code;
    this.suggestion = suggestion;
    this.name = "AppError";
  }

  static notInitialized(): AppError {
    return new AppError(
      "NOT_INITIALIZED",
      "Not a Jade project — no jade.config.lua found.",
      "Run 'esmeralda init' in your project directory to create one."
    );
  }

  static migrationsDirNotFound(): AppError {
    return new AppError(
      "MIGRATIONS_DIR_NOT_FOUND",
      "Migrations directory not found.",
      "Create a 'migrations/' directory or run 'esmeralda init'."
    );
  }

  static schemaDirNotFound(): AppError {
    return new AppError(
      "SCHEMA_DIR_NOT_FOUND",
      "Schema directory not found.",
      "Create a 'schema/' directory or run 'esmeralda init'."
    );
  }

  static seedsDirNotFound(): AppError {
    return new AppError(
      "SEEDS_DIR_NOT_FOUND",
      "Seeds directory not found.",
      "Create a 'seeds/' directory or run 'esmeralda init'."
    );
  }

  static migrationNameRequired(): AppError {
    return new AppError(
      "MIGRATION_NAME_REQUIRED",
      "Migration name is required.",
      "Usage: esmeralda migrate create <name>"
    );
  }

  static migrationFailed(file: string, originalError: Error): AppError {
    return new AppError(
      "MIGRATION_FAILED",
      `Migration failed: ${file}`,
      `Check the migration file for syntax errors.\n  Original error: ${originalError.message}`
    );
  }

  static rollbackFailed(originalError: Error): AppError {
    return new AppError(
      "ROLLBACK_FAILED",
      "Rollback failed.",
      `Check if the migration has a down() function.\n  Original error: ${originalError.message}`
    );
  }

  static introspectionFailed(originalError: Error): AppError {
    return new AppError(
      "INTROSPECTION_FAILED",
      "Failed to introspect database.",
      `Check your database connection in jade.config.lua.\n  Original error: ${originalError.message}`
    );
  }

  static pushFailed(originalError: Error): AppError {
    return new AppError(
      "PUSH_FAILED",
      "Failed to push schema to database.",
      `Check your schema files for syntax errors.\n  Original error: ${originalError.message}`
    );
  }

  static seedFailed(file: string, originalError: Error): AppError {
    return new AppError(
      "SEED_FAILED",
      `Seed failed: ${file}`,
      `Check the seed file for syntax errors.\n  Original error: ${originalError.message}`
    );
  }

  static seedNameRequired(): AppError {
    return new AppError(
      "SEED_NAME_REQUIRED",
      "Seed name is required.",
      "Usage: esmeralda db seed-create <name>"
    );
  }

  static dockerNotAvailable(): AppError {
    return new AppError(
      "DOCKER_NOT_AVAILABLE",
      "Docker is not available.",
      "Install Docker (https://docs.docker.com/get-docker/) or remove docker-compose.yml to run locally."
    );
  }

  static luaNotAvailable(): AppError {
    return new AppError(
      "LUA_NOT_AVAILABLE",
      "Lua/LuaJIT not found in PATH.",
      "Install Lua (https://www.lua.org/download.html) or LuaJIT (https://luajit.org/download.html)."
    );
  }

  static databaseConnectionFailed(originalError: Error): AppError {
    return new AppError(
      "DATABASE_CONNECTION_FAILED",
      "Failed to connect to database.",
      `Check your database config in jade.config.lua.\n  Possible causes: database not running, wrong host/port, wrong credentials.\n  Original error: ${originalError.message}`
    );
  }

  static databaseQueryFailed(sql: string, originalError: Error): AppError {
    return new AppError(
      "DATABASE_QUERY_FAILED",
      `Query failed: ${sql.substring(0, 100)}...`,
      `Check the SQL syntax.\n  Original error: ${originalError.message}`
    );
  }

  static configNotFound(projectRoot: string): AppError {
    return new AppError(
      "CONFIG_NOT_FOUND",
      `No jade.config.lua found in ${projectRoot}.`,
      "Run 'esmeralda init' to create a new project."
    );
  }

  static configParseFailed(configPath: string, originalError: Error): AppError {
    return new AppError(
      "CONFIG_PARSE_FAILED",
      `Failed to parse config: ${configPath}`,
      `Check the Lua syntax in jade.config.lua.\n  Original error: ${originalError.message}`
    );
  }

  static configInvalid(errors: string[]): AppError {
    return new AppError(
      "CONFIG_INVALID",
      "Invalid configuration.",
      `Fix the following issues in jade.config.lua:\n  - ${errors.join("\n  - ")}`
    );
  }

  static databaseNotFound(name: string): AppError {
    return new AppError(
      "DATABASE_NOT_FOUND",
      `Database "${name}" not found in config.`,
      `Check the 'databases' section in jade.config.lua.\n  Available databases can be listed with: esmeralda migrate status`
    );
  }

  static schemaFileNotFound(): AppError {
    return new AppError(
      "SCHEMA_FILE_NOT_FOUND",
      "schema.lua not found in project root.",
      "Create a schema.lua file with your declarative schema definition."
    );
  }

  static directoryExists(name: string): AppError {
    return new AppError(
      "DIRECTORY_EXISTS",
      `Directory "${name}" already exists.`,
      "Use a different name or remove the existing directory."
    );
  }
}

/**
 * Centralized error handler for CLI commands.
 * Displays error message, suggestion, and code in a consistent format.
 */
export function handleError(error: unknown): void {
  if (error instanceof AppError) {
    Logger.error(error.message);
    if (error.suggestion) {
      Logger.info(`\n  Suggestion: ${error.suggestion}`);
    }
  } else if (error instanceof Error) {
    Logger.error(error.message);
  } else {
    Logger.error(String(error));
  }

  if (process.env.DEBUG && error instanceof Error) {
    console.error(error.stack);
  }

  process.exit(1);
}
