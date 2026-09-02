import { EntityDef, ColumnDef } from "./schema-parser.js";

/** Escape a string for safe embedding in a SQL identifier (double-quote quoting) */
function quoteIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export function generateMigration(entities: EntityDef[], direction: "up" | "down"): string {
  const lines: string[] = [];

  if (direction === "up") {
    // Collect all ENUM types first — they must be created before tables reference them
    const enumDefs: string[] = [];
    for (const entity of entities) {
      for (const col of entity.columns) {
        if (col.enumValues) {
          const typeName = `enum_${entity.tableName}_${col.name}`;
          enumDefs.push(
            `    jade.driver():execute([[CREATE TYPE ${quoteIdentifier(typeName)} AS ENUM (${col.enumValues.map(v => `'${v.replace(/'/g, "''")}'`).join(', ')});]])`
          );
        }
      }
    }
    if (enumDefs.length > 0) {
      lines.push(enumDefs.join("\n"));
    }

    for (const entity of entities) {
      lines.push(generateCreateTable(entity));
    }
  } else {
    // Down migration drops tables in reverse order, then drops enums
    for (const entity of [...entities].reverse()) {
      lines.push(`    jade.driver():execute("DROP TABLE IF EXISTS ${quoteIdentifier(entity.tableName)} CASCADE")`);
    }
    // Drop enum types in original order
    for (const entity of entities) {
      for (const col of entity.columns) {
        if (col.enumValues) {
          const typeName = `enum_${entity.tableName}_${col.name}`;
          lines.push(`    jade.driver():execute("DROP TYPE IF EXISTS ${quoteIdentifier(typeName)}")`);
        }
      }
    }
  }

  return lines.join("\n\n");
}

function generateCreateTable(entity: EntityDef): string {
  const colDefs: string[] = [];

  for (const col of entity.columns) {
    let def: string;

    // Integer primary keys become SERIAL (auto-increment)
    if (col.primaryKey && (col.type === "INTEGER" || col.type === "BIGINT")) {
      def = `        ${quoteIdentifier(col.name)} SERIAL PRIMARY KEY`;
    } else {
      def = `        ${quoteIdentifier(col.name)} ${getSQLType(col)}`;
      if (col.primaryKey) def += " PRIMARY KEY";
      if (col.notNull && !col.primaryKey) def += " NOT NULL";
      if (col.unique) def += " UNIQUE";
      if (col.default !== undefined) {
        def += ` DEFAULT ${getSQLDefault(col)}`;
      } else if (col.cuidDefault) {
        // Jade.CUID generates cuid() at runtime — no DB-level default needed
        // but document it via comment so generated migrations are clear
        def += "";  // cuid is handled by Jade's entity system, not the DB
      } else if (col.nanoidDefault) {
        // Same as CUID — nanoid() is generated at runtime
        def += "";
      }

      // Add CHECK constraint for ENUM columns when column type is VARCHAR without explicit enum type
      if (col.enumValues && col.enumValues.length > 0) {
        const checkValues = col.enumValues.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
        def += ` CHECK (${quoteIdentifier(col.name)} IN (${checkValues}))`;
      }
    }

    colDefs.push(def);
  }

  const sql = `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(entity.tableName)} (\n${colDefs.join(",\n")}\n)`;
  return `    jade.driver():execute([[\n${sql}\n    ]])`;
}

function getSQLType(col: ColumnDef): string {
  const typeMap: Record<string, string> = {
    "VARCHAR": col.length ? `VARCHAR(${col.length})` : "VARCHAR(255)",
    "TEXT": "TEXT",
    "INTEGER": "INTEGER",
    "BIGINT": "BIGSERIAL",
    "FLOAT": "DOUBLE PRECISION",
    "DECIMAL": "DECIMAL(10,2)",
    "BOOLEAN": "BOOLEAN",
    "TIMESTAMP": "TIMESTAMPTZ",
    "DATE": "DATE",
    "UUID": "UUID",
    "JSON": "JSONB",
  };
  return typeMap[col.type] || "TEXT";
}

function getSQLDefault(col: ColumnDef): string {
  if (col.default === "true") return "TRUE";
  if (col.default === "false") return "FALSE";
  if (col.default === "CURRENT_TIMESTAMP") return "NOW()";
  if (typeof col.default === "string") return `'${col.default.replace(/'/g, "''")}'`;
  return String(col.default);
}
