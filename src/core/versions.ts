import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/logger.js";

export interface EnvironmentCheck {
  name: string;
  ok: boolean;
  version?: string;
  detail?: string;
}

function tryExec(bin: string, args: string[]): string | null {
  try {
    const out = execFileSync(bin, args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return (out || "").trim();
  } catch {
    return null;
  }
}

function parseFirstLine(output: string | null): string | undefined {
  if (!output) return undefined;
  return output.split(/\r?\n/)[0]?.trim();
}

/** Best-effort version probes for Lua, Jade, and Esmeralda. */
export function checkEnvironment(projectRoot?: string): EnvironmentCheck[] {
  const results: EnvironmentCheck[] = [];

  // Lua / LuaJIT
  let luaOut = tryExec("lua", ["-v"]) || tryExec("lua5.4", ["-v"]) ||
    tryExec("lua5.3", ["-v"]) || tryExec("lua5.2", ["-v"]) ||
    tryExec("luajit", ["-v"]);
  // lua -v often prints to stderr; execFileSync with pipe may miss it on some platforms
  if (!luaOut) {
    try {
      luaOut = execFileSync("lua", ["-v"], { encoding: "utf-8", stdio: "pipe", timeout: 5000 }) as unknown as string;
    } catch (e: any) {
      luaOut = e?.stdout?.toString?.() || e?.stderr?.toString?.() || null;
    }
  }
  const luaVersion = parseFirstLine(luaOut);
  results.push({
    name: "Lua",
    ok: !!luaVersion,
    version: luaVersion,
    detail: luaVersion ? undefined : "lua not found in PATH (lua, lua5.x or luajit)",
  });

  // Jade (JADE_PATH or sibling ../jade)
  let jadeVersion: string | undefined;
  const candidates: string[] = [];
  if (process.env.JADE_PATH) {
    candidates.push(path.join(process.env.JADE_PATH, "jade", "_VERSION.lua"));
    candidates.push(path.join(process.env.JADE_PATH, "_VERSION.lua"));
  }
  if (projectRoot) {
    candidates.push(path.join(projectRoot, "jade", "src", "jade", "_VERSION.lua"));
    candidates.push(path.join(projectRoot, "..", "jade", "src", "jade", "_VERSION.lua"));
    candidates.push(path.join(projectRoot, "..", "..", "jade", "src", "jade", "_VERSION.lua"));
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const raw = fs.readFileSync(c, "utf-8");
        const m = raw.match(/["']([^"']+)["']/);
        jadeVersion = m?.[1];
        break;
      }
    } catch {
      /* ignore */
    }
  }
  // Fallback: luarocks show jade
  if (!jadeVersion) {
    const rocks = tryExec("luarocks", ["show", "jade", "--field=version"]);
    jadeVersion = parseFirstLine(rocks) || undefined;
  }
  results.push({
    name: "Jade",
    ok: !!jadeVersion,
    version: jadeVersion,
    detail: jadeVersion
      ? undefined
      : "Jade not found — install via luarocks or set JADE_PATH",
  });

  // Esmeralda (this CLI)
  let esmeraldaVersion = "0.0.0";
  try {
    const pkgPath = path.join(__dirname, "..", "..", "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      esmeraldaVersion = pkg.version || esmeraldaVersion;
    }
  } catch {
    /* keep default */
  }
  results.push({
    name: "Esmeralda",
    ok: true,
    version: esmeraldaVersion,
  });

  return results;
}

/** Log environment report. Returns false if a hard requirement is missing. */
export function reportEnvironment(projectRoot?: string, strict = false): boolean {
  const checks = checkEnvironment(projectRoot);
  Logger.info("Environment:");
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    const ver = c.version ? ` ${c.version}` : "";
    Logger.info(`  ${mark} ${c.name}${ver}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  const failed = checks.filter(c => !c.ok);
  if (failed.length > 0) {
    if (strict) {
      Logger.error("Environment check failed. Fix the items above and retry.");
      return false;
    }
    Logger.warn("Some tools were not found. Scaffold will continue; generate/migrate may fail later.");
  }
  return true;
}
