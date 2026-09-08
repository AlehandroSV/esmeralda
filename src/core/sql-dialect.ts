import * as fs from "fs";
import * as path from "path";

export type DriverKind = "postgres" | "mysql" | "sqlite";

export interface SQLDialect {
  readonly kind: DriverKind;
  quoteIdentifier(name: string): string;
  mapType(jadeType: string, length?: number): string;
  autoIncrement(colName: string): string;
  supportsEnum(): boolean;
  createEnumType(typeName: string, values: string[]): string | null;
  dropEnumType(typeName: string): string | null;
  cascadeDrop(): string;
  mapDefault(value: any, colType: string): string;
  tableListQuery(): string;
  columnListQuery(tableName: string): string;
  foreignKeyQuery(tableName: string): string;
  uniqueConstraintsQuery(tableName: string): string;
  indexListQuery(tableName: string): string;
}

/* ─── PostgreSQL ─────────────────────────────────────────────── */

class PostgreSQLDialect implements SQLDialect {
  readonly kind: DriverKind = "postgres";

  quoteIdentifier(name: string): string {
    return '"' + name.replace(/"/g, '""') + '"';
  }

  mapType(jadeType: string, length?: number): string {
    const map: Record<string, string> = {
      VARCHAR: length ? `VARCHAR(${length})` : "VARCHAR(255)",
      TEXT: "TEXT",
      INTEGER: "INTEGER",
      BIGINT: "BIGINT",
      FLOAT: "DOUBLE PRECISION",
      DECIMAL: "DECIMAL(10,2)",
      BOOLEAN: "BOOLEAN",
      TIMESTAMP: "TIMESTAMPTZ",
      DATE: "DATE",
      UUID: "UUID",
      JSON: "JSONB",
    };
    return map[jadeType] || "TEXT";
  }

  autoIncrement(colName: string): string {
    return "SERIAL PRIMARY KEY";
  }

  supportsEnum(): boolean {
    return true;
  }

  createEnumType(typeName: string, values: string[]): string {
    const escaped = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
    return `CREATE TYPE ${this.quoteIdentifier(typeName)} AS ENUM (${escaped})`;
  }

  dropEnumType(typeName: string): string {
    return `DROP TYPE IF EXISTS ${this.quoteIdentifier(typeName)}`;
  }

  cascadeDrop(): string {
    return " CASCADE";
  }

  mapDefault(value: any, colType: string): string {
    if (value === "true") return "TRUE";
    if (value === "false") return "FALSE";
    if (value === "CURRENT_TIMESTAMP") return "NOW()";
    if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
    return String(value);
  }

  tableListQuery(): string {
    return "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name";
  }

  columnListQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${safe}' ORDER BY ordinal_position`;
  }

  foreignKeyQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = '${safe}' AND tc.table_schema = 'public'`;
  }

  uniqueConstraintsQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `SELECT tc.constraint_name, kcu.column_name FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = '${safe}' AND tc.table_schema = 'public' ORDER BY tc.constraint_name, kcu.ordinal_position`;
  }

  indexListQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `SELECT indexname AS index_name, indexdef AS definition FROM pg_indexes WHERE tablename = '${safe}' AND schemaname = 'public'`;
  }
}

/* ─── MySQL / MariaDB ───────────────────────────────────────── */

class MySQLDialect implements SQLDialect {
  readonly kind: DriverKind = "mysql";

  quoteIdentifier(name: string): string {
    return "`" + name.replace(/`/g, "``") + "`";
  }

  mapType(jadeType: string, length?: number): string {
    const map: Record<string, string> = {
      VARCHAR: length ? `VARCHAR(${length})` : "VARCHAR(255)",
      TEXT: "TEXT",
      INTEGER: "INT",
      BIGINT: "BIGINT",
      FLOAT: "DOUBLE",
      DECIMAL: "DECIMAL(10,2)",
      BOOLEAN: "TINYINT(1)",
      TIMESTAMP: "DATETIME",
      DATE: "DATE",
      UUID: "CHAR(36)",
      JSON: "JSON",
    };
    return map[jadeType] || "TEXT";
  }

  autoIncrement(colName: string): string {
    return "INT AUTO_INCREMENT PRIMARY KEY";
  }

  supportsEnum(): boolean {
    return true;
  }

  createEnumType(typeName: string, values: string[]): string | null {
    // MySQL uses inline ENUM — return null, will be handled inline
    return null;
  }

  dropEnumType(typeName: string): string | null {
    return "-- MySQL enums are inline, no separate type to drop";
  }

  cascadeDrop(): string {
    return "";
  }

  mapDefault(value: any, colType: string): string {
    if (value === "true") return "1";
    if (value === "false") return "0";
    if (value === "CURRENT_TIMESTAMP") return "CURRENT_TIMESTAMP";
    if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
    return String(value);
  }

  tableListQuery(): string {
    return "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name";
  }

  columnListQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${safe}' AND table_schema = DATABASE() ORDER BY ordinal_position`;
  }

  foreignKeyQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = '${safe}' AND tc.table_schema = DATABASE()`;
  }

  uniqueConstraintsQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `SELECT tc.constraint_name, kcu.column_name FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = '${safe}' AND tc.table_schema = DATABASE() ORDER BY tc.constraint_name, kcu.ordinal_position`;
  }

  indexListQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `SHOW INDEX FROM \`${safe}\``;
  }
}

