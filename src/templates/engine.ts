/**
 * Template engine - generates feature-specific extra files.
 */
import { Logger } from "../utils/logger.js";
import { ensureDir, writeFile, fileExists } from "../core/file-manager.js";
import * as path from "path";

export interface ProjectContext {
  projectName: string;
  databaseDriver: string;
  databaseHost: string;
  databasePort: number;
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  features: Record<string, boolean>;
}

function interpolate(content: string, ctx: ProjectContext): string {
  return content
    .replace(/PROJECT_NAME/g, ctx.projectName)
    .replace(/DATABASE_DRIVER/g, ctx.databaseDriver)
    .replace(/DATABASE_HOST/g, ctx.databaseHost)
    .replace(/DATABASE_PORT/g, String(ctx.databasePort))
    .replace(/DATABASE_NAME/g, ctx.databaseName)
    .replace(/DATABASE_USER/g, ctx.databaseUser)
    .replace(/DATABASE_PASSWORD/g, ctx.databasePassword);
}

/**
 * Generate extra files based on enabled features.
 * Returns array of { path, content } to be written after base template files.
 */
export function generateFeatureFiles(
  ctx: ProjectContext,
  featuresEnabled: string[]
): Array<{ path: string; content: string }> {
  const result: Array<{ path: string; content: string }> = [];
  const dbImage = ctx.databaseDriver === "mysql" || ctx.databaseDriver === "mariadb"
    ? "mysql:8"
    : "postgres:15-alpine";

  if (featuresEnabled.includes("docker")) {
    result.push({
      path: "Dockerfile",
      content: `FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM alpine:3.19
RUN apk add --no-cache lua5.3 luajit ca-certificates tini

WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY . .

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["lua", "src/app.lua"]
`,
    });

    result.push({
      path: "docker-compose.yml",
      content: `version: "3.8"
services:
  app:
    build: .
    ports:
      - "8080:8080"
    depends_on:
      - db
    environment:
      DB_HOST: ${ctx.databaseHost}
      DB_NAME: ${ctx.databaseName}

  db:
    image: ${dbImage}
    environment:
      POSTGRES_USER: ${ctx.databaseUser}
      POSTGRES_PASSWORD: ${ctx.databasePassword}
      POSTGRES_DB: ${ctx.databaseName}
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
`,
    });
  }

  if (featuresEnabled.includes("tests")) {
    result.push({
      path: "spec/run.lua",
      content: `-- Test runner — run with: lua spec/run.lua
local passed = 0
local failed = 0
local total = 0

print("Running tests...")
print("")

--- Your specs go here ---

print("")
print(string.format("Passed: %d | Failed: %d | Total: %d", passed, failed, total))

if failed > 0 then
    os.exit(1)
end
`,
    });
  }

  if (featuresEnabled.includes("auth")) {
    result.push({
      path: "src/middleware/auth.lua",
      content: `-- JWT Authentication Middleware
local json = require("lapis.util")

local JWT_SECRET = os.getenv("JWT_SECRET") or "change-me-in-production"

local M = {}

function M.verify(token)
    local ok, decoded = pcall(require("luajwtjits").decode, token, JWT_SECRET)
    if not ok then
        return nil
    end
    return decoded
end

function M.generate(payload)
    return require("luajwtjits").encode(
        { alg = "HS256", typ = "JWT" }, payload, JWT_SECRET
    )
end

function M.authenticate()
    return function(self)
        local auth_header = self.request.headers["Authorization"]
        if not auth_header or not auth_header:match("^Bearer ") then
            self.status = 401
            return { error = "Missing or invalid authorization header" }
        end

        local token = auth_header:sub(8)
        local user = M.verify(token)
        if not user then
            self.status = 403
            return { error = "Invalid or expired token" }
        end

        self.current_user = user
    end
end

return M
`,
    });
  }

  if (featuresEnabled.includes("envConfig")) {
    result.push({
      path: ".env.example",
      content: `# Database
DB_HOST=${ctx.databaseHost}
DB_NAME=${ctx.databaseName}
DB_USER=${ctx.databaseUser}
DB_PASS=${ctx.databasePassword}
DB_DRIVER=${ctx.databaseDriver}

# JWT (for authentication)
JWT_SECRET=your-super-secret-key-change-me

# App
APP_PORT=8080
NODE_ENV=development
`,
    });
  }

  return result;
}
