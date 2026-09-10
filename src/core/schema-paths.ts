import * as fs from "fs";
import * as path from "path";
import { getDatabaseConfig, parseMultiDbConfig } from "./multi-db.js";

export interface ResolvedPaths {
  /** Absolute path to the .jade schema for this database */
  schemaPath: string;
  /** Absolute path to migrations directory */
  migrationsDir: string;
  /** Absolute path to jade/generated models directory */
  modelsDir: string;
  /** Lua require path for the barrel (jade.generated or jade.generated.<db>) */
  requirePath: string;
  /** true when this is the default/primary database */
  isDefault: boolean;
  /** db label used in logs ("default" when unnamed) */
  dbLabel: string;
}

/** Normalize a database name into a filesystem-safe segment. */
export function slugifyDbName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
}

/**
 * Resolve schema / migrations / models paths for a database (ALINHAMENTO §7.3).
 *
 * Naming:
 *   - default / primary DB → schema/models.jade · migrations/ · jade/generated/
 *   - named secondary DB   → schema/{db}_models.jade · migrations/{db}/ · jade/generated/{db}/
 */
export function resolvePaths(
  projectRoot: string,
  dbName?: string,
  explicitSchema?: string
): ResolvedPaths {
  const multiDb = parseMultiDbConfig(projectRoot);
  const dbCfg = dbName ? getDatabaseConfig(projectRoot, dbName) : null;

  const defaultName = multiDb?.default || (multiDb ? Object.keys(multiDb.databases)[0] : undefined);
  const isDefault = !dbName || dbName === "default" || (!!defaultName && dbName === defaultName);
  const dbLabel = dbName && !isDefault ? slugifyDbName(dbName) : "default";

  let schemaPath: string;
  if (explicitSchema) {
    schemaPath = path.resolve(projectRoot, explicitSchema);
  } else if (!isDefault && dbLabel !== "default") {
    schemaPath = path.join(projectRoot, "schema", `${dbLabel}_models.jade`);
  } else {
    schemaPath = pickDefaultSchema(projectRoot);
  }

  let migrationsDir: string;
  let modelsDir: string;
  let requirePath: string;

  if (dbCfg && !isDefault) {
    // multi-db named secondary
    const slug = slugifyDbName(dbName!);
    migrationsDir = dbCfg.migrationsDir;
    modelsDir = path.join(projectRoot, "jade", "generated", slug);
    requirePath = `jade.generated.${slug}`;
  } else if (dbCfg && isDefault && multiDb) {
    // multi-db primary — still honor configured migrationPath if present
    migrationsDir = dbCfg.migrationsDir;
    modelsDir = path.join(projectRoot, "jade", "generated");
    requirePath = "jade.generated";
  } else {
    migrationsDir = path.join(projectRoot, "migrations");
    modelsDir = path.join(projectRoot, "jade", "generated");
    requirePath = "jade.generated";
  }

  return { schemaPath, migrationsDir, modelsDir, requirePath, isDefault, dbLabel };
}

/** Prefer schema/models.jade; fall back to first .jade; then schema.lua. */
export function pickDefaultSchema(projectRoot: string): string {
  const schemaDir = path.join(projectRoot, "schema");
  if (fs.existsSync(schemaDir)) {
    const files = fs.readdirSync(schemaDir).filter(f => f.endsWith(".jade"));
    const preferred = files.find(f => f === "models.jade");
    if (preferred) return path.join(schemaDir, preferred);
    if (files.length > 0) return path.join(schemaDir, files.sort()[0]);
  }
  return path.join(projectRoot, "schema.lua");
}