/* ─── SQLite ────────────────────────────────────────────────── */

class SQLiteDialect implements SQLDialect {
  readonly kind: DriverKind = "sqlite";

  quoteIdentifier(name: string): string {
    return '"' + name.replace(/"/g, '""') + '"';
  }

  mapType(jadeType: string, length?: number): string {
    const map: Record<string, string> = {
      VARCHAR: "TEXT",
      TEXT: "TEXT",
      INTEGER: "INTEGER",
      BIGINT: "INTEGER",
      FLOAT: "REAL",
      DECIMAL: "REAL",
      BOOLEAN: "INTEGER",
      TIMESTAMP: "TEXT",
      DATE: "TEXT",
      UUID: "TEXT",
      JSON: "TEXT",
    };
    return map[jadeType] || "TEXT";
  }

  autoIncrement(colName: string): string {
    return "INTEGER PRIMARY KEY AUTOINCREMENT";
  }

  supportsEnum(): boolean {
    return false;
  }

  createEnumType(typeName: string, values: string[]): string | null {
    return null;
  }

  dropEnumType(typeName: string): string | null {
    return "-- SQLite does not support enum types";
  }

  cascadeDrop(): string {
    return "";
  }

  mapDefault(value: any, colType: string): string {
    if (value === "true") return "1";
    if (value === "false") return "0";
    if (value === "CURRENT_TIMESTAMP") return "CURRENT_TIMESTAMP";
    if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
    return String(value);
  }

  tableListQuery(): string {
    return "SELECT name AS table_name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
  }

  columnListQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `PRAGMA table_info('${safe}')`;
  }

  foreignKeyQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `PRAGMA foreign_key_list('${safe}')`;
  }

  uniqueConstraintsQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `PRAGMA index_list('${safe}')`;
  }

  indexListQuery(tableName: string): string {
    const safe = tableName.replace(/'/g, "''");
    return `PRAGMA index_list('${safe}')`;
  }
}

/* ─── Factory ───────────────────────────────────────────────── */

const DIALECTS: Record<DriverKind, SQLDialect> = {
  postgres: new PostgreSQLDialect(),
  mysql: new MySQLDialect(),
  sqlite: new SQLiteDialect(),
};

export function getDialect(kind: DriverKind): SQLDialect {
  return DIALECTS[kind];
}

/**
 * Detect driver kind from jade.config.lua in the given project root.
 * Reads the database URL scheme to determine the driver.
 * Defaults to "postgres" if detection fails.
 */
export function detectDriver(projectRoot: string): DriverKind {
  const configPath = path.join(projectRoot, "jade.config.lua");
  if (!fs.existsSync(configPath)) return "postgres";

  const content = fs.readFileSync(configPath, "utf-8");

  // Match database = "scheme://..." or database = 'scheme://...'
  const dbMatch = content.match(/database\s*=\s*["'](\w+):\/\//);
  if (!dbMatch) return "postgres";

  const scheme = dbMatch[1].toLowerCase();
  if (scheme === "postgres" || scheme === "postgresql") return "postgres";
  if (scheme === "mysql" || scheme === "mariadb") return "mysql";
  if (scheme === "sqlite") return "sqlite";

  return "postgres";
}
