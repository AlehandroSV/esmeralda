import { describe, it, expect } from "vitest";
import { generateMigration, generateCreateTableSQL, generateForeignKeySQL } from "../../src/core/migration-generator.js";
import { getDialect } from "../../src/core/sql-dialect.js";
import type { EntityDef } from "../../src/core/schema-parser.js";

const userEntity: EntityDef = {
  name: "User",
  tableName: "users",
  columns: [
    { name: "id", type: "INTEGER", primaryKey: true },
    { name: "name", type: "VARCHAR", length: 255, notNull: true },
    { name: "email", type: "VARCHAR", length: 255, unique: true, notNull: true },
    { name: "active", type: "BOOLEAN", default: "true" },
    { name: "created_at", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" },
  ],
};

const postEntity: EntityDef = {
  name: "Post",
  tableName: "posts",
  columns: [
    { name: "id", type: "INTEGER", primaryKey: true },
    { name: "title", type: "VARCHAR", length: 500, notNull: true },
    { name: "user_id", type: "INTEGER", references: { table: "users", column: "id" } },
  ],
};

describe("migration-generator (Jade DDL API)", () => {
  describe("generateMigration (up)", () => {
    it("generates Jade.createTable calls", () => {
      const result = generateMigration([userEntity], "up");
      expect(result).toContain('Jade.createTable("users"');
      expect(result).toContain("id = Jade.Integer():primaryKey()");
      expect(result).toContain("name = Jade.String(255):notNull()");
      expect(result).toContain("email = Jade.String(255):unique():notNull()");
    });

    it("generates default modifiers", () => {
      const result = generateMigration([userEntity], "up");
      expect(result).toContain(':default(true)');
      expect(result).toContain(":defaultNow()");
    });

    it("generates references modifier", () => {
      const result = generateMigration([postEntity], "up");
      expect(result).toContain('references("users", "id")');
    });

    it("handles CUID columns", () => {
      const cuidEntity: EntityDef = {
        name: "Item",
        tableName: "items",
        columns: [
          { name: "id", type: "VARCHAR", cuidDefault: true, primaryKey: true },
        ],
      };
      const result = generateMigration([cuidEntity], "up");
      expect(result).toContain("Jade.CUID()");
    });

    it("handles enum values", () => {
      const enumEntity: EntityDef = {
        name: "Task",
        tableName: "tasks",
        columns: [
          { name: "status", type: "VARCHAR", enumValues: ["pending", "done"] },
        ],
      };
      const result = generateMigration([enumEntity], "up");
      expect(result).toContain('Jade.Enum()');
      expect(result).toContain('values("pending", "done")');
    });
  });

  describe("generateMigration (down)", () => {
    it("generates Jade.dropTable calls in reverse order", () => {
      const result = generateMigration([userEntity, postEntity], "down");
      expect(result).toContain('Jade.dropTable("posts")');
      expect(result).toContain('Jade.dropTable("users")');
      // posts should come before users (reverse order)
      const postsIdx = result.indexOf('Jade.dropTable("posts")');
      const usersIdx = result.indexOf('Jade.dropTable("users")');
      expect(postsIdx).toBeLessThan(usersIdx);
    });
  });
});

describe("generateCreateTableSQL (raw SQL with dialect)", () => {
  it("generates PostgreSQL SQL with double-quote identifiers", () => {
    const d = getDialect("postgres");
    const sql = generateCreateTableSQL(userEntity, d);
    expect(sql).toContain('"users"');
    expect(sql).toContain('"id" SERIAL PRIMARY KEY');
    expect(sql).toContain('"name" VARCHAR(255) NOT NULL');
    expect(sql).toContain('"email" VARCHAR(255) NOT NULL UNIQUE');
    expect(sql).toContain('DEFAULT TRUE');
    expect(sql).toContain('DEFAULT NOW()');
  });

  it("generates MySQL SQL with backtick identifiers", () => {
    const d = getDialect("mysql");
    const sql = generateCreateTableSQL(userEntity, d);
    expect(sql).toContain("`users`");
    expect(sql).toContain("`id` INT AUTO_INCREMENT PRIMARY KEY");
    expect(sql).toContain("`name` VARCHAR(255) NOT NULL");
    expect(sql).toContain("`active` TINYINT(1) DEFAULT 1");
    expect(sql).toContain("DEFAULT CURRENT_TIMESTAMP");
  });

  it("generates SQLite SQL without AUTO_INCREMENT", () => {
    const d = getDialect("sqlite");
    const sql = generateCreateTableSQL(userEntity, d);
    expect(sql).toContain('"users"');
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain("DEFAULT 1");
  });

  it("generates CHECK constraint for enums on SQLite", () => {
    const d = getDialect("sqlite");
    const enumEntity: EntityDef = {
      name: "Task",
      tableName: "tasks",
      columns: [
        { name: "status", type: "VARCHAR", enumValues: ["pending", "done"] },
      ],
    };
    const sql = generateCreateTableSQL(enumEntity, d);
    expect(sql).toContain("CHECK");
    expect(sql).toContain("'pending'");
    expect(sql).toContain("'done'");
  });

  it("generates native ENUM type on PostgreSQL", () => {
    const d = getDialect("postgres");
    const enumEntity: EntityDef = {
      name: "Task",
      tableName: "tasks",
      columns: [
        { name: "status", type: "VARCHAR", enumValues: ["pending", "done"] },
      ],
    };
    const sql = generateCreateTableSQL(enumEntity, d);
    expect(sql).toContain('"enum_tasks_status"');
  });
});

describe("generateForeignKeySQL", () => {
  it("generates FK with PostgreSQL quoting", () => {
    const d = getDialect("postgres");
    const sql = generateForeignKeySQL("posts", "user_id", "users", "id", d);
    expect(sql).toContain('"posts"');
    expect(sql).toContain('"fk_posts_user_id"');
    expect(sql).toContain('"users"');
    expect(sql).toContain('"id"');
  });

  it("generates FK with MySQL backtick quoting", () => {
    const d = getDialect("mysql");
    const sql = generateForeignKeySQL("posts", "user_id", "users", "id", d);
    expect(sql).toContain("`posts`");
    expect(sql).toContain("`fk_posts_user_id`");
  });
});
