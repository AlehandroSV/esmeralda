import { describe, it, expect } from "vitest";
import {
  getDialect,
  detectDriver,
  type DriverKind,
} from "../../src/core/sql-dialect.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dialect-test-"));
}

describe("sql-dialect", () => {
  describe("getDialect", () => {
    it("returns postgres dialect", () => {
      const d = getDialect("postgres");
      expect(d.kind).toBe("postgres");
      expect(d.quoteIdentifier("users")).toBe('"users"');
      expect(d.supportsEnum()).toBe(true);
      expect(d.cascadeDrop()).toBe(" CASCADE");
    });

    it("returns mysql dialect", () => {
      const d = getDialect("mysql");
      expect(d.kind).toBe("mysql");
      expect(d.quoteIdentifier("users")).toBe("`users`");
      expect(d.supportsEnum()).toBe(true);
      expect(d.cascadeDrop()).toBe("");
    });

    it("returns sqlite dialect", () => {
      const d = getDialect("sqlite");
      expect(d.kind).toBe("sqlite");
      expect(d.quoteIdentifier("users")).toBe('"users"');
      expect(d.supportsEnum()).toBe(false);
      expect(d.cascadeDrop()).toBe("");
    });
  });

  describe("mapType", () => {
    it("postgres maps VARCHAR with length", () => {
      const d = getDialect("postgres");
      expect(d.mapType("VARCHAR", 100)).toBe("VARCHAR(100)");
      expect(d.mapType("VARCHAR")).toBe("VARCHAR(255)");
    });

    it("postgres maps TIMESTAMP to TIMESTAMPTZ", () => {
      const d = getDialect("postgres");
      expect(d.mapType("TIMESTAMP")).toBe("TIMESTAMPTZ");
    });

    it("postgres maps JSON to JSONB", () => {
      const d = getDialect("postgres");
      expect(d.mapType("JSON")).toBe("JSONB");
    });

    it("mysql maps FLOAT to DOUBLE", () => {
      const d = getDialect("mysql");
      expect(d.mapType("FLOAT")).toBe("DOUBLE");
    });

    it("mysql maps BOOLEAN to TINYINT(1)", () => {
      const d = getDialect("mysql");
      expect(d.mapType("BOOLEAN")).toBe("TINYINT(1)");
    });

    it("mysql maps UUID to CHAR(36)", () => {
      const d = getDialect("mysql");
      expect(d.mapType("UUID")).toBe("CHAR(36)");
    });

    it("sqlite maps everything to generic types", () => {
      const d = getDialect("sqlite");
      expect(d.mapType("VARCHAR")).toBe("TEXT");
      expect(d.mapType("INTEGER")).toBe("INTEGER");
      expect(d.mapType("BOOLEAN")).toBe("INTEGER");
      expect(d.mapType("TIMESTAMP")).toBe("TEXT");
    });
  });

  describe("autoIncrement", () => {
    it("postgres uses SERIAL", () => {
      expect(getDialect("postgres").autoIncrement("id")).toBe("SERIAL PRIMARY KEY");
    });

    it("mysql uses AUTO_INCREMENT", () => {
      expect(getDialect("mysql").autoIncrement("id")).toBe("INT AUTO_INCREMENT PRIMARY KEY");
    });

    it("sqlite uses AUTOINCREMENT", () => {
      expect(getDialect("sqlite").autoIncrement("id")).toBe("INTEGER PRIMARY KEY AUTOINCREMENT");
    });
  });

  describe("createEnumType / dropEnumType", () => {
    it("postgres creates ENUM type", () => {
      const d = getDialect("postgres");
      expect(d.createEnumType("status", ["active", "inactive"])).toBe(
        'CREATE TYPE "status" AS ENUM (\'active\', \'inactive\')'
      );
    });

    it("postgres drops ENUM type", () => {
      const d = getDialect("postgres");
      expect(d.dropEnumType("status")).toBe('DROP TYPE IF EXISTS "status"');
    });

    it("mysql returns null for createEnumType (inline)", () => {
      expect(getDialect("mysql").createEnumType("status", ["a"])).toBeNull();
    });

    it("sqlite returns null for createEnumType", () => {
      expect(getDialect("sqlite").createEnumType("status", ["a"])).toBeNull();
    });
  });

  describe("mapDefault", () => {
    it("handles booleans for postgres", () => {
      const d = getDialect("postgres");
      expect(d.mapDefault("true", "BOOLEAN")).toBe("TRUE");
      expect(d.mapDefault("false", "BOOLEAN")).toBe("FALSE");
    });

    it("handles booleans for mysql", () => {
      const d = getDialect("mysql");
      expect(d.mapDefault("true", "BOOLEAN")).toBe("1");
      expect(d.mapDefault("false", "BOOLEAN")).toBe("0");
    });

    it("handles CURRENT_TIMESTAMP", () => {
      expect(getDialect("postgres").mapDefault("CURRENT_TIMESTAMP", "TIMESTAMP")).toBe("NOW()");
      expect(getDialect("mysql").mapDefault("CURRENT_TIMESTAMP", "TIMESTAMP")).toBe("CURRENT_TIMESTAMP");
    });

    it("handles string defaults", () => {
      const d = getDialect("postgres");
      expect(d.mapDefault("hello", "VARCHAR")).toBe("'hello'");
      expect(d.mapDefault("it's", "VARCHAR")).toBe("'it''s'");
    });
  });

  describe("introspection queries", () => {
    it("postgres uses information_schema with public schema", () => {
      const d = getDialect("postgres");
      expect(d.tableListQuery()).toContain("information_schema");
      expect(d.tableListQuery()).toContain("'public'");
      expect(d.columnListQuery("users")).toContain("'users'");
      expect(d.columnListQuery("users")).toContain("information_schema");
    });

    it("mysql uses information_schema with DATABASE()", () => {
      const d = getDialect("mysql");
      expect(d.tableListQuery()).toContain("DATABASE()");
      expect(d.columnListQuery("users")).toContain("DATABASE()");
    });

    it("sqlite uses sqlite_master and PRAGMA", () => {
      const d = getDialect("sqlite");
      expect(d.tableListQuery()).toContain("sqlite_master");
      expect(d.columnListQuery("users")).toContain("PRAGMA table_info");
      expect(d.foreignKeyQuery("users")).toContain("PRAGMA foreign_key_list");
    });
  });

  describe("detectDriver", () => {
    it("detects postgres from config", () => {
      const dir = tmpDir();
      fs.writeFileSync(path.join(dir, "jade.config.lua"), 'return { database = "postgres://localhost/mydb" }');
      expect(detectDriver(dir)).toBe("postgres");
      fs.rmSync(dir, { recursive: true });
    });

    it("detects mysql from config", () => {
      const dir = tmpDir();
      fs.writeFileSync(path.join(dir, "jade.config.lua"), 'return { database = "mysql://localhost/mydb" }');
      expect(detectDriver(dir)).toBe("mysql");
      fs.rmSync(dir, { recursive: true });
    });

    it("detects sqlite from config", () => {
      const dir = tmpDir();
      fs.writeFileSync(path.join(dir, "jade.config.lua"), 'return { database = "sqlite://./data.db" }');
      expect(detectDriver(dir)).toBe("sqlite");
      fs.rmSync(dir, { recursive: true });
    });

    it("defaults to postgres when no config", () => {
      const dir = tmpDir();
      expect(detectDriver(dir)).toBe("postgres");
      fs.rmSync(dir, { recursive: true });
    });

    it("defaults to postgres when no database URL", () => {
      const dir = tmpDir();
      fs.writeFileSync(path.join(dir, "jade.config.lua"), 'return { debug = true }');
      expect(detectDriver(dir)).toBe("postgres");
      fs.rmSync(dir, { recursive: true });
    });
  });
});
