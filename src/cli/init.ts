import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { Logger } from "../utils/logger.js";
import { ensureDir, writeFile, fileExists } from "../core/file-manager.js";
import { createEmptyState } from "../core/schema-state.js";
import { escapeLuaString } from "../core/lua-bridge.js";

interface InitOptions {
  name?: string;
  yes?: boolean;
  template?: string;
}

export interface DatabaseConfig {
  driver: "postgresql" | "mysql" | "sqlite";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const DEFAULT_CONFIG: DatabaseConfig = {
  driver: "postgresql",
  host: "localhost",
  port: 5432,
  database: "",
  user: "postgres",
  password: "",
};

const DRIVER_DEFAULTS: Record<string, { port: number; user: string }> = {
  postgresql: { port: 5432, user: "postgres" },
  mysql: { port: 3306, user: "root" },
  sqlite: { port: 0, user: "" },
};

/* ─── Template definitions ─────────────────────────────────────── */

type FileEntry = { path: string; content: string };

interface TemplateDef {
  id: string;
  displayName: string;
  description: string;
  defaultDriver?: string;
  features?: Array<{ key: string; label: string; default?: boolean }>;
  files: FileEntry[];
}

/** Placeholder → value replacement */
function interp(content: string, ctx: { project: string; db: Partial<DatabaseConfig> }): string {
  return content
    .replace(/PROJECT_NAME/g, ctx.project)
    .replace(/DATABASE_DRIVER/g, ctx.db.driver || "")
    .replace(/DATABASE_HOST/g, ctx.db.host || "")
    .replace(/DATABASE_PORT/g, String(ctx.db.port ?? ""))
    .replace(/DATABASE_NAME/g, ctx.db.database || "")
    .replace(/DATABASE_USER/g, ctx.db.user || "")
    .replace(/DATABASE_PASSWORD/g, ctx.db.password || "");
}

function escLua(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function makeTemplate(id: string, def: Omit<TemplateDef, "id">): TemplateDef {
  return { ...def, id };
}

const TEMPLATES: Record<string, TemplateDef> = {};

// ── api-rest ─────────────────────────────────────────────────────
TEMPLATES["api-rest"] = makeTemplate("api-rest", {
  displayName: "API REST com Lapis",
  description: "API REST completa com CRUD, rotas, models, Dockerfile e testes.",
  defaultDriver: "postgresql",
  features: [
    { key: "docker", label: "Docker + docker-compose" },
    { key: "tests", label: "Testes unitários" },
    { key: "auth", label: "Autenticação JWT" },
  ],
  files: [
    // --- jade.config.lua ---
    {
      path: "jade.config.lua",
      content: `return {
    database = {
        driver = "postgresql",
        host = "\${DB_HOST}",
        port = DATABASE_PORT,
        database = "\${DATABASE_NAME}",
        user = "\${DATABASE_USER}",
        password = "\${DATABASE_PASSWORD}"
    }
}
`,
    },
    // --- src/app.lua ---
    {
      path: "src/app.lua",
      content: `local Server = require("lapis.application")
local config = require("../jade.config")

local app = Server({
    default_headers = { ["Content-Type"] = "application/json" }
})

-- Health check
app:get("/health", function(self)
    return { status = "ok", service = "PROJECT_NAME" }
end)

-- Load routes
do local routes = require("routes") end

return app
`,
    },
    // --- src/routes/init.lua ---
    {
      path: "src/routes/init.lua",
      content: `-- Route definitions go here per resource
return {}
`,
    },
    // --- src/models/init.lua ---
    {
      path: "src/models/init.lua",
      content: `-- Models registered here
return {}
`,
    },
    // --- package.json ---
    {
      path: "package.json",
      content: `{
  "name": "PROJECT_NAME",
  "version": "1.0.0",
  "description": "API REST with Lapis + Jade ORM",
  "scripts": {
    "start": "lua src/app.lua",
    "dev": "nodemon --watch src --ext lua --exec 'lua src/app.lua'",
    "migrate": "esmeralda migrate"
  },
  "author": "",
  "license": "MIT"
}
`,
    },
    // --- README.md ---
    {
      path: "README.md",
      content: `# PROJECT_NAME

API REST built with **Lapis** + **Jade ORM**.

## Setup

\`\`\`bash
npm install
esmeralda init
esmeralda migrate
\`\`\`

### Endpoints

- \`GET /health\` — Health check
- \`GET/POST /\` — Resource list / create
- \`GET/:id\` — Get by ID
- \`PUT/PATCH/:id\` — Update
- \`DELETE/:id\` — Delete

## License

MIT
`,
    },
    // --- .gitignore ---
    {
      path: ".gitignore",
      content: `.esmeralda-state.json\nnode_modules/\n.env\n*.log\n.DS_Store\ndist/\n`,
    },
  ],
});

// ── microservice ─────────────────────────────────────────────────
TEMPLATES["microservice"] = makeTemplate("microservice", {
  displayName: "Microserviço com Health Check",
  description: "Microserviço com health check endpoint, Docker multi-stage.",
  defaultDriver: "postgresql",
  features: [
    { key: "docker", label: "Docker + docker-compose" },
    { key: "tests", label: "Testes unitários" },
    { key: "envConfig", label: ".env.example" },
  ],
  files: [
    // --- jade.config.lua (microservice) ---
    {
      path: "jade.config.lua",
      content: 'return {\n' +
        '    database = {\n' +
        '        driver = "' + escLua('postgresql') + '",\n' +
        '        host = "${DB_HOST} or \'localhost\'",\n' +
        '        port = DATABASE_PORT,\n' +
        '        database = "${DB_NAME} or \'DATABASE_NAME\'",\n' +
        '        user = "${DB_USER} or \'DATABASE_USER\'",\n' +
        '        password = "${DB_PASS} or \'DATABASE_PASSWORD\'"\n' +
        '    }\n' +
        '}\n',
    },
    // --- src/app.lua ---
    {
      path: "src/app.lua",
      content: `local Server = require("lapis.application")
local config = require("../jade.config")

local app = Server({
    default_headers = { ["Content-Type"] = "application/json" }
})

-- Liveness probe
app:get("/health", function(self)
    return {
        status = "ok", version = "1.0.0",
        uptime = os.clock(),
        timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
        service = "PROJECT_NAME"
    }
end)

-- Readiness probe
app:get("/ready", function(self)
    return { ready = true }
end)

return app
`,
    },
    // --- package.json ---
    {
      path: "package.json",
      content: `{
  "name": "PROJECT_NAME",
  "version": "1.0.0",
  "description": "Microserviço com Lapis + Jade ORM",
  "scripts": {
    "start": "lua src/app.lua",
    "test": "lua spec/run.lua"
  },
  "author": "",
  "license": "MIT"
}
`,
    },
    // --- README.md ---
    {
      path: "README.md",
      content: `# PROJECT_NAME

Microserviço com **Lapis** + **Jade ORM**.

## Endpoints

| Path    | Purpose      |
|---------|------------- |
| /health | Liveness     |
| /ready  | Readiness    |

## Deploy

\`\`\`bash
make build && make run
\`\`\`

## License

MIT
`,
    },
    // --- .gitignore ---
    {
      path: ".gitignore",
      content: `.esmeralda-state.json\nnode_modules/\n.env\n*.log\n.DS_Store\ndist/\n`,
    },
  ],
});

// ── cli-app ──────────────────────────────────────────────────────
TEMPLATES["cli-app"] = makeTemplate("cli-app", {
  displayName: "CLI com dados persistentes",
  description: "Aplicação CLI com comandos add/list/delete, bin entry e SQLite.",
  defaultDriver: "sqlite",
  features: [
    { key: "tests", label: "Testes unitários" },
    { key: "envConfig", label: ".env.example" },
  ],
  files: [
    // --- jade.config.lua ---
    {
      path: "jade.config.lua",
      content: 'return {\n' +
        '    database = {\n' +
        '        driver = "sqlite",\n' +
        '        host = "",\n' +
        '        port = 0,\n' +
        '        database = "\\${\"DB_PATH\"} or \'DATABASE_NAME\'",\n' +
        '        user = "",\n' +
        '        password = ""\n' +
        '    }\n' +
        '}\n',
    },
    // --- src/main.lua ---
    {
      path: "src/main.lua",
      content: `#!/usr/bin/env lua
local config = require("../jade.config")
local args = {}
for _, a in ipairs(arg) do table.insert(args, a) end

local function showHelp()
    print("Usage: main.lua <command>")
    print("Commands:")
    print("  add    <entity>  Add a new record")
    print("  list   [entity]  List records")
    print("  get    <entity> <id>")
    print("  delete <entity> <id>")
    print("  help             Show help")
end

if #args == 0 or args[1] == "help" then
    showHelp()
else
    -- TODO: implement per-command handlers
    print("Command not yet implemented.")
end
`,
    },
    // --- package.json ---
    {
      path: "package.json",
      content: `{
  "name": "PROJECT_NAME",
  "version": "1.0.0",
  "description": "CLI Application with Lapis + Jade ORM",
  "scripts": {
    "start": "lua src/main.lua",
    "test": "lua spec/run.lua"
  },
  "author": "",
  "license": "MIT"
}
`,
    },
    // --- README.md ---
    {
      path: "README.md",
      content: `# PROJECT_NAME

CLI Application com **Lapis** + **Jade ORM**.

## Usage

\`\`\`bash
lua src/main.lua help
lua src/main.lua add
lua src/main.lua list
\`\`\`

## License

MIT
`,
    },
    // --- .gitignore ---
    {
      path: ".gitignore",
      content: `.esmeralda-state.json\nnode_modules/\n*.log\n.DS_Store\ndist/\n*.db\n`,
    },
  ],
});

// ── blog ─────────────────────────────────────────────────────────
TEMPLATES["blog"] = makeTemplate("blog", {
  displayName: "Blog Completo",
  description: "Blog com Users, Posts, Comments, Tags (HABTM) e seeds.",
  defaultDriver: "postgresql",
  features: [
    { key: "docker", label: "Docker + docker-compose" },
    { key: "tests", label: "Testes unitários" },
    { key: "auth", label: "Autenticação JWT" },
    { key: "seeds", label: "Seeds com dados de exemplo" },
    { key: "envConfig", label: ".env.example" },
  ],
  files: [
    // --- jade.config.lua ---
    {
      path: "jade.config.lua",
      content: `return {
    database = {
        driver = "DATABASE_DRIVER",
        host = "DATABASE_HOST",
        port = DATABASE_PORT,
        database = "DATABASE_NAME",
        user = "DATABASE_USER",
        password = "DATABASE_PASSWORD"
    }
}
`,
    },
    // --- schema/init.lua ---
    {
      path: "schema/init.lua",
      content: `-- Blog Schema
local User = require("./user")
local Post = require("./post")
local Comment = require("./comment")
local Tag = require("./tag")

Post:belongsTo(User)
User:hasMany(Post)
Comment:belongsTo(Post)
Comment:belongsTo(User)
Post:hasAndBelongsToMany(Tag)
Tag:hasAndBelongsToMany(Post)

return { users = User, posts = Post, comments = Comment, tags = Tag }
`,
    },
    // --- schema/user.lua ---
    {
      path: "schema/user.lua",
      content: `local User = Jade.Entity("users", {
    id = Jade.Integer():primaryKey(),
    name = Jade.String(120):notNull(),
    email = Jade.String(255):unique():notNull(),
    bio = Jade.Text():default(""),
    avatar_url = Jade.String(500):nullable(),
}, { tableName = "users" })

User:validatePresenceOf("name")
User:validateUniquenessOf("email")

return User
`,
    },
    // --- schema/post.lua ---
    {
      path: "schema/post.lua",
      content: `local Post = Jade.Entity("posts", {
    id = Jade.Integer():primaryKey(),
    title = Jade.String(255):notNull(),
    slug = Jade.String(300):unique():notNull(),
    body = Jade.Text():notNull(),
    excerpt = Jade.Text():nullable(),
    published = Jade.Boolean():default(false),
    published_at = Jade.Timestamp():nullable(),
    created_at = Jade.Timestamp():defaultNow(),
    updated_at = Jade.Timestamp():defaultNow(),
}, { tableName = "posts" })

Post:validatePresenceOf("title")
Post:validatePresenceOf("slug")

return Post
`,
    },
    // --- schema/comment.lua ---
    {
      path: "schema/comment.lua",
      content: `local Comment = Jade.Entity("comments", {
    id = Jade.Integer():primaryKey(),
    post_id = Jade.Integer():notNull(),
    user_id = Jade.Integer():notNull(),
    body = Jade.Text():notNull(),
    created_at = Jade.Timestamp():defaultNow(),
}, { tableName = "comments" })

Comment:validatePresenceOf("body")

return Comment
`,
    },
    // --- schema/tag.lua ---
    {
      path: "schema/tag.lua",
      content: `local Tag = Jade.Entity("tags", {
    id = Jade.Integer():primaryKey(),
    name = Jade.String(100):unique():notNull(),
    slug = Jade.String(100):unique():notNull(),
}, { tableName = "tags" })

Tag:validatePresenceOf("name")
Tag:validateUniquenessOf("slug")

return Tag
`,
    },
    // --- migrations/001_create_blog_tables.lua ---
    {
      path: "migrations/001_create_blog_tables.lua",
      content: `M.up = function(db)
    db:execute([[ CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        bio TEXT DEFAULT '', avatar_url VARCHAR(500)
    ) ]])

    db:execute([[ CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(300) NOT NULL UNIQUE,
        body TEXT NOT NULL, excerpt TEXT,
        published BOOLEAN DEFAULT FALSE, published_at TIMESTAMP
    ) ]])

    db:execute([[ CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(100) NOT NULL UNIQUE,
        slug VARCHAR(100) NOT NULL UNIQUE
    ) ]])

    db:execute([[ CREATE TABLE IF NOT EXISTS posts_tags (
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, tag_id)
    ) ]])

    db:execute([[ CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ]])
end

M.down = function(db)
    db:execute([[ DROP TABLE IF EXISTS comments ]])
    db:execute([[ DROP TABLE IF EXISTS posts_tags ]])
    db:execute([[ DROP TABLE IF EXISTS tags ]])
    db:execute([[ DROP TABLE IF EXISTS posts ]])
    db:execute([[ DROP TABLE IF EXISTS users ]])
end
`,
    },
    // --- seeds/blog_seed.lua ---
    {
      path: "seeds/blog_seed.lua",
      content: `M.execute = function(db)
    local count = db:query("SELECT COUNT(*) as c FROM users")[1].c
    if count > 0 then return end

    db:execute([[
        INSERT INTO users VALUES
        (1, 'Admin', 'admin@blog.local', 'Administrator'),
        (2, 'John Doe', 'john@blog.local', 'Writer'),
        (3, 'Jane Smith', 'jane@blog.local', 'Editor')
    ]])

    db:execute([[
        INSERT INTO tags VALUES
        (1, 'Technology', 'technology'), (2, 'Tutorial', 'tutorial'),
        (3, 'News', 'news'), (4, 'Opinion', 'opinion'),
        (5, 'Lua', 'lua'), (6, 'Database', 'database')
    ]])

    db:execute([[
        INSERT INTO posts VALUES
        (1, 'Getting Started with Jade ORM', 'getting-started-with-jade-orm',
         'Jade is a modern ORM for Lua...', TRUE, datetime('now')),
        (2, 'Building APIs with Lapis', 'building-apis-with-lapis',
         'Lapis provides elegant REST APIs...', TRUE, datetime('now'))
    ]])

    db:execute([[
        INSERT INTO posts_tags VALUES
        (1, 5), (1, 6), (2, 1)
    ]])

    db:execute([[
        INSERT INTO comments VALUES
        (1, 1, 2, 'Great introduction!'),
        (2, 1, 3, 'Very helpful.')
    ]])
end
`,
    },
    // --- README.md ---
    {
      path: "README.md",
      content: `# PROJECT_NAME

Blog completo com **Lapis** + **Jade ORM**.

## Banco

| Tabela | Descrição |
|--------|-----------|
| users | Usuários |
| posts | Artigos |
| comments | Comentários |
| tags | Tags |
| posts_tags | Junction HABTM |

## Setup

\`\`\`bash
npm install
esmeralda init
esmeralda migrate
esmeralda db seed
\`\`\`

## License

MIT
`,
    },
    // --- .gitignore ---
    {
      path: ".gitignore",
      content: `.esmeralda-state.json\nnode_modules/\n.env\n*.log\n.DS_Store\ndist/\n`,
    },
  ],
});

/* ─── Feature extra files generation ──────────────────────────── */

function extraFilesForFeatures(
  projectName: string,
  driver: string,
  host: string,
  port: number,
  database: string,
  user: string,
  pass: string,
  enabled: string[]
): FileEntry[] {
  const ctx = { project: projectName, db: { driver, host, port, database, user, password: pass } };
  const entries: FileEntry[] = [];

  if (enabled.includes("docker")) {
    const dbImage = driver === "mysql" ? "mysql:8" : "postgres:15-alpine";
    entries.push({
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
    entries.push({
      path: "docker-compose.yml",
      content: `version: "3.8"
services:
  app:
    build: .
    ports: ["8080:8080"]
    depends_on: [db]
    environment:
      DB_HOST: ${driver === "mysql" ? "127.0.0.1" : "localhost"}
      DB_NAME: ${database}
  db:
    image: ${dbImage}
    environment:
      POSTGRES_USER: ${user}
      POSTGRES_PASSWORD: ${pass}
      POSTGRES_DB: ${database}
    volumes: ["db-data:/var/lib/postgresql/data"]
volumes:
  db-data:
`,
    });
  }

  if (enabled.includes("tests")) {
    entries.push({
      path: "spec/run.lua",
      content: `-- Test runner — run with: lua spec/run.lua
local passed = 0
local failed = 0
print("Running tests...")
print("")
--- Your specs go here ---
print(string.format("Passed: %d | Failed: %d", passed, failed))
if failed > 0 then os.exit(1) end
`,
    });
  }

  if (enabled.includes("auth")) {
    entries.push({
      path: "src/middleware/auth.lua",
      content: `local M = {}
local JWT_SECRET = os.getenv("JWT_SECRET") or "change-me-in-production"

function M.verify(token)
    local ok, decoded = pcall(require("luajwtjits").decode, token, JWT_SECRET)
    if not ok then return nil end
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

  if (enabled.includes("envConfig")) {
    entries.push({
      path: ".env.example",
      content: `DB_HOST=${host}
DB_NAME=${database}
DB_USER=${user}
DB_PASS=${pass}
DB_DRIVER=${driver}
JWT_SECRET=your-super-secret-key-change-me
APP_PORT=8080
NODE_ENV=development
`,
    });
  }

  return entries;
}

/* ─── Scaffold standard directories ───────────────────────────── */

function scaffoldStandardDirs(targetPath: string): void {
  ensureDir(path.join(targetPath, "schema"));
  ensureDir(path.join(targetPath, "migrations"));
  ensureDir(path.join(targetPath, "seeds"));

  // Create schema/init.lua only if it doesn't exist
  const schemaPath = path.join(targetPath, "schema", "init.lua");
  if (!fileExists(schemaPath)) {
    writeFile(schemaPath, "-- Schema definitions\n-- Require your entity files here\nreturn {}\n");
    Logger.info("  Created schema/init.lua");
  }

  // Create .esmeralda-state.json only if it doesn't exist
  const statePath = path.join(targetPath, ".esmeralda-state.json");
  if (!fileExists(statePath)) {
    writeFile(statePath, JSON.stringify(createEmptyState(), null, 2) + "\n");
    Logger.info("  Created .esmeralda-state.json");
  }
}

/* ─── Apply template scaffolding ──────────────────────────────── */

async function applyTemplateScaffold(
  targetPath: string,
  templateId: string,
  projectName: string,
  dbConfig: DatabaseConfig,
  options: { yes: boolean }
): Promise<void> {
  const tmpl = TEMPLATES[templateId];
  if (!tmpl) {
    Logger.error(`Unknown template: "${templateId}"`);
    Logger.info(`Available templates: ${Object.keys(TEMPLATES).join(", ")}`);
    process.exit(1);
  }

  Logger.info(`Using template: ${tmpl.displayName}`);
  Logger.info(`Target directory: ${targetPath}\n`);

  // Default feature flags based on template defaults
  const featuresEnabled: string[] = [];
  if (tmpl.features) {
    for (const f of tmpl.features) {
      if (options.yes && f.default !== undefined && f.default === true) {
        featuresEnabled.push(f.key);
        Logger.info(`  ✓ ${f.label} (default)`);
      } else {
        // For now in non-interactive mode, skip unless explicitly enabled
        // Interactive prompts come next
        void f;
      }
    }
  }

  // Write template files
  for (const file of tmpl.files) {
    const filePath = path.join(targetPath, file.path);
    if (fileExists(filePath)) {
      Logger.info(`  ⏭️  Skip ${file.path} (already exists)`);
      continue;
    }
    writeFile(filePath, file.content);
    Logger.info(`  Created ${file.path}`);
  }

  // Ask interactive feature questions if TTY
  if (!options.yes && process.stdin.isTTY && tmpl.features) {
    Logger.info("");
    Logger.info("Enable optional features:");

    for (const f of tmpl.features) {
      if (featuresEnabled.includes(f.key)) continue;

      const def = f.default === true ? "[y/N]" : "[Y/n]";
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`  ${f.label}? (${def}): `, (answer) => {
          const enable = answer.trim().toLowerCase() !== "n";
          if (enable) {
            featuresEnabled.push(f.key);
            Logger.info(`  ✓ ${f.label}`);
          } else {
            Logger.warn(`  ✗ ${f.label} skipped`);
          }
          rl.close();
          resolve();
        });
      });
    }
  }

  // Generate and write feature-specific files
  const extras = extraFilesForFeatures(
    projectName,
    dbConfig.driver,
    dbConfig.host,
    dbConfig.port,
    dbConfig.database,
    dbConfig.user,
    dbConfig.password,
    featuresEnabled
  );
  for (const ef of extras) {
    const efPath = path.join(targetPath, ef.path);
    if (!fileExists(efPath)) {
      writeFile(efPath, ef.content);
      Logger.info(`  Created ${ef.path}`);
    } else {
      Logger.info(`  ⏭️  Skip ${ef.path} (already exists)`);
    }
  }

  // Scaffold standard esmeralda dirs
  scaffoldStandardDirs(targetPath);

  Logger.success(`Project "${projectName}" scaffolded with template "${tmpl.displayName}"!`);
}

/* ─── Existing helpers ────────────────────────────────────────── */

export function promptUser(projectName: string): Promise<DatabaseConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string, defaultValue: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(`${question} (${defaultValue}): `, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  };

  return new Promise(async (resolve) => {
    try {
      Logger.info("Interactive initialization mode");
      Logger.info("Press Enter to accept defaults (shown in parentheses)\n");

      const name = await ask("Project name", projectName);
      const driver = (await ask("Database driver (postgresql, mysql, sqlite)", DEFAULT_CONFIG.driver)) as DatabaseConfig["driver"];
      const defaults = DRIVER_DEFAULTS[driver] || DRIVER_DEFAULTS.postgresql;

      const host = await ask("Database host", DEFAULT_CONFIG.host);
      const portStr = await ask("Database port", String(defaults.port));
      const port = parseInt(portStr, 10) || defaults.port;
      const dbUser = await ask("Database user", defaults.user);
      const password = await ask("Database password", DEFAULT_CONFIG.password);

      resolve({
        driver,
        host,
        port,
        database: name,
        user: dbUser,
        password,
      });
    } finally {
      rl.close();
    }
  });
}

export function generateConfigContent(projectName: string, config: DatabaseConfig): string {
  return `return {
    database = {
        driver = "${escapeLuaString(config.driver)}",
        host = "${escapeLuaString(config.host)}",
        port = ${parseInt(String(config.port), 10) || 5432},
        database = "${escapeLuaString(config.database)}",
        user = "${escapeLuaString(config.user)}",
        password = "${escapeLuaString(config.password)}"
    }
}
`;
}

export function initInDirectory(
  targetPath: string,
  projectName: string,
  config?: DatabaseConfig
): void {
  Logger.info(`Initializing Jade in: ${targetPath}`);

  // Create directories
  ensureDir(path.join(targetPath, "schema"));
  ensureDir(path.join(targetPath, "migrations"));
  ensureDir(path.join(targetPath, "seeds"));

  // Create jade.config.lua only if it doesn't exist
  const configPath = path.join(targetPath, "jade.config.lua");
  if (!fileExists(configPath)) {
    const dbConfig = config || { ...DEFAULT_CONFIG, database: projectName };
    writeFile(configPath, generateConfigContent(projectName, dbConfig));
    Logger.info("  Created jade.config.lua");
  } else {
    Logger.info("  jade.config.lua already exists, skipping");
  }

  // Create schema/init.lua only if it doesn't exist
  const schemaInitPath = path.join(targetPath, "schema", "init.lua");
  if (!fileExists(schemaInitPath)) {
    writeFile(
      schemaInitPath,
      `-- Schema definitions
-- Require your entity files here

return {}
`
    );
    Logger.info("  Created schema/init.lua");
  } else {
    Logger.info("  schema/init.lua already exists, skipping");
  }

  // Create .esmeralda-state.json if it doesn't exist
  const statePath = path.join(targetPath, ".esmeralda-state.json");
  if (!fileExists(statePath)) {
    writeFile(statePath, JSON.stringify(createEmptyState(), null, 2) + "\n");
    Logger.info("  Created .esmeralda-state.json");
  }
}

/* ─── Register command ────────────────────────────────────────── */

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize Jade in current directory or scaffold a new project")
    .option("-n, --name <name>", "Project name (creates a new directory)")
    .option("-y, --yes", "Skip prompts and use defaults")
    .option("-t, --template <name>", "Use a pre-built project template (api-rest, microservice, cli-app, blog)")
    .action(async (options: InitOptions) => {
      try {
        /* ─── Mode: --template ──────────────────────────────────── */
        if (options.template) {
          const templateId = options.template;

          // Resolve target path: either create new dir (--name) or cwd
          let projectPath: string;
          let projectName: string;

          if (options.name) {
            projectPath = path.resolve(process.cwd(), options.name);
            if (fileExists(projectPath)) {
              Logger.error(`Directory "${options.name}" already exists.`);
              Logger.info("Use `esmeralda init` inside it to initialize Jade.");
              return;
            }
            projectName = options.name;
            ensureDir(projectPath);
          } else {
            projectPath = process.cwd();
            projectName = path.basename(projectPath);
          }

          // Build minimal DB config
          const tmpl = TEMPLATES[templateId];
          const driver = (tmpl?.defaultDriver || "postgresql") as DatabaseConfig["driver"];
          const driverDefaults = DRIVER_DEFAULTS[driver] || DRIVER_DEFAULTS.postgresql;

          const dbConfig: DatabaseConfig = {
            driver,
            host: "localhost",
            port: driverDefaults.port,
            database: projectName,
            user: driverDefaults.user,
            password: "",
          };

          await applyTemplateScaffold(projectPath, templateId, projectName, dbConfig, {
            yes: !!options.yes,
          });

          Logger.info("");
          Logger.info("Next steps:");
          Logger.info(`  cd ${projectPath}`);
          Logger.info("  Add your entities in schema/");
          return;
        }

        /* ─── Mode 1: --name (existing) ─────────────────────────── */
        if (options.name) {
          const projectPath = path.resolve(process.cwd(), options.name);

          if (fileExists(projectPath)) {
            Logger.error(`Directory "${options.name}" already exists.`);
            Logger.info("Use `esmeralda init` inside it to initialize Jade.");
            return;
          }

          ensureDir(projectPath);

          let config: DatabaseConfig | undefined;
          if (options.yes) {
            config = { ...DEFAULT_CONFIG, database: options.name };
          }

          initInDirectory(projectPath, options.name, config);

          Logger.success(`Project "${options.name}" created successfully!`);
          Logger.info("Next steps:");
          Logger.info(`  cd ${options.name}`);
          Logger.info("  Add your entities in schema/");
        } else {
          /* ─── Mode 2: no --name (existing) ────────────────────── */
          const cwd = process.cwd();
          const dirName = path.basename(cwd);

          let config: DatabaseConfig | undefined;

          if (options.yes) {
            config = { ...DEFAULT_CONFIG, database: dirName };
          } else if (process.stdin.isTTY) {
            config = await promptUser(dirName);
          }

          initInDirectory(cwd, dirName, config);

          Logger.success("Jade initialized successfully!");
          Logger.info("Add your entities in schema/");
        }
      } catch (error: any) {
        Logger.error("Failed to initialize Jade:");
        Logger.error(error.message);
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });
}
