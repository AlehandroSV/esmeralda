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
      "Not a Jade project. Run 'esmeralda init' first.",
      "Run 'esmeralda init' in your project directory"
    );
  }

  static migrationsDirNotFound(): AppError {
    return new AppError(
      "MIGRATIONS_DIR_NOT_FOUND",
      "Migrations directory not found.",
      "Create a 'migrations/' directory or run 'esmeralda init'"
    );
  }

  static schemaDirNotFound(): AppError {
    return new AppError(
      "SCHEMA_DIR_NOT_FOUND",
      "Schema directory not found.",
      "Create a 'schema/' directory or run 'esmeralda init'"
    );
  }

  static seedsDirNotFound(): AppError {
    return new AppError(
      "SEEDS_DIR_NOT_FOUND",
      "Seeds directory not found.",
      "Create a 'seeds/' directory or run 'esmeralda init'"
    );
  }

  static migrationNameRequired(): AppError {
    return new AppError(
      "MIGRATION_NAME_REQUIRED",
      "Please provide a migration name.",
      "Usage: esmeralda migrate create <name>"
    );
  }

  static migrationFailed(file: string, originalError: Error): AppError {
    return new AppError(
      "MIGRATION_FAILED",
      `Failed to apply migration: ${file}`,
      `Check the migration file for syntax errors. Original error: ${originalError.message}`
    );
  }

  static rollbackFailed(originalError: Error): AppError {
    return new AppError(
      "ROLLBACK_FAILED",
      "Rollback failed",
      `Check if the migration has a down() function. Original error: ${originalError.message}`
    );
  }

  static introspectionFailed(originalError: Error): AppError {
    return new AppError(
      "INTROSPECTION_FAILED",
      "Failed to introspect database",
      `Check your database connection in jade.config.lua. Original error: ${originalError.message}`
    );
  }

  static pushFailed(originalError: Error): AppError {
    return new AppError(
      "PUSH_FAILED",
      "Failed to push schema to database",
      `Check your schema files for syntax errors. Original error: ${originalError.message}`
    );
  }

  static seedFailed(file: string, originalError: Error): AppError {
    return new AppError(
      "SEED_FAILED",
      `Failed to run seed: ${file}`,
      `Check the seed file for syntax errors. Original error: ${originalError.message}`
    );
  }

  static dockerNotAvailable(): AppError {
    return new AppError(
      "DOCKER_NOT_AVAILABLE",
      "Docker is not available",
      "Install Docker or run without docker-compose.yml"
    );
  }

  static luaNotAvailable(): AppError {
    return new AppError(
      "LUA_NOT_AVAILABLE",
      "Lua/LuaJIT not found",
      "Install Lua or LuaJIT: https://www.lua.org/download.html"
    );
  }

  static databaseConnectionFailed(originalError: Error): AppError {
    return new AppError(
      "DATABASE_CONNECTION_FAILED",
      "Failed to connect to database",
      `Check your database config in jade.config.lua. Original error: ${originalError.message}`
    );
  }

  static databaseQueryFailed(sql: string, originalError: Error): AppError {
    return new AppError(
      "DATABASE_QUERY_FAILED",
      `Query failed: ${sql.substring(0, 100)}...`,
      `Check the SQL syntax. Original error: ${originalError.message}`
    );
  }
}