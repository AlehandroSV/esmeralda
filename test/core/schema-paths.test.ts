import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  resolvePaths,
  pickDefaultSchema,
  slugifyDbName,
} from "../../src/core/schema-paths.js";
import { generateBarrel } from "../../src/cli/generate.js";

let tmp: string;

function writeConfig(content: string): void {
  fs.writeFileSync(path.join(tmp, "jade.config.lua"), content, "utf-8");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "esmeralda-paths-"));
  fs.mkdirSync(path.join(tmp, "schema"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("slugifyDbName", () => {
  it("lowercases and sanitizes", () => {
    expect(slugifyDbName("Analytics")).toBe("analytics");
    expect(slugifyDbName("legacy DB")).toBe("legacy_db");
    expect(slugifyDbName("my-db_1")).toBe("my-db_1");
  });
});

describe("pickDefaultSchema", () => {
  it("prefers models.jade over other .jade files", () => {
    fs.writeFileSync(path.join(tmp, "schema", "aaa_models.jade"), "model A {}");
    fs.writeFileSync(path.join(tmp, "schema", "models.jade"), "model User {}");
    expect(pickDefaultSchema(tmp)).toBe(path.join(tmp, "schema", "models.jade"));
  });

  it("falls back to first .jade sorted", () => {
    fs.writeFileSync(path.join(tmp, "schema", "zzz.jade"), "model Z {}");
    fs.writeFileSync(path.join(tmp, "schema", "aaa.jade"), "model A {}");
    expect(pickDefaultSchema(tmp)).toBe(path.join(tmp, "schema", "aaa.jade"));
  });

  it("falls back to schema.lua when no .jade", () => {
    expect(pickDefaultSchema(tmp)).toBe(path.join(tmp, "schema.lua"));
  });
});

describe("resolvePaths (single-db)", () => {
  it("uses default paths when no multi-db config", () => {
    fs.writeFileSync(path.join(tmp, "schema", "models.jade"), "model User {}");
    writeConfig(`return { driver = "sqlite", database = "app.db" }\n`);

    const p = resolvePaths(tmp);
    expect(p.isDefault).toBe(true);
    expect(p.schemaPath).toBe(path.join(tmp, "schema", "models.jade"));
    expect(p.migrationsDir).toBe(path.join(tmp, "migrations"));
    expect(p.modelsDir).toBe(path.join(tmp, "jade", "generated"));
    expect(p.requirePath).toBe("jade.generated");
  });

  it("honors explicit schema path", () => {
    fs.writeFileSync(path.join(tmp, "schema", "custom.jade"), "model X {}");
    const p = resolvePaths(tmp, undefined, "schema/custom.jade");
    expect(p.schemaPath).toBe(path.join(tmp, "schema", "custom.jade"));
  });
});

describe("resolvePaths (multi-db) without lua", () => {
  // parseMultiDbConfig shells out to lua; when lua is missing it returns null.
  // We still assert single-db fallback and naming helpers used by generate -d.

  it("treats named db as non-default when multi-db parse fails (no lua)", () => {
    writeConfig(`
return {
  default = "primary",
  databases = {
    primary = { driver = "sqlite", database = "main.db" },
    analytics = { driver = "sqlite", database = "analytics.db" },
  }
}
`);
    const p = resolvePaths(tmp, "analytics");
    // Without lua, parseMultiDbConfig is null → falls through to single-db paths,
    // but schema path for a non-default name still uses {db}_models.jade.
    expect(p.dbLabel).toBe("analytics");
    expect(p.schemaPath).toBe(path.join(tmp, "schema", "analytics_models.jade"));
  });
});

describe("generateBarrel multi-db requirePath", () => {
  it("uses custom require path for secondary db", () => {
    const barrel = generateBarrel(["Event"], "jade.generated.analytics");
    expect(barrel).toContain('require("jade.generated.analytics")');
    expect(barrel).toContain('pcall(require, "jade.generated.analytics." .. key)');
    expect(barrel).toContain('local path = "jade/generated/analytics/" .. key .. ".lua"');
  });

  it("keeps default require path", () => {
    const barrel = generateBarrel(["User"]);
    expect(barrel).toContain('pcall(require, "jade.generated." .. key)');
    expect(barrel).toContain('local path = "jade/generated/" .. key .. ".lua"');
  });
});
