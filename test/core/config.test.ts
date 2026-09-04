import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  validateConfig,
  applyEnvOverrides,
  getConfigPath,
  getConfigPathForEnv,
  LUA_CONFIG_LOAD,
  type JadeConfig,
  type DatabaseConfig,
} from "../../src/core/config.js";

function makeConfig(overrides: Partial<DatabaseConfig> = {}): JadeConfig {
  return {
    database: {
      driver: "postgresql",
      host: "localhost",
      port: 5432,
      database: "testdb",
      user: "postgres",
      password: "",
      ...overrides,
    },
  };
}

describe("validateConfig", () => {
  it("accepts valid postgresql config", () => {
    expect(validateConfig(makeConfig())).toEqual([]);
  });

  it("accepts valid mysql config", () => {
    expect(validateConfig(makeConfig({ driver: "mysql", port: 3306, user: "root" }))).toEqual([]);
  });

  it("accepts valid sqlite config without host/port/user", () => {
    expect(validateConfig(makeConfig({ driver: "sqlite", host: undefined, port: undefined, user: undefined }))).toEqual([]);
  });

  it("accepts valid mariadb config", () => {
    expect(validateConfig(makeConfig({ driver: "mariadb" }))).toEqual([]);
  });

  it("rejects missing database config", () => {
    const errors = validateConfig({ database: undefined as any });
    expect(errors).toContain("database configuration is required");
  });

  it("rejects missing driver", () => {
    const errors = validateConfig(makeConfig({ driver: undefined as any }));
    expect(errors.some(e => e.includes("driver is required"))).toBe(true);
  });

  it("rejects unsupported driver", () => {
    const errors = validateConfig(makeConfig({ driver: "oracle" as any }));
    expect(errors.some(e => e.includes("not supported"))).toBe(true);
  });

  it("rejects missing host for postgresql", () => {
    const errors = validateConfig(makeConfig({ host: undefined }));
    expect(errors.some(e => e.includes("host is required"))).toBe(true);
  });

  it("rejects missing port for postgresql", () => {
    const errors = validateConfig(makeConfig({ port: undefined }));
    expect(errors.some(e => e.includes("port is required"))).toBe(true);
  });

  it("rejects missing database name", () => {
    const errors = validateConfig(makeConfig({ database: "" }));
    expect(errors.some(e => e.includes("database is required"))).toBe(true);
  });

  it("does not require host/port for sqlite", () => {
    const errors = validateConfig(makeConfig({ driver: "sqlite", host: undefined, port: undefined }));
    expect(errors.filter(e => e.includes("host") || e.includes("port"))).toEqual([]);
  });

  it("validates multi-database config", () => {
    const config: JadeConfig = {
      database: makeConfig().database,
      databases: {
        main: makeConfig().database,
        analytics: makeConfig({ driver: "mysql", database: "" }).database,
      },
    };
    const errors = validateConfig(config);
    expect(errors.some(e => e.includes("databases.analytics.database"))).toBe(true);
  });

  it("returns empty array for valid multi-database config", () => {
    const config: JadeConfig = {
      database: makeConfig().database,
      databases: {
        main: makeConfig().database,
        analytics: makeConfig({ driver: "mysql", port: 3306, user: "root", database: "analytics" }).database,
      },
    };
    expect(validateConfig(config)).toEqual([]);
  });
});

