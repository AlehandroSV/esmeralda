import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { findConfig, findProjectRoot, getConfigPath, CONFIG_EXTENSIONS } from "../../src/core/project.js";

describe("config discovery", () => {
  let tmpDir: string;
  let savedGlobalConfig: string | null = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "esmeralda-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.JADE_CONFIG_PATH;
  });

  it("finds jade.config.lua in current directory", () => {
    fs.writeFileSync(path.join(tmpDir, "jade.config.lua"), "return {}");
    const result = findConfig(tmpDir);
    expect(result).toBe(path.join(tmpDir, "jade.config.lua"));
  });

  it("finds jade.config.ts in current directory", () => {
    fs.writeFileSync(path.join(tmpDir, "jade.config.ts"), "export default {}");
    const result = findConfig(tmpDir);
    expect(result).toBe(path.join(tmpDir, "jade.config.ts"));
  });

  it("finds jade.config.js in current directory", () => {
    fs.writeFileSync(path.join(tmpDir, "jade.config.js"), "module.exports = {}");
    const result = findConfig(tmpDir);
    expect(result).toBe(path.join(tmpDir, "jade.config.js"));
  });

  it("finds config in parent directory", () => {
    fs.writeFileSync(path.join(tmpDir, "jade.config.lua"), "return {}");
    const childDir = path.join(tmpDir, "child");
    fs.mkdirSync(childDir);
    const result = findConfig(childDir);
    expect(result).toBe(path.join(tmpDir, "jade.config.lua"));
  });

  it("respects JADE_CONFIG_PATH env var", () => {
    const configPath = path.join(tmpDir, "custom-config.lua");
    fs.writeFileSync(configPath, "return {}");
    process.env.JADE_CONFIG_PATH = configPath;
    const result = findConfig(tmpDir);
    expect(result).toBe(configPath);
  });

  it("env var takes precedence over directory config", () => {
    const envConfig = path.join(tmpDir, "env-config.lua");
    const dirConfig = path.join(tmpDir, "jade.config.lua");
    fs.writeFileSync(envConfig, "return {}");
    fs.writeFileSync(dirConfig, "return {}");
    process.env.JADE_CONFIG_PATH = envConfig;
    const result = findConfig(tmpDir);
    expect(result).toBe(envConfig);
  });

  it("returns null when no config found", () => {
    const globalDir = path.join(os.homedir(), ".jade");
    const globalConfig = path.join(globalDir, "jade.config.lua");
    const hadGlobal = fs.existsSync(globalConfig);
    if (hadGlobal) fs.unlinkSync(globalConfig);

    const result = findConfig(tmpDir);

    if (hadGlobal) fs.writeFileSync(globalConfig, "return {}");
    expect(result).toBeNull();
  });

  it("findProjectRoot returns directory containing config", () => {
    fs.writeFileSync(path.join(tmpDir, "jade.config.lua"), "return {}");
    const result = findProjectRoot(tmpDir);
    expect(result).toBe(tmpDir);
  });

  it("findProjectRoot returns null when no config", () => {
    const globalDir = path.join(os.homedir(), ".jade");
    const globalConfig = path.join(globalDir, "jade.config.lua");
    const hadGlobal = fs.existsSync(globalConfig);
    if (hadGlobal) fs.unlinkSync(globalConfig);

    const result = findProjectRoot(tmpDir);

    if (hadGlobal) fs.writeFileSync(globalConfig, "return {}");
    expect(result).toBeNull();
  });

  it("getConfigPath returns config file path in directory", () => {
    fs.writeFileSync(path.join(tmpDir, "jade.config.lua"), "return {}");
    const result = getConfigPath(tmpDir);
    expect(result).toBe(path.join(tmpDir, "jade.config.lua"));
  });

  it("getConfigPath returns null when no config in directory", () => {
    const result = getConfigPath(tmpDir);
    expect(result).toBeNull();
  });

  it("CONFIG_EXTENSIONS includes lua, ts, js", () => {
    expect(CONFIG_EXTENSIONS).toContain(".lua");
    expect(CONFIG_EXTENSIONS).toContain(".ts");
    expect(CONFIG_EXTENSIONS).toContain(".js");
  });
});
