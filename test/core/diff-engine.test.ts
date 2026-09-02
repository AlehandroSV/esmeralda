import { describe, it, expect } from "vitest";
import { DiffEngine } from "../../src/core/diff-engine.js";

describe("DiffEngine", () => {
  const engine = new DiffEngine();

  it("detects new tables", () => {
    const desired = [{ name: "users", columns: [] }];
    const current: any[] = [];

    const diff = engine.compute(desired, current);
    expect(diff.createTables).toHaveLength(1);
    expect(diff.createTables[0].name).toBe("users");
  });

  it("detects tables to drop", () => {
    const desired: any[] = [];
    const current = [{ name: "old_table", columns: [] }];

    const diff = engine.compute(desired, current);
    expect(diff.dropTables).toHaveLength(1);
    expect(diff.dropTables[0]).toBe("old_table");
  });

  it("detects new columns", () => {
    const desired = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }]
    }];
    const current = [{
      name: "users",
      columns: []
    }];

    const diff = engine.compute(desired, current);
    expect(diff.addColumns).toHaveLength(1);
    expect(diff.addColumns[0].column.name).toBe("email");
  });

  it("detects columns to drop", () => {
    const desired = [{
      name: "users",
      columns: []
    }];
    const current = [{
      name: "users",
      columns: [{ name: "old_field", type: "VARCHAR" }]
    }];

    const diff = engine.compute(desired, current);
    expect(diff.dropColumns).toHaveLength(1);
    expect(diff.dropColumns[0].column).toBe("old_field");
  });

  it("detects column changes", () => {
    const desired = [{
      name: "users",
      columns: [{ name: "name", type: "VARCHAR", length: 255 }]
    }];
    const current = [{
      name: "users",
      columns: [{ name: "name", type: "VARCHAR", length: 100 }]
    }];

    const diff = engine.compute(desired, current);
    expect(diff.modifyColumns).toHaveLength(1);
  });

  it("reports empty diff when equal", () => {
    const schema = [{ name: "users", columns: [{ name: "id", type: "INTEGER" }] }];

    const diff = engine.compute(schema, schema);
    expect(engine.isEmpty(diff)).toBe(true);
  });

  it("detects new indexes", () => {
    const desired = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }],
      indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
    }];
    const current = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }],
    }];

    const diff = engine.compute(desired, current);
    expect(diff.addIndexes).toHaveLength(1);
    expect(diff.addIndexes[0].index.name).toBe("idx_users_email");
    expect(diff.addIndexes[0].table).toBe("users");
    expect(diff.addIndexes[0].index.unique).toBe(true);
  });

  it("detects indexes to drop", () => {
    const desired = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }],
    }];
    const current = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }],
      indexes: [{ name: "idx_users_email", columns: ["email"] }],
    }];

    const diff = engine.compute(desired, current);
    expect(diff.dropIndexes).toHaveLength(1);
    expect(diff.dropIndexes[0].index).toBe("idx_users_email");
    expect(diff.dropIndexes[0].table).toBe("users");
  });

  it("detects index changes (unique flag)", () => {
    const desired = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }],
      indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
    }];
    const current = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }],
      indexes: [{ name: "idx_users_email", columns: ["email"], unique: false }],
    }];

    const diff = engine.compute(desired, current);
    expect(diff.dropIndexes).toHaveLength(1);
    expect(diff.addIndexes).toHaveLength(1);
    expect(diff.addIndexes[0].index.unique).toBe(true);
  });

  it("detects index changes (columns)", () => {
    const desired = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }, { name: "name", type: "VARCHAR" }],
      indexes: [{ name: "idx_users_composite", columns: ["name", "email"] }],
    }];
    const current = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }, { name: "name", type: "VARCHAR" }],
      indexes: [{ name: "idx_users_composite", columns: ["email"] }],
    }];

    const diff = engine.compute(desired, current);
    expect(diff.dropIndexes).toHaveLength(1);
    expect(diff.addIndexes).toHaveLength(1);
    expect(diff.addIndexes[0].index.columns).toEqual(["name", "email"]);
  });

  it("reports no index diff when indexes are equal", () => {
    const schema = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }],
      indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
    }];

    const diff = engine.compute(schema, schema);
    expect(diff.addIndexes).toHaveLength(0);
    expect(diff.dropIndexes).toHaveLength(0);
    expect(engine.isEmpty(diff)).toBe(true);
  });

  it("reports empty diff when both have no indexes", () => {
    const schema = [{
      name: "users",
      columns: [{ name: "id", type: "INTEGER" }],
    }];

    const diff = engine.compute(schema, schema);
    expect(engine.isEmpty(diff)).toBe(true);
  });

  it("detects multiple index changes on same table", () => {
    const desired = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }, { name: "name", type: "VARCHAR" }],
      indexes: [
        { name: "idx_users_email", columns: ["email"], unique: true },
        { name: "idx_users_name", columns: ["name"] },
      ],
    }];
    const current = [{
      name: "users",
      columns: [{ name: "email", type: "VARCHAR" }, { name: "name", type: "VARCHAR" }],
      indexes: [
        { name: "idx_users_email", columns: ["email"] },
      ],
    }];

    const diff = engine.compute(desired, current);
    // idx_users_email changed (unique false -> true): drop + add
    // idx_users_name is new: add
    expect(diff.addIndexes).toHaveLength(2);
    expect(diff.dropIndexes).toHaveLength(1);
  });
});
