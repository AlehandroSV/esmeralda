import type { IndexDef } from "./diff-engine.js";

export interface ColumnDef {
  name: string;
  type: string;
  length?: number;
  primaryKey?: boolean;
  unique?: boolean;
  notNull?: boolean;
  default?: any;
  references?: { table: string; column: string };
  /** Enum values, e.g. ["pending", "approved", "rejected"] */
  enumValues?: string[];
  /** When true, use cuid() / 'cuid'::text as default (like Jade.CUID) */
  cuidDefault?: boolean;
  /** When true, use nanoid() / 'nanoid'::text as default (like Jade.NanoID) */
  nanoidDefault?: boolean;
  /** Column uses soft delete pattern */
  softDelete?: boolean;
  /** Column is encrypted */
  encrypted?: boolean;
}

export { IndexDef } from "./diff-engine.js";

export interface RelationDef {
  type: "belongsTo" | "hasMany" | "hasOne" | "hasAndBelongsToMany" | "hasManyThrough";
  model: string;
  foreignKey?: string;
  through?: string;
}

export type CallbackType =
  | "beforeCreate" | "afterCreate"
  | "beforeUpdate" | "afterUpdate"
  | "beforeDelete" | "afterDelete"
  | "beforeSave" | "afterSave"
  | "aroundCreate" | "aroundUpdate" | "aroundDelete" | "aroundSave";

export interface ValidationDef {
  type: "presence" | "uniqueness" | "length" | "format" | "inclusion" | "numericality" | "custom";
  field: string;
  options?: Record<string, any>;
}

export interface ScopeDef {
  name: string;
}

export interface EntityDef {
  name: string;
  tableName: string;
  columns: ColumnDef[];
  indexes?: IndexDef[];
  relations?: RelationDef[];
  callbacks?: CallbackType[];
  validations?: ValidationDef[];
  scopes?: ScopeDef[];
  softDelete?: boolean;
  optimisticLocking?: boolean;
}

export interface ValidationError {
  entity: string;
  column?: string;
  message: string;
}

