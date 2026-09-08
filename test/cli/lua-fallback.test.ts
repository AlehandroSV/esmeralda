import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Lua binary detection in Docker", () => {
  it("lua-bridge.ts: detects lua binary via 'which' before executing", () => {
    const bridgeSource = fs.readFileSync(
      path.join(__dirname, "../../src/core/lua-bridge.ts"),
      "utf-8"
    );
    expect(bridgeSource).toContain('which ${bin}');
    expect(bridgeSource).toContain('const luaBins = ["luajit", "lua5.4", "lua5.3", "lua5.1", "lua"]');
  });

  it("lua-bridge.ts: Docker uses exec (not spawn) with -T flag", () => {
    const bridgeSource = fs.readFileSync(
      path.join(__dirname, "../../src/core/lua-bridge.ts"),
      "utf-8"
    );
    expect(bridgeSource).toContain('"compose", "exec", "-T"');
  });

  it("lua-bridge.ts: detects docker-compose service name from file", () => {
    const bridgeSource = fs.readFileSync(
      path.join(__dirname, "../../src/core/lua-bridge.ts"),
      "utf-8"
    );
    expect(bridgeSource).toContain('composeContent.match');
    expect(bridgeSource).toContain('serviceName = serviceMatch');
  });

  it("lua-bridge.ts: service name defaults to 'api'", () => {
    const bridgeSource = fs.readFileSync(
      path.join(__dirname, "../../src/core/lua-bridge.ts"),
      "utf-8"
    );
    expect(bridgeSource).toContain('serviceMatch ? serviceMatch[1] : "api"');
  });

  it("seed.ts: uses LuaBridge instead of direct exec", () => {
    const seedSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/seed.ts"),
      "utf-8"
    );
    expect(seedSource).toContain('import { LuaBridge }');
    expect(seedSource).toContain('new LuaBridge()');
    expect(seedSource).not.toContain('import { execFile }');
  });

  it("migrate.ts: uses LuaBridge instead of direct exec", () => {
    const migrateSource = fs.readFileSync(
      path.join(__dirname, "../../src/cli/migrate.ts"),
      "utf-8"
    );
    expect(migrateSource).toContain('import { LuaBridge');
    expect(migrateSource).toContain('new LuaBridge()');
    expect(migrateSource).not.toContain('import { execFile }');
  });

  it("db-pull.ts: uses LuaBridge instead of direct exec", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../src/cli/db-pull.ts"),
      "utf-8"
    );
    expect(source).toContain('import { LuaBridge');
    expect(source).toContain('new LuaBridge()');
    expect(source).not.toContain('import { execFile }');
  });

  it("db-sync.ts: uses LuaBridge instead of direct exec", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../src/cli/db-sync.ts"),
      "utf-8"
    );
    expect(source).toContain('import { LuaBridge');
    expect(source).toContain('new LuaBridge()');
    expect(source).not.toContain('import { execFile }');
  });

  it("db-push.ts: uses LuaBridge instead of direct exec", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../src/cli/db-push.ts"),
      "utf-8"
    );
    expect(source).toContain('import { LuaBridge }');
    expect(source).toContain('new LuaBridge()');
    expect(source).not.toContain('import { execFile }');
  });

  it("generate.ts: uses LuaBridge instead of direct exec", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../src/cli/generate.ts"),
      "utf-8"
    );
    expect(source).toContain('import { LuaBridge }');
    expect(source).toContain('new LuaBridge()');
    expect(source).not.toContain('import { execFile }');
  });

  it("migrate-rollback.ts: uses LuaBridge instead of direct exec", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../src/cli/migrate-rollback.ts"),
      "utf-8"
    );
    expect(source).toContain('import { LuaBridge }');
    expect(source).toContain('new LuaBridge()');
    expect(source).not.toContain('import { execFile }');
  });

  it("no CLI file uses -e with interpolated code", () => {
    const cliDir = path.join(__dirname, "../../src/cli");
    const files = fs.readdirSync(cliDir).filter(f => f.endsWith(".ts"));
    for (const file of files) {
      const source = fs.readFileSync(path.join(cliDir, file), "utf-8");
      expect(source).not.toContain('"-e",');
      expect(source).not.toContain("'-e',");
    }
  });
});
