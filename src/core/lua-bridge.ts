import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const exec = promisify(execFile);

/**
 * Escape a string for safe embedding in a Lua string literal (double-quoted).
 * Handles backslashes, double quotes, single quotes, newlines, carriage returns, and null bytes.
 */
export function escapeLuaString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\0/g, "\\0");
}

/**
 * Validate that a name is a safe Lua/SQL identifier (alphanumeric + underscore, not starting with a digit).
 * Throws on invalid input to prevent injection via table/column names.
 */
export function validateLuaIdentifier(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: "${name}". Identifiers must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`);
  }
}

export class LuaBridge {
  private luaPath: string;

  constructor(luaPath = "lua") {
    this.luaPath = luaPath;
  }

  /**
   * Execute Lua code safely by writing to a temp file (avoids -e injection).
   * Pass user-controlled values via `args` — they are serialized as JSON into an ARGS global,
   * never interpolated into the code string.
   */
  async executeSafe(code: string, args: Record<string, any> = {}): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `jade_lua_${Date.now()}_${Math.random().toString(36).slice(2)}.lua`);
    try {
      const argsLua = `ARGS = ${JSON.stringify(args)}`;
      const fullCode = argsLua + "\n" + code;
      fs.writeFileSync(tmpFile, fullCode, "utf-8");
      const { stdout } = await exec(this.luaPath, [tmpFile]);
      return stdout.trim();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  /**
   * Execute Lua code safely and parse the result as JSON.
   */
  async executeSafeJson<T = any>(code: string, args: Record<string, any> = {}): Promise<T> {
    const stdout = await this.executeSafe(code, args);
    return JSON.parse(stdout);
  }

  /**
   * Execute Lua code safely inside a Docker container via docker compose exec.
   * Writes code to a local temp file, copies it into the container, and runs it there.
   */
  async executeSafeDocker(code: string, args: Record<string, any> = {}, projectRoot: string): Promise<string> {
    const { serviceName, luaBin } = await this.detectDocker(projectRoot);

    const tmpFile = path.join(os.tmpdir(), `jade_lua_${Date.now()}_${Math.random().toString(36).slice(2)}.lua`);
    const containerTmp = `/tmp/jade_lua_${Date.now()}.lua`;
    try {
      const argsLua = `ARGS = ${JSON.stringify(args)}`;
      const fullCode = argsLua + "\n" + code;
      fs.writeFileSync(tmpFile, fullCode, "utf-8");

      await exec("docker", [
        "compose", "exec", "-T", serviceName,
        "sh", "-c", `cat > ${containerTmp} <<'JADE_LUA_EOF'\n${fullCode}\nJADE_LUA_EOF`
      ], { cwd: projectRoot });

      const { stdout } = await exec("docker", [
        "compose", "exec", "-T", serviceName,
        luaBin, containerTmp
      ], { cwd: projectRoot });

      return stdout.trim();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
      try {
        await exec("docker", [
          "compose", "exec", "-T", serviceName,
          "rm", "-f", containerTmp
        ], { cwd: projectRoot });
      } catch {}
    }
  }

  /**
   * Execute Lua code safely in Docker and parse the result as JSON.
   */
  async executeSafeDockerJson<T = any>(code: string, args: Record<string, any> = {}, projectRoot: string): Promise<T> {
    const stdout = await this.executeSafeDocker(code, args, projectRoot);
    return JSON.parse(stdout);
  }

  /**
   * Detect the Docker service name and available Lua binary in the container.
   */
  private async detectDocker(projectRoot: string): Promise<{ serviceName: string; luaBin: string }> {
    const composeFile = fs.existsSync(path.join(projectRoot, "docker-compose.yml"))
      ? "docker-compose.yml" : "docker-compose.yaml";
    const composeContent = fs.readFileSync(path.join(projectRoot, composeFile), "utf-8");
    const serviceMatch = composeContent.match(/^\s{2}(\w+):/m);
    const serviceName = serviceMatch ? serviceMatch[1] : "api";

    const luaBins = ["luajit", "lua5.4", "lua5.3", "lua5.1", "lua"];
    let luaBin = luaBins[0];

    for (const bin of luaBins) {
      try {
        await exec("docker", [
          "compose", "exec", "-T", serviceName,
          "sh", "-c", `which ${bin} 2>/dev/null`
        ], { cwd: projectRoot });
        luaBin = bin;
        break;
      } catch {
        continue;
      }
    }

    return { serviceName, luaBin };
  }
}
