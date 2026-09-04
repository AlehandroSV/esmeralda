import { EntityDef, ColumnDef } from "./schema-parser.js";
import { SQLDialect } from "./sql-dialect.js";

/**
 * Generate Jade DDL API calls for a migration.
 * Uses Jade.createTable / Jade.dropTable / Jade.addColumn / Jade.dropColumn
 * instead of raw SQL — driver-agnostic.
 */
export function generateMigration(entities: EntityDef[], direction: "up" | "down"): string {
  const lines: string[] = [];

  if (direction === "up") {
    for (const entity of entities) {
      lines.push(generateCreateTable(entity));
    }
  } else {
    for (const entity of [...entities].reverse()) {
      lines.push(`    Jade.dropTable("${entity.tableName}")`);
    }
  }

  return lines.join("\n\n");
}

function generateCreateTable(entity: EntityDef): string {
  const colDefs: string[] = [];

  for (const col of entity.columns) {
    let def = `        ${col.name} = ${getColumnType(col)}`;

    const modifiers: string[] = [];
    if (col.primaryKey) modifiers.push("primaryKey()");
    if (col.unique) modifiers.push("unique()");
    if (col.notNull && !col.primaryKey) modifiers.push("notNull()");

    if (col.default !== undefined) {
      if (col.default === "CURRENT_TIMESTAMP") {
        modifiers.push("defaultNow()");
      } else {
        modifiers.push(`default(${getLuaDefault(col.default)})`);
      }
    }

    if (col.enumValues && col.enumValues.length > 0) {
      const vals = col.enumValues.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(", ");
      modifiers.push(`values(${vals})`);
    }

    if (col.references) {
      const ref = col.references;
      modifiers.push(`references("${ref.table}", "${ref.column}")`);
    }

    if (modifiers.length > 0) {
      def += ":" + modifiers.join(":");
    }

    colDefs.push(def);
  }

  return `    Jade.createTable("${entity.tableName}", {\n${colDefs.join(",\n")}\n    })`;
}

function getColumnType(col: ColumnDef): string {
  if (col.cuidDefault) return "Jade.CUID()";
  if (col.nanoidDefault) return "Jade.NanoID()";
  if (col.enumValues && col.enumValues.length > 0) return "Jade.Enum()";

  const typeMap: Record<string, string> = {
    VARCHAR: col.length ? `Jade.String(${col.length})` : "Jade.String(255)",
    TEXT: "Jade.Text()",
    INTEGER: "Jade.Integer()",
    BIGINT: "Jade.BigInt()",
    FLOAT: "Jade.Float()",
    DECIMAL: "Jade.Decimal()",
    BOOLEAN: "Jade.Boolean()",
    TIMESTAMP: "Jade.Timestamp()",
    DATE: "Jade.Date()",
    UUID: "Jade.UUID()",
    JSON: "Jade.JSON()",
  };
  return typeMap[col.type] || "Jade.Text()";
}

function getLuaDefault(value: any): string {
  if (value === "true") return "true";
  if (value === "false") return "false";
  if (typeof value === "string") return `"${value.replace(/"/g, '\\"')}"`;
  return String(value);
}

/**
 * Generate raw SQL CREATE TABLE using dialect-aware type mapping.
 * Used by db-push which executes SQL directly.
 */
export function generateCreateTableSQL(entity: EntityDef, dialect: SQLDialect): string {
  const colDefs: string[] = [];

  for (const col of entity.columns) {
    let def: string;

    if (col.primaryKey && (col.type === "INTEGER" || col.type === "BIGINT")) {
      def = `${dialect.quoteIdentifier(col.name)} ${dialect.autoIncrement(col.name)}`;
    } else if (col.enumValues && col.enumValues.length > 0 && dialect.supportsEnum()) {
      const typeName = `enum_${entity.tableName}_${col.name}`;
      def = `${dialect.quoteIdentifier(col.name)} ${dialect.quoteIdentifier(typeName)}`;
    } else {
      def = `${dialect.quoteIdentifier(col.name)} ${dialect.mapType(col.type, col.length)}`;
      if (col.primaryKey) def += " PRIMARY KEY";
      if (col.notNull && !col.primaryKey) def += " NOT NULL";
      if (col.unique) def += " UNIQUE";
      if (col.default !== undefined) {
        def += ` DEFAULT ${dialect.mapDefault(col.default, col.type)}`;
      }
      if (col.enumValues && col.enumValues.length > 0 && !dialect.supportsEnum()) {
        const checkValues = col.enumValues.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
        def += ` CHECK (${dialect.quoteIdentifier(col.name)} IN (${checkValues}))`;
      }
    }

    colDefs.push(`    ${def}`);
  }

  return `CREATE TABLE IF NOT EXISTS ${dialect.quoteIdentifier(entity.tableName)} (\n${colDefs.join(",\n")}\n)`;
}

/**
 * Generate ALTER TABLE ADD CONSTRAINT for foreign keys.
 */
export function generateForeignKeySQL(
  tableName: string,
  colName: string,
  refTable: string,
  refColumn: string,
  dialect: SQLDialect
): string {
  const fkName = `fk_${tableName}_${colName}`;
  return `ALTER TABLE ${dialect.quoteIdentifier(tableName)} ADD CONSTRAINT ${dialect.quoteIdentifier(fkName)} FOREIGN KEY (${dialect.quoteIdentifier(colName)}) REFERENCES ${dialect.quoteIdentifier(refTable)}(${dialect.quoteIdentifier(refColumn)})`;
}
