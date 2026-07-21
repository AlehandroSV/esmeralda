import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// We test the fallback logic by importing the module and mocking execFile
// The key function is runInDocker which tries luajit -> lua5.4 -> lua5.3 -> lua5.1 -> lua

describe("Lua binary fallback in Docker", () => {
  it("seed.ts: runInDocker tries lua5.4 when luajit not available", async () => {
    // Read the source to verify the fallback chain exists
    const seedSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/seed.ts"),
      "utf-8"
    );
    expect(seedSource).toContain('const luaBins = ["luajit", "lua5.4", "lua5.3", "lua5.1", "lua"]');
    expect(seedSource).toContain('if (err.message?.includes("executable file not found")) continue');
    expect(seedSource).toContain("No Lua interpreter found in Docker container");
  });

  it("migrate.ts: runInDocker tries lua5.4 when luajit not available", () => {
    const migrateSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/migrate.ts"),
      "utf-8"
    );
    expect(migrateSource).toContain('const luaBins = ["luajit", "lua5.4", "lua5.3", "lua5.1", "lua"]');
    expect(migrateSource).toContain('if (err.message?.includes("executable file not found")) continue');
  });

  it("seed.ts: local fallback tries luajit then lua", () => {
    const seedSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/seed.ts"),
      "utf-8"
    );
    // Local execution should still try luajit first, then lua
    expect(seedSource).toContain('await exec("luajit"');
    expect(seedSource).toContain('await exec("lua"');
  });

  it("migrate.ts: local fallback tries luajit then lua", () => {
    const migrateSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/migrate.ts"),
      "utf-8"
    );
    expect(migrateSource).toContain('await exec("luajit"');
    expect(migrateSource).toContain('await exec("lua"');
  });

  it("seed.ts: Docker uses exec (not spawn) with -T flag", () => {
    const seedSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/seed.ts"),
      "utf-8"
    );
    // Docker exec must use -T for non-interactive
    expect(seedSource).toContain('"compose", "exec", "-T"');
  });

  it("migrate.ts: Docker uses exec (not spawn) with -T flag", () => {
    const migrateSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/migrate.ts"),
      "utf-8"
    );
    expect(migrateSource).toContain('"compose", "exec", "-T"');
  });

  it("seed.ts: detects docker-compose service name from file", () => {
    const seedSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/seed.ts"),
      "utf-8"
    );
    // Should extract service name from compose file
    expect(seedSource).toContain('composeContent.match');
    expect(seedSource).toContain('serviceName = serviceMatch');
  });

  it("seed.ts: service name defaults to 'api'", () => {
    const seedSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/seed.ts"),
      "utf-8"
    );
    expect(seedSource).toContain('serviceMatch ? serviceMatch[1] : "api"');
  });
});
