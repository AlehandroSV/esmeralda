import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError, handleError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { parseSchemaFile } from "../core/schema-parser.js";
import { LuaBridge } from "../core/lua-bridge.js";
import { getConfigPathForEnv, LUA_CONFIG_LOAD } from "../core/config.js";

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

        const sqlStatements = generateSchemaSQL(entities);
        const bridge = new LuaBridge();
        const { configPath, envConfigPath } = getConfigPathForEnv(projectRoot);

        const script = `
local jade = require("jade")
${LUA_CONFIG_LOAD}
jade.configure(_cfg)
jade.driver():execute(ARGS.sql)
        `;

        for (const sql of sqlStatements) {
          Logger.info(`  Executing: ${sql.substring(0, 80)}...`);
          await bridge.executeSafe(script, {
            configPath,
            envConfigPath,
            sql,
          });
        }

        Logger.success("Schema pushed to database!");
      } catch (error: unknown) {
        handleError(error);
      }
    });
}

function generateSchemaSQL(entities: any[]): string[] {
  const statements: string[] = [];

  for (const entity of entities) {
    const columns = entity.columns || [];
    const colDefs: string[] = [];

    for (const col of columns) {
      let def = `"${col.name}" ${col.type || "TEXT"}`;

      if (col.length && col.type === "string") {
        def = `"${col.name}" VARCHAR(${col.length})`;
      }

      if (col.primaryKey) def += " PRIMARY KEY";
      if (col.notNull) def += " NOT NULL";
      if (col.unique) def += " UNIQUE";
      if (col.default !== undefined) {
        if (typeof col.default === "string") {
          def += ` DEFAULT '${col.default}'`;
        } else {
          def += ` DEFAULT ${col.default}`;
        }
      }

      colDefs.push(def);
    }

    const sql = `CREATE TABLE IF NOT EXISTS "${entity.tableName}" (\n  ${colDefs.join(",\n  ")}\n)`;
    statements.push(sql);
  }

  for (const entity of entities) {
    const columns = entity.columns || [];

    for (const col of columns) {
      if (col.references) {
        const fkName = `fk_${entity.tableName}_${col.name}`;
        const sql = `ALTER TABLE "${entity.tableName}" ADD CONSTRAINT "${fkName}" FOREIGN KEY ("${col.name}") REFERENCES "${col.references.table}"("${col.references.column}")`;
        statements.push(sql);
      }
    }
  }

  return statements;
}
