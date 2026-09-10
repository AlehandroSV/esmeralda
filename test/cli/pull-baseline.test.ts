import { describe, it, expect } from "vitest";
import { metaToEntity } from "../../src/cli/pull.js";

const meta = {
  columns: [
    {
      column_name: "id",
      data_type: "integer",
      character_maximum_length: null,
      is_nullable: "NO",
      column_default: "nextval('users_id_seq'::regclass)",
    },
    {
      column_name: "email",
      data_type: "character varying",
      character_maximum_length: 255,
      is_nullable: "NO",
      column_default: null,
    },
    {
      column_name: "active",
      data_type: "boolean",
      character_maximum_length: null,
      is_nullable: "YES",
      column_default: "true",
    },
  ],
  foreignKeys: [],
};

describe("metaToEntity", () => {
  it("skips conventional id column", () => {
    const e = metaToEntity("User", "users", meta);
    expect(e.tableName).toBe("users");
    expect(e.name).toBe("User");
    expect(e.columns.map(c => c.name)).toEqual(["email", "active"]);
  });

  it("maps types for state snapshot", () => {
    const e = metaToEntity("User", "users", meta);
    const email = e.columns.find(c => c.name === "email");
    expect(email?.type).toBe("String(255)");
    const active = e.columns.find(c => c.name === "active");
    expect(active?.type).toBe("Boolean()");
  });
});
