# Esmeralda CLI

> CLI for [Jade ORM](https://github.com/AlehandroSV/Jade)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![Portugues](https://img.shields.io/badge/Portugu%C3%AAs-readme-blue)](#pt-br)
[![English](https://img.shields.io/badge/English-readme-green)](#en)

---

## EN

### About

Esmeralda is the official CLI for Jade ORM. It manages projects, migrations, schemas, seeds, and database operations in a simple and intuitive way.

### Installation

```bash
npm install -g @alehandrosv/esmeralda-cli
```

### Commands

#### init

Creates the basic structure of a Jade project. Supports interactive mode and `--yes` flag.
Also reports environment versions (Lua, Jade, Esmeralda).

```bash
esmeralda init -n my-app          # Non-interactive
esmeralda init                     # Interactive (asks for config)
esmeralda init --yes               # Use defaults for everything
```

Generates:
```
my-app/
├── jade.config.lua
├── schema/
│   └── init.lua
├── migrations/
├── seeds/
├── esmeralda-state.json   # schema snapshot (commitable)
└── lib/
    └── app.lua
```

#### generate

Generates model files + lazy barrel + migration from the `.jade` schema.

```bash
esmeralda generate -n create_users
esmeralda generate --preview  # Preview SQL only
esmeralda generate --run      # Generate and apply migration
```

Output:
```
jade/generated/
├── User.lua
├── Post.lua
└── init.lua           # lazy barrel
migrations/
└── <timestamp>_<name>.lua
```

Lua usage:
```lua
local Models = require("jade.generated")
local User = Models.User
```

#### migrate

Runs all pending migrations. Prefer `migrate dev` in day-to-day development.

```bash
esmeralda migrate
esmeralda migrate dev          # same (explicit dev entrypoint)
esmeralda migrate --preview  # Preview only
```

#### migrate status

Shows the status of all migrations (applied vs pending).

```bash
esmeralda migrate status
```

Output:
```
Migration Status:

  ✓ 20260715_create_users.lua
  ✓ 20260716_create_posts.lua
  ○ 20260717_add_email_index.lua (pending)

Applied: 2, Pending: 1
```

#### migrate create

Creates an empty migration.

```bash
esmeralda migrate create add_email_to_users
```

#### migrate rollback

Rolls back migrations.

```bash
esmeralda migrate rollback              # Rollback last
esmeralda migrate rollback --steps 3    # Rollback last 3
```

#### db pull

Introspects the database and generates entity files.

```bash
esmeralda db pull                # All tables
esmeralda db pull -t users       # Specific table
```

The generated files include:
- Column types and modifiers
- Primary key detection
- Foreign key relations (as comments)

#### db push

Pushes schema directly to database (without migrations).

```bash
esmeralda db push --force
```

This will:
- Create tables with `CREATE TABLE IF NOT EXISTS`
- Add foreign key constraints

#### db diff

Compares schema definitions with the current database state.

```bash
esmeralda db diff
```

Shows differences between your schema files and the live database.

#### db seed

Runs seed files from the seeds directory.

```bash
esmeralda db seed                   # All seeds
esmeralda db seed user              # Specific seed
```

#### schema-generate

Generates Lua entity files from declarative schema definitions.

```bash
esmeralda schema-generate
```

Reads declarative schema files and outputs `Jade.Entity()` Lua format.

### Error Handling

All commands provide clear error messages with suggestions:

```
[error] Not a Jade project. Run 'esmeralda init' first.
[info] Suggestion: Run 'esmeralda init' in your project directory
```

```
[error] Failed to apply migration: 20260716_create_users.lua
[info] Check the migration file for syntax errors. Original error: attempt to call nil value
```

Enable debug mode for stack traces:
```bash
DEBUG=true esmeralda migrate
```

### Docker Support

Esmeralda automatically detects `docker-compose.yml` and runs commands inside the container:

```bash
# With docker-compose.yml in project root
esmeralda migrate        # Runs inside container
esmeralda db seed        # Runs inside container

# Without docker-compose.yml
esmeralda migrate        # Runs locally (requires Lua/LuaJIT)
```

### License

MIT

---

## PT-BR

### Sobre

Esmeralda e a CLI oficial do Jade ORM. Gerencia projetos, migrations, schemas, seeds e operacoes de banco de forma simples e intuitiva.

### Instalacao

```bash
npm install -g @alehandrosv/esmeralda-cli
```

### Comandos

#### init

Cria a estrutura basica de um projeto Jade. Suporta modo interativo e flag `--yes`.
Tambem reporta versoes do ambiente (Lua, Jade, Esmeralda).

```bash
esmeralda init -n my-app          # Nao-interativo
esmeralda init                     # Interativo (pergunta a config)
esmeralda init --yes               # Usar padroes para tudo
```

Gera:
```
my-app/
├── jade.config.lua
├── schema/
│   └── init.lua
├── migrations/
├── seeds/
├── esmeralda-state.json   # snapshot do schema (commitavel)
└── lib/
    └── app.lua
```

#### generate

Gera models + barrel lazy + migration a partir do schema `.jade`.

```bash
esmeralda generate -n create_users
esmeralda generate --preview  # Apenas mostra o SQL
esmeralda generate --run      # Gera e aplica a migration
```

Saida:
```
jade/generated/
├── User.lua
├── Post.lua
└── init.lua           # barrel lazy
migrations/
└── <timestamp>_<nome>.lua
```

Uso no Lua:
```lua
local Models = require("jade.generated")
local User = Models.User
```

#### migrate

Roda todas as migrations pendentes. Prefira `migrate dev` no dia a dia.

```bash
esmeralda migrate
esmeralda migrate dev          # ponto de entrada explicito de dev
esmeralda migrate --preview  # Apenas mostra o que seria executado
```

#### migrate status

Mostra o status de todas as migrations (aplicadas vs pendentes).

```bash
esmeralda migrate status
```

Saida:
```
Migration Status:

  ✓ 20260715_create_users.lua
  ✓ 20260716_create_posts.lua
  ○ 20260717_add_email_index.lua (pending)

Applied: 2, Pending: 1
```

#### migrate create

Cria uma migration vazia.

```bash
esmeralda migrate create add_email_to_users
```

#### migrate rollback

Desfaz migrations.

```bash
esmeralda migrate rollback              # Desfaz ultima
esmeralda migrate rollback --steps 3    # Desfaz ultimas 3
```

#### db pull

Introspeciona o banco de dados e gera arquivos de entidade.

```bash
esmeralda db pull                # Todas as tabelas
esmeralda db pull -t users       # Tabela especifica
```

Os arquivos gerados incluem:
- Tipos de coluna e modificadores
- Deteccao de primary key
- Relacoes de foreign key (como comentarios)

#### db push

Empurra o schema diretamente para o banco (sem migrations).

```bash
esmeralda db push --force
```

Isso ira:
- Criar tabelas com `CREATE TABLE IF NOT EXISTS`
- Adicionar constraints de foreign key

#### db diff

Compara definicoes de schema com o estado atual do banco.

```bash
esmeralda db diff
```

Mostra diferencas entre seus arquivos de schema e o banco ao vivo.

#### db seed

Roda arquivos de seed do diretorio seeds.

```bash
esmeralda db seed                   # Todos os seeds
esmeralda db seed user              # Seed especifico
```

#### schema-generate

Gera arquivos Lua de entidade a partir de definicoes de schema declarativo.

```bash
esmeralda schema-generate
```

Le arquivos de schema declarativo e saida no formato `Jade.Entity()` Lua.

### Tratamento de Erros

Todos os comandos fornecem mensagens de erro claras com sugestoes:

```
[error] Not a Jade project. Run 'esmeralda init' first.
[info] Suggestion: Run 'esmeralda init' in your project directory
```

Ative o modo debug para stack traces:
```bash
DEBUG=true esmeralda migrate
```

### Suporte a Docker

O Esmeralda detecta automaticamente o `docker-compose.yml` e roda os comandos dentro do container:

```bash
# Com docker-compose.yml na raiz do projeto
esmeralda migrate        # Roda dentro do container
esmeralda db seed        # Roda dentro do container

# Sem docker-compose.yml
esmeralda migrate        # Roda localmente (requer Lua/LuaJIT)
```

### Licenca

MIT