export function parseSchemaFile(content: string): EntityDef[] {
  const entities: EntityDef[] = [];

  // Match Jade.Entity("table_name", { or Entity("table_name", {
  const entityRegex = /(?:Jade\.)?Entity\s*\(\s*["'](\w+)["']\s*,\s*\{/g;
  let match;

  while ((match = entityRegex.exec(content)) !== null) {
    const tableName = match[1];
    const blockStart = match.index + match[0].length;

    // Find matching closing brace by counting depth
    let depth = 1;
    let blockEnd = blockStart;
    while (blockEnd < content.length && depth > 0) {
      if (content[blockEnd] === "{") depth++;
      if (content[blockEnd] === "}") depth--;
      blockEnd++;
    }

    const entityBlock = content.substring(match.index, blockEnd);
    const columnsBlock = content.substring(blockStart, blockEnd - 1);
    const columns = parseColumns(columnsBlock);
    const indexes = parseIndexes(columnsBlock);
    const relations = parseRelations(columnsBlock);

    // Parse entity-level features from outside the column block
    const callbacks = parseCallbacks(entityBlock);
    const validations = parseValidations(entityBlock);
    const scopes = parseScopes(entityBlock);
    const softDelete = /softDelete\s*\(\s*\)/.test(entityBlock);
    const optimisticLocking = /optimisticLocking\s*\(\s*\)/.test(entityBlock);

    // Mark soft delete columns
    if (softDelete) {
      for (const col of columns) {
        if (col.name === "deleted_at" || col.name === "deleted") {
          col.softDelete = true;
        }
      }
    }

    // Infer entity name from table name
    const name = tableName.charAt(0).toUpperCase() + tableName.slice(1);

    entities.push({
      name,
      tableName,
      columns,
      indexes: indexes.length > 0 ? indexes : undefined,
      relations: relations.length > 0 ? relations : undefined,
      callbacks: callbacks.length > 0 ? callbacks : undefined,
      validations: validations.length > 0 ? validations : undefined,
      scopes: scopes.length > 0 ? scopes : undefined,
      softDelete: softDelete || undefined,
      optimisticLocking: optimisticLocking || undefined,
    });
  }

  return entities;
}

function parseColumns(block: string): ColumnDef[] {
  const columns: ColumnDef[] = [];

  // Split by lines and parse each line
  const lines = block.split('\n');

  for (const line of lines) {
    // Match: name = Jade.Type(args):modifiers
    const match = line.match(/(\w+)\s*=\s*(\w+(?:\.\w+)*)\s*\(([^)]*)\)(.*)/);
    if (!match) continue;

    const name = match[1];
    const fullType = match[2];
    const args = match[3];
    const modifiers = match[4];

    // Extract type name (e.g., "Jade.Integer" -> "Integer")
    const typeName = fullType.split('.').pop() || fullType;

    const column: ColumnDef = {
      name,
      type: mapType(typeName),
    };

    // Parse length from args
    if (args && args.trim()) {
      const length = parseInt(args.trim(), 10);
      if (!isNaN(length)) {
        column.length = length;
      } else {
        // Enum values: parse comma-separated quoted strings
        const quotedValues = args.match(/['"]([^'"]*)['"]/g);
        if (quotedValues) {
          column.enumValues = quotedValues.map((v) => v.slice(1, -1));
        }
      }
    }

    // Detect CUID and NanoID by type name — no args, but they auto-generate IDs
    if (typeName === "CUID") column.cuidDefault = true;
    if (typeName === "NanoID") column.nanoidDefault = true;

    // Parse modifiers
    if (modifiers) {
      if (modifiers.includes("primaryKey")) column.primaryKey = true;
      if (modifiers.includes("unique")) column.unique = true;
      if (modifiers.includes("notNull")) column.notNull = true;
      if (modifiers.includes("encrypted")) column.encrypted = true;

      const defaultMatch = modifiers.match(/default\s*\(([^)]+)\)/);
      if (defaultMatch) {
        column.default = defaultMatch[1];
      }
      if (modifiers.includes("defaultNow")) {
        column.default = "CURRENT_TIMESTAMP";
      }

      // Parse references
      const refsMatch = modifiers.match(/references\s*\(\s*["']?(\w+)["']?\s*(?:,\s*["']?(\w+)["']?)?\s*\)/);
      if (refsMatch) {
        column.references = {
          table: refsMatch[1],
          column: refsMatch[2] || "id",
        };
      }
    }

    columns.push(column);
  }

  return columns;
}

function parseIndexes(block: string): IndexDef[] {
  const indexes: IndexDef[] = [];

  // Match: Jade.Index("name", { "col1", "col2" }, { unique = true })
  const indexRegex = /(?:Jade\.)?Index\s*\(\s*["']([^"']+)["']\s*,\s*\{([^}]+)\}\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
  let match;

  while ((match = indexRegex.exec(block)) !== null) {
    const name = match[1];
    const columnsStr = match[2];
    const optionsStr = match[3] || "";

    const columns = columnsStr
      .split(",")
      .map(c => c.trim().replace(/["']/g, ""))
      .filter(c => c.length > 0);

    const unique = optionsStr.includes("unique") && /unique\s*=\s*true/.test(optionsStr);

    indexes.push({ name, columns, unique: unique || undefined });
  }

  return indexes;
}

function parseRelations(block: string): RelationDef[] {
  const relations: RelationDef[] = [];
  const relationTypes = ["belongsTo", "hasMany", "hasOne", "hasAndBelongsToMany", "hasManyThrough"] as const;

  for (const relType of relationTypes) {
    const relRegex = new RegExp(relType + `\\s*\\(\\s*["'](\\w+)["']\\s*(?:,\\s*\\{([^}]*)\\})?\\s*\\)`, "g");
    let match;
    while ((match = relRegex.exec(block)) !== null) {
      const relation: RelationDef = { type: relType, model: match[1] };
      if (match[2]) {
        const fkMatch = match[2].match(/foreign_key\s*=\s*["'](\w+)["']/);
        if (fkMatch) relation.foreignKey = fkMatch[1];
        const throughMatch = match[2].match(/through\s*=\s*["'](\w+)["']/);
        if (throughMatch) relation.through = throughMatch[1];
      }
      relations.push(relation);
    }
  }

  return relations;
}

const CALLBACK_TYPES: CallbackType[] = [
  "beforeCreate", "afterCreate", "beforeUpdate", "afterUpdate",
  "beforeDelete", "afterDelete", "beforeSave", "afterSave",
  "aroundCreate", "aroundUpdate", "aroundDelete", "aroundSave",
];

function parseCallbacks(block: string): CallbackType[] {
  const found: CallbackType[] = [];
  for (const cb of CALLBACK_TYPES) {
    if (new RegExp(cb + "\\s*\\(").test(block)) {
      found.push(cb);
    }
  }
  return found;
}

function parseValidations(block: string): ValidationDef[] {
  const validations: ValidationDef[] = [];
  const patterns: Array<{ regex: RegExp; type: ValidationDef["type"] }> = [
    { regex: /validatePresenceOf\s*\(\s*["'](\w+)["']/g, type: "presence" },
    { regex: /validateUniquenessOf\s*\(\s*["'](\w+)["']/g, type: "uniqueness" },
    { regex: /validateLengthOf\s*\(\s*["'](\w+)["']/g, type: "length" },
    { regex: /validateFormatOf\s*\(\s*["'](\w+)["']/g, type: "format" },
    { regex: /validateInclusionOf\s*\(\s*["'](\w+)["']/g, type: "inclusion" },
    { regex: /validateNumericalityOf\s*\(\s*["'](\w+)["']/g, type: "numericality" },
  ];

  for (const { regex, type } of patterns) {
    let match;
    while ((match = regex.exec(block)) !== null) {
      validations.push({ type, field: match[1] });
    }
  }

  // Custom validations: validateCustom("name", ...)
  const customRegex = /validateCustom\s*\(\s*["'](\w+)["']/g;
  let customMatch;
  while ((customMatch = customRegex.exec(block)) !== null) {
    validations.push({ type: "custom", field: customMatch[1] });
  }

  return validations;
}

function parseScopes(block: string): ScopeDef[] {
  const scopes: ScopeDef[] = [];
  const scopeRegex = /scope\s*\(\s*["'](\w+)["']/g;
  let match;
  while ((match = scopeRegex.exec(block)) !== null) {
    scopes.push({ name: match[1] });
  }
  return scopes;
}

export function mapType(typeName: string): string {
  const typeMap: Record<string, string> = {
    "String":   "VARCHAR",
    "Text":     "TEXT",
    "Integer":  "INTEGER",
    "BigInt":   "BIGINT",
    "Float":    "FLOAT",
    "Decimal":  "DECIMAL",
    "Boolean":  "BOOLEAN",
    "Timestamp":"TIMESTAMP",
    "Date":     "DATE",
    "UUID":     "UUID",
    "JSON":     "JSON",
    "CUID":     "VARCHAR(25)",
    "NanoID":   "VARCHAR(21)",
    "Enum":     "VARCHAR",
  };

  return typeMap[typeName] || "TEXT";
}

export function validateSchema(entities: EntityDef[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const tableNames = new Set<string>();

  for (const entity of entities) {
    // Check for duplicate table names
    if (tableNames.has(entity.tableName)) {
      errors.push({
        entity: entity.name,
        message: `Duplicate table name: ${entity.tableName}`,
      });
    }
    tableNames.add(entity.tableName);

    // Check for duplicate column names
    const cols = new Set<string>();
    for (const col of entity.columns) {
      if (cols.has(col.name)) {
        errors.push({
          entity: entity.name,
          column: col.name,
          message: `Duplicate column name: ${col.name}`,
        });
      }
      cols.add(col.name);
    }

    // Check for primary key
    const hasPrimaryKey = entity.columns.some(c => c.primaryKey);
    if (!hasPrimaryKey) {
      errors.push({
        entity: entity.name,
        message: "No primary key defined",
      });
    }

    // Check for table name format
    if (!/^[a-z_][a-z0-9_]*$/.test(entity.tableName)) {
      errors.push({
        entity: entity.name,
        message: `Invalid table name format: ${entity.tableName}`,
      });
    }

    // Check column names
    for (const col of entity.columns) {
      if (!/^[a-z_][a-z0-9_]*$/.test(col.name)) {
        errors.push({
          entity: entity.name,
          column: col.name,
          message: `Invalid column name format: ${col.name}`,
        });
      }
    }
  }

  return errors;
}