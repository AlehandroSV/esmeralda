import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { parseSchemaFile } from "../core/schema-parser.js";
import { generateCreateTableSQL, generateForeignKeySQL } from "../core/migration-generator.js";
import { detectDriver, getDialect, SQLDialect } from "../core/sql-dialect.js";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

interface DbPushOptions {
  force?: boolean;
  database?: string;
}

export function registerDbPush(db: Command): void {
  db
    .command("push")
    .description("Push schema directly to database (skip migrations)")
    .option("--force", "Skip confirmation")
    .option("-d, --database <name>", "Database to push to")
    .action(async (options: DbPushOptions) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        const schemaDir = path.join(projectRoot, "schema");
        if (!fs.existsSync(schemaDir)) {
          throw AppError.schemaDirNotFound();
        }

        const driverKind = detectDriver(projectRoot);
        const dialect = getDialect(driverKind);
        Logger.info(`Detected driver: ${driverKind}`);

        // Parse schema files
        const files = fs.readdirSync(schemaDir).filter(f => f.endsWith(".lua") && f !== "init.lua");
        const entities = [];

        for (const file of files) {
          const content = fs.readFileSync(path.join(schemaDir, file), "utf-8");
          const parsed = parseSchemaFile(content);
          entities.push(...parsed);
        }

        if (entities.length === 0) {
          Logger.warn("No entities found in schema/");
          return;
        }

        Logger.info(`Found ${entities.length} entities`);
        Logger.info("Pushing schema to database...");

        if (!options.force) {
          Logger.warn("This will modify your database schema directly.");
          Logger.info("Use --force to skip this confirmation.");
          return;
        }

        // Generate dialect-aware SQL
        const sqlStatements = generateSchemaSQL(entities, dialect);

        for (const sql of sqlStatements) {
          Logger.info(`  Executing: ${sql.substring(0, 80)}...`);

          const script = `
            local jade = require("jade")
            local config = dofile("${path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\")}")
            jade.configure(config)
            jade.driver():execute([[${sql}]])
          `;

          await exec("lua", ["-e", script]);
        }

        Logger.success("Schema pushed to database!");
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          Logger.error("Failed to push schema:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}

function generateSchemaSQL(entities: any[], dialect: SQLDialect): string[] {
  const statements: string[] = [];

  // Create enum types if supported
  if (dialect.supportsEnum()) {
    for (const entity of entities) {
      for (const col of (entity.columns || [])) {
        if (col.enumValues && col.enumValues.length > 0) {
          const typeName = `enum_${entity.tableName}_${col.name}`;
          const stmt = dialect.createEnumType(typeName, col.enumValues);
          if (stmt) statements.push(stmt);
        }
      }
    }
  }

  // Create tables
  for (const entity of entities) {
    statements.push(generateCreateTableSQL(entity, dialect));
  }

  // Add foreign keys
  for (const entity of entities) {
    for (const col of (entity.columns || [])) {
      if (col.references) {
        statements.push(
          generateForeignKeySQL(entity.tableName, col.name, col.references.table, col.references.column, dialect)
        );
      }
    }
  }

  return statements;
}