describe("applyEnvOverrides", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["JADE_DB_HOST", "JADE_DB_PORT", "JADE_DB_NAME", "JADE_DB_USER", "JADE_DB_PASSWORD", "JADE_DB_DRIVER"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns config unchanged when no env vars set", () => {
    const config = makeConfig();
    const result = applyEnvOverrides(config);
    expect(result.database.host).toBe("localhost");
  });

  it("overrides host from JADE_DB_HOST", () => {
    process.env.JADE_DB_HOST = "remote-host";
    const result = applyEnvOverrides(makeConfig());
    expect(result.database.host).toBe("remote-host");
  });

  it("overrides port from JADE_DB_PORT", () => {
    process.env.JADE_DB_PORT = "5433";
    const result = applyEnvOverrides(makeConfig());
    expect(result.database.port).toBe(5433);
  });

  it("overrides database from JADE_DB_NAME", () => {
    process.env.JADE_DB_NAME = "production_db";
    const result = applyEnvOverrides(makeConfig());
    expect(result.database.database).toBe("production_db");
  });

  it("overrides user from JADE_DB_USER", () => {
    process.env.JADE_DB_USER = "admin";
    const result = applyEnvOverrides(makeConfig());
    expect(result.database.user).toBe("admin");
  });

  it("overrides password from JADE_DB_PASSWORD", () => {
    process.env.JADE_DB_PASSWORD = "secret123";
    const result = applyEnvOverrides(makeConfig());
    expect(result.database.password).toBe("secret123");
  });

  it("overrides driver from JADE_DB_DRIVER", () => {
    process.env.JADE_DB_DRIVER = "mysql";
    const result = applyEnvOverrides(makeConfig());
    expect(result.database.driver).toBe("mysql");
  });

  it("overrides multi-database configs", () => {
    process.env.JADE_DB_HOST = "override-host";
    const config: JadeConfig = {
      database: makeConfig().database,
      databases: {
        main: makeConfig().database,
        analytics: makeConfig({ host: "analytics-host" }).database,
      },
    };
    const result = applyEnvOverrides(config);
    expect(result.databases!.main.host).toBe("override-host");
    expect(result.databases!.analytics.host).toBe("override-host");
  });

  it("does not mutate original config", () => {
    process.env.JADE_DB_HOST = "override";
    const config = makeConfig();
    applyEnvOverrides(config);
    expect(config.database.host).toBe("localhost");
  });
});

describe("getConfigPath", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no config exists", () => {
    expect(getConfigPath(tmpDir)).toBeNull();
  });

  it("finds jade.config.lua", () => {
    fs.writeFileSync(path.join(tmpDir, "jade.config.lua"), "return {}");
    const result = getConfigPath(tmpDir);
    expect(result).toContain("jade.config.lua");
  });

  it("prefers .lua over .ts and .js", () => {
    fs.writeFileSync(path.join(tmpDir, "jade.config.lua"), "return {}");
    fs.writeFileSync(path.join(tmpDir, "jade.config.ts"), "export default {}");
    const result = getConfigPath(tmpDir);
    expect(result).toContain("jade.config.lua");
  });

  it("finds jade.config.ts when .lua not present", () => {
    fs.writeFileSync(path.join(tmpDir, "jade.config.ts"), "export default {}");
    const result = getConfigPath(tmpDir);
    expect(result).toContain("jade.config.ts");
  });
});

describe("getConfigPathForEnv", () => {
  let tmpDir: string;
  const savedEnv = process.env.JADE_ENV;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-env-test-"));
    fs.writeFileSync(path.join(tmpDir, "jade.config.lua"), "return {}");
    delete process.env.JADE_ENV;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (savedEnv !== undefined) {
      process.env.JADE_ENV = savedEnv;
    } else {
      delete process.env.JADE_ENV;
    }
  });

  it("returns base config path and development env path by default", () => {
    const result = getConfigPathForEnv(tmpDir);
    expect(result.configPath).toContain("jade.config.lua");
    expect(result.envConfigPath).toContain("jade.config.development.lua");
  });

  it("uses JADE_ENV for env config path", () => {
    process.env.JADE_ENV = "production";
    const result = getConfigPathForEnv(tmpDir);
    expect(result.envConfigPath).toContain("jade.config.production.lua");
  });

  it("throws when no config file exists", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-empty-"));
    try {
      expect(() => getConfigPathForEnv(emptyDir)).toThrow("No jade.config.lua found");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("LUA_CONFIG_LOAD", () => {
  it("is a non-empty string", () => {
    expect(LUA_CONFIG_LOAD).toBeTruthy();
    expect(typeof LUA_CONFIG_LOAD).toBe("string");
  });

  it("references ARGS.configPath", () => {
    expect(LUA_CONFIG_LOAD).toContain("ARGS.configPath");
  });

  it("references ARGS.envConfigPath", () => {
    expect(LUA_CONFIG_LOAD).toContain("ARGS.envConfigPath");
  });

  it("uses pcall for safe loading", () => {
    expect(LUA_CONFIG_LOAD).toContain("pcall");
  });

  it("assigns config to _cfg variable", () => {
    expect(LUA_CONFIG_LOAD).toContain("_cfg");
  });
});
