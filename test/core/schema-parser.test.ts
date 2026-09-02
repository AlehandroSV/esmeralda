import { describe, it, expect } from "vitest";
import { parseSchemaFile, validateSchema } from "../../src/core/schema-parser.js";

describe("Schema Parser", () => {
  it("parses Entity definitions", () => {
    const content = `
      local User = Jade.Entity("users", {
          id = Jade.Integer():primaryKey(),
          name = Jade.String(120),
          email = Jade.String():unique(),
      })
    `;

    const entities = parseSchemaFile(content);
    expect(entities).toHaveLength(1);
    expect(entities[0].tableName).toBe("users");
    expect(entities[0].columns).toHaveLength(3);
  });

  it("parses column types", () => {
    const content = `
      local User = Jade.Entity("users", {
          id = Jade.Integer():primaryKey(),
          name = Jade.String(120):notNull(),
      })
    `;

    const entities = parseSchemaFile(content);
    const columns = entities[0].columns;

    expect(columns[0].name).toBe("id");
    expect(columns[0].type).toBe("INTEGER");
    expect(columns[0].primaryKey).toBe(true);

    expect(columns[1].name).toBe("name");
    expect(columns[1].length).toBe(120);
    expect(columns[1].notNull).toBe(true);
  });

  it("parses multiple entities", () => {
    const content = `
      local User = Jade.Entity("users", {
          id = Jade.Integer():primaryKey(),
      })
      local Post = Jade.Entity("posts", {
          id = Jade.Integer():primaryKey(),
      })
    `;

    const entities = parseSchemaFile(content);
    expect(entities).toHaveLength(2);
    expect(entities[0].tableName).toBe("users");
    expect(entities[1].tableName).toBe("posts");
  });

  it("parses references", () => {
    const content = `
      local Post = Jade.Entity("posts", {
          id = Jade.Integer():primaryKey(),
          user_id = Jade.Integer():references("users", "id"),
      })
    `;

    const entities = parseSchemaFile(content);
    const columns = entities[0].columns;

    expect(columns[1].name).toBe("user_id");
    expect(columns[1].references).toEqual({ table: "users", column: "id" });
  });

  it("parses single-column index", () => {
    const content = `
      Jade.Entity("users", {
          id = Jade.Integer():primaryKey(),
          email = Jade.String(),
          Jade.Index("idx_users_email", { "email" }),
      })
    `;

    const entities = parseSchemaFile(content);
    expect(entities[0].indexes).toHaveLength(1);
    expect(entities[0].indexes![0].name).toBe("idx_users_email");
    expect(entities[0].indexes![0].columns).toEqual(["email"]);
    expect(entities[0].indexes![0].unique).toBeUndefined();
  });

  it("parses unique index", () => {
    const content = `
      Jade.Entity("users", {
          id = Jade.Integer():primaryKey(),
          email = Jade.String(),
          Jade.Index("idx_users_email", { "email" }, { unique = true }),
      })
    `;

    const entities = parseSchemaFile(content);
    expect(entities[0].indexes).toHaveLength(1);
    expect(entities[0].indexes![0].unique).toBe(true);
  });

  it("parses composite index", () => {
    const content = `
      Jade.Entity("posts", {
          id = Jade.Integer():primaryKey(),
          user_id = Jade.Integer(),
          title = Jade.String(),
          Jade.Index("idx_posts_user_title", { "user_id", "title" }),
      })
    `;

    const entities = parseSchemaFile(content);
    expect(entities[0].indexes).toHaveLength(1);
    expect(entities[0].indexes![0].columns).toEqual(["user_id", "title"]);
  });

  it("parses multiple indexes on same entity", () => {
    const content = `
      Jade.Entity("users", {
          id = Jade.Integer():primaryKey(),
          email = Jade.String(),
          name = Jade.String(),
          Jade.Index("idx_users_email", { "email" }, { unique = true }),
          Jade.Index("idx_users_name", { "name" }),
      })
    `;

    const entities = parseSchemaFile(content);
    expect(entities[0].indexes).toHaveLength(2);
    expect(entities[0].indexes![0].name).toBe("idx_users_email");
    expect(entities[0].indexes![1].name).toBe("idx_users_name");
  });

  it("returns undefined indexes when none defined", () => {
    const content = `
      Jade.Entity("users", {
          id = Jade.Integer():primaryKey(),
          name = Jade.String(),
      })
    `;

    const entities = parseSchemaFile(content);
    expect(entities[0].indexes).toBeUndefined();
  });
});

describe("Schema Validation", () => {
  it("validates valid schema", () => {
    const entities = [
      {
        name: "User",
        tableName: "users",
        columns: [
          { name: "id", type: "INTEGER", primaryKey: true },
          { name: "name", type: "VARCHAR" },
        ],
      },
    ];

    const errors = validateSchema(entities);
    expect(errors).toHaveLength(0);
  });

  it("detects duplicate table names", () => {
    const entities = [
      { name: "User", tableName: "users", columns: [{ name: "id", type: "INTEGER", primaryKey: true }] },
      { name: "User2", tableName: "users", columns: [{ name: "id", type: "INTEGER", primaryKey: true }] },
    ];

    const errors = validateSchema(entities);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Duplicate table name");
  });

  it("detects missing primary key", () => {
    const entities = [
      { name: "User", tableName: "users", columns: [{ name: "name", type: "VARCHAR" }] },
    ];

    const errors = validateSchema(entities);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("No primary key");
  });

  it("detects invalid table name format", () => {
    const entities = [
      { name: "User", tableName: "Users", columns: [{ name: "id", type: "INTEGER", primaryKey: true }] },
    ];

    const errors = validateSchema(entities);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Invalid table name format");
  });

  it("detects duplicate column names", () => {
    const entities = [
      {
        name: "User",
        tableName: "users",
        columns: [
          { name: "id", type: "INTEGER", primaryKey: true },
          { name: "id", type: "INTEGER" },
        ],
      },
    ];

    const errors = validateSchema(entities);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Duplicate column name");
  });
});