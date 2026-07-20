import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export const CONFIG_EXTENSIONS = [".lua", ".ts", ".js"];
export const CONFIG_FILENAME = "jade.config";

function findConfigInDir(dir: string): string | null {
  for (const ext of CONFIG_EXTENSIONS) {
    const candidate = path.join(dir, `${CONFIG_FILENAME}${ext}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function findConfig(startDir: string = process.cwd()): string | null {
  const envPath = process.env.JADE_CONFIG_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  let current = startDir;
  while (true) {
    const found = findConfigInDir(current);
    if (found) return found;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const globalDir = path.join(os.homedir(), ".jade");
  return findConfigInDir(globalDir);
}

export function findProjectRoot(startDir: string = process.cwd()): string | null {
  const configPath = findConfig(startDir);
  if (!configPath) return null;
  return path.dirname(configPath);
}

export function getConfigPath(projectRoot: string): string | null {
  return findConfigInDir(projectRoot);
}
