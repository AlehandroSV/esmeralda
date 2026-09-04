import * as fs from "fs";
import * as path from "path";
import { EntityDef } from "./schema-parser.js";
import type { IndexDef } from "./diff-engine.js";

const STATE_FILE = ".esmeralda-state.json";

export interface SchemaStateEntity {
  name: string;
  tableName: string;
  columns: { name: string; type: string; length?: number }[];
  indexes?: IndexDef[];
}

export interface SchemaState {
  version: string;
  updated_at: string;
  entities: SchemaStateEntity[];
}

function isValidState(data: any): data is SchemaState {
  return data != null &&
    typeof data === "object" &&
    typeof data.version === "string" &&
    Array.isArray(data.entities);
}

export function loadState(projectRoot: string): SchemaState | null {
  const filePath = path.join(projectRoot, STATE_FILE);
  if (!fs.existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return isValidState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveState(projectRoot: string, entities: EntityDef[]): void {
  const state: SchemaState = {
    version: "1.0.0",
    updated_at: new Date().toISOString(),
    entities: entities.map(e => ({
      name: e.name,
      tableName: e.tableName,
      columns: e.columns.map(c => ({
        name: c.name,
        type: c.type,
        length: c.length,
      })),
      indexes: e.indexes,
    })),
  };

  const filePath = path.join(projectRoot, STATE_FILE);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function createEmptyState(): SchemaState {
  return {
    version: "1.0.0",
    updated_at: new Date().toISOString(),
    entities: [],
  };
}

export function inferMigrationName(current: EntityDef[], state: SchemaState | null): string {
  const currentTables = [...new Set(current.map(e => e.tableName))].sort();

  // No state file — everything is new
  if (!state || state.entities.length === 0) {
    return currentTables.length > 0 ? "create_" + currentTables.join("_") : "migration";
  }

  const previousTables = new Set(state.entities.map(e => e.tableName));
  const currentTableSet = new Set(currentTables);

  const added = currentTables.filter(t => !previousTables.has(t));
  const removed = [...previousTables].filter(t => !currentTableSet.has(t)).sort();

  const parts: string[] = [];
  if (added.length > 0) parts.push("create_" + added.join("_"));
  if (removed.length > 0) parts.push("remove_" + removed.join("_"));

  if (parts.length > 0) return parts.join("_and_");

  // No table-level changes
  return currentTables.length > 0 ? "alter_" + currentTables.join("_") : "migration";
}
