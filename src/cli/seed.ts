import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Logger, AppError } from "../utils/logger.js";
import { findProjectRoot } from "../core/project.js";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

function hasDockerCompose(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "docker-compose.yml")) ||
         fs.existsSync(path.join(projectRoot, "docker-compose.yaml"));
}

async function runInDocker(script: string, projectRoot: string): Promise<void> {
  const composeFile = fs.existsSync(path.join(projectRoot, "docker-compose.yml"))
    ? "docker-compose.yml" : "docker-compose.yaml";
  const composeContent = fs.readFileSync(path.join(projectRoot, composeFile), "utf-8");
  const serviceMatch = composeContent.match(/^\s{2}(\w+):/m);
  const serviceName = serviceMatch ? serviceMatch[1] : "api";

  await exec("docker", [
    "compose", "exec", "-T", serviceName,
    "luajit", "-e", script
  ], { cwd: projectRoot });
}

async function runLocal(script: string): Promise<void> {
  try {
    await exec("luajit", ["-e", script]);
  } catch {
    await exec("lua", ["-e", script]);
  }
}

export function registerSeed(program: Command): void {
  program
    .command("seed")
    .description("Run seed files")
    .argument("[name]", "Seed file name (without extension)")
    .action(async (name?: string) => {
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw AppError.notInitialized();
        }

        const seedsDir = path.join(projectRoot, "seeds");
        if (!fs.existsSync(seedsDir)) {
          throw AppError.seedsDirNotFound();
        }

        let files = fs.readdirSync(seedsDir).filter(f => f.endsWith(".lua"));

        if (name) {
          files = files.filter(f => f.includes(name));
        }

        if (files.length === 0) {
          Logger.warn("No seed files found.");
          return;
        }

        const useDocker = hasDockerCompose(projectRoot);
        if (useDocker) {
          Logger.info("Using Docker to run seeds");
        }

        Logger.info(`Running ${files.length} seed file(s)...`);

        for (const file of files) {
          Logger.info(`  Seeding: ${file}`);

          try {
            let configPath: string;
            let seedPath: string;

            if (useDocker) {
              const relativeConfig = path.relative(projectRoot, path.join(projectRoot, "jade.config.lua")).replace(/\\/g, "/");
              const relativeSeed = path.relative(projectRoot, path.join(seedsDir, file)).replace(/\\/g, "/");
              configPath = "/app/" + relativeConfig;
              seedPath = "/app/" + relativeSeed;
            } else {
              configPath = path.join(projectRoot, "jade.config.lua").replace(/\\/g, "\\\\");
              seedPath = path.join(seedsDir, file).replace(/\\/g, "\\\\");
            }

            const script = `
local jade = require("jade")
local config = dofile("${configPath}")
jade.configure(config)
dofile("${seedPath}")
            `;

            if (useDocker) {
              await runInDocker(script, projectRoot);
            } else {
              await runLocal(script);
            }

            Logger.success(`  Seeded: ${file}`);
          } catch (error: any) {
            throw AppError.seedFailed(file, error);
          }
        }

        Logger.success("All seeds executed!");
      } catch (error: any) {
        if (error instanceof AppError) {
          Logger.error(error.message);
          if (error.suggestion) {
            Logger.info(`Suggestion: ${error.suggestion}`);
          }
        } else {
          Logger.error("Failed to run seeds:");
          Logger.error(error.message);
        }
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}