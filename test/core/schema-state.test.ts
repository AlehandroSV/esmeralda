import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadState, saveState, createEmptyState, inferMigrationName } from "../../src/core/schema-state.js";
import { EntityDef } from "../../src/core/schema-parser.js";

function makeEntity(tableName: string, columns: { name: string; type: string }[]): EntityDef {
  return {
    name: tableName.charAt(0).toUpperCase() + tableName.slice(1),
    tableName,
    columns: columns.map(c => ({ name: c.name, type: c.type })),
  };
}

describe("Schema State", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "esmeralda-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadState", () => {
    it("returns null when file doesn't exist", () => {
      expect(loadState(tmpDir)).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "esmeralda-state.json"), "not json");
      expect(loadState(tmpDir)).toBeNull();
    });

    it("loads valid state file", () => {
      const state = {
        version: "1.0.0",
        updated_at: "2026-01-01T00:00:00Z",
        entities: [{ name: "User", tableName: "users", columns: [] }],
      };
      fs.writeFileSync(path.join(tmpDir, "esmeralda-state.json"), JSON.stringify(state));

      const loaded = loadState(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.entities).toHaveLength(1);
      expect(loaded!.entities[0].tableName).toBe("users");
    });

    it("returns null for valid JSON with wrong shape", () => {
      fs.writeFileSync(path.join(tmpDir, "esmeralda-state.json"), '{"foo":"bar"}');
      expect(loadState(tmpDir)).toBeNull();
    });

    it("returns null for empty object (missing entities array)", () => {
      fs.writeFileSync(path.join(tmpDir, "esmeralda-state.json"), '{"version":"1.0.0"}');
      expect(loadState(tmpDir)).toBeNull();
    });
  });

  describe("saveState", () => {
    it("writes state file with entities", () => {
      const entities = [
        makeEntity("users", [{ name: "id", type: "INTEGER" }, { name: "name", type: "VARCHAR" }]),
      ];

      saveState(tmpDir, entities);

      const content = JSON.parse(fs.readFileSync(path.join(tmpDir, "esmeralda-state.json"), "utf-8"));
      expect(content.version).toBe("1.0.0");
      expect(content.entities).toHaveLength(1);
      expect(content.entities[0].tableName).toBe("users");
      expect(content.entities[0].columns).toHaveLength(2);
    });

    it("overwrites existing state", () => {
      saveState(tmpDir, [makeEntity("users", [{ name: "id", type: "INTEGER" }])]);
      saveState(tmpDir, [
        makeEntity("users", [{ name: "id", type: "INTEGER" }]),
        makeEntity("posts", [{ name: "id", type: "INTEGER" }]),
      ]);

      const loaded = loadState(tmpDir);
      expect(loaded!.entities).toHaveLength(2);
    });
  });

  describe("createEmptyState", () => {
    it("returns valid empty state", () => {
      const state = createEmptyState();
      expect(state.version).toBe("1.0.0");
      expect(state.entities).toEqual([]);
      expect(state.updated_at).toBeTruthy();
    });
  });

  describe("inferMigrationName", () => {
    it("returns create_X when no state exists", () => {
      const entities = [
        makeEntity("users", []),
        makeEntity("posts", []),
      ];

      expect(inferMigrationName(entities, null)).toBe("create_posts_users");
    });

    it("returns alter_X when schema hasn't changed", () => {
      const entities = [makeEntity("users", [])];
      const state = {
        version: "1.0.0",
        updated_at: "",
        entities: [{ name: "User", tableName: "users", columns: [] }],
      };

      expect(inferMigrationName(entities, state)).toBe("alter_users");
    });

    it("returns create_X for new tables", () => {
      const entities = [
        makeEntity("users", []),
        makeEntity("comments", []),
      ];
      const state = {
        version: "1.0.0",
        updated_at: "",
        entities: [{ name: "User", tableName: "users", columns: [] }],
      };

      expect(inferMigrationName(entities, state)).toBe("create_comments");
    });

    it("returns remove_X for removed tables", () => {
      const entities = [makeEntity("users", [])];
      const state = {
        version: "1.0.0",
        updated_at: "",
        entities: [
          { name: "User", tableName: "users", columns: [] },
          { name: "Tag", tableName: "tags", columns: [] },
        ],
      };

      expect(inferMigrationName(entities, state)).toBe("remove_tags");
    });

    it("returns create_X_and_remove_Y for mixed changes", () => {
      const entities = [
        makeEntity("users", []),
        makeEntity("comments", []),
      ];
      const state = {
        version: "1.0.0",
        updated_at: "",
        entities: [
          { name: "User", tableName: "users", columns: [] },
          { name: "Tag", tableName: "tags", columns: [] },
        ],
      };

      expect(inferMigrationName(entities, state)).toBe("create_comments_and_remove_tags");
    });

    it("returns create_X_Y_Z for empty state", () => {
      const entities = [
        makeEntity("users", []),
        makeEntity("posts", []),
        makeEntity("tags", []),
      ];
      const state = { version: "1.0.0", updated_at: "", entities: [] };

      expect(inferMigrationName(entities, state)).toBe("create_posts_tags_users");
    });

    it("returns remove_X_Y when all entities are removed", () => {
      const state = {
        version: "1.0.0",
        updated_at: "",
        entities: [
          { name: "User", tableName: "users", columns: [] },
          { name: "Tag", tableName: "tags", columns: [] },
        ],
      };

      expect(inferMigrationName([], state)).toBe("remove_tags_users");
    });

    it("returns 'migration' when both current and state are empty", () => {
      expect(inferMigrationName([], null)).toBe("migration");
      expect(inferMigrationName([], { version: "1.0.0", updated_at: "", entities: [] })).toBe("migration");
    });
  });
});
