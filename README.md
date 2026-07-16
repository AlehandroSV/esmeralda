# Esmeralda CLI

> CLI for [Jade ORM](https://github.com/AlehandroSV/Jade)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![Portugues](https://img.shields.io/badge/Portugu%C3%AAs-readme-blue)](#pt-br)
[![English](https://img.shields.io/badge/English-readme-green)](#en)

---

## EN

### About

Esmeralda is the official CLI for Jade ORM. It manages projects, migrations, schemas, and seeds in a simple and intuitive way.

### Installation

```bash
npm install -g @alehandrosv/esmeralda-cli
```

### Commands

#### init

Creates the basic structure of a Jade project.

```bash
esmeralda init -n my-app
```

Generates:
```
my-app/
├── jade.config.lua
├── schema/
│   └── init.lua
├── migrations/
├── seeds/
└── lib/
    └── app.lua
```

#### generate

Generates a migration from schema changes.

```bash
esmeralda generate -n create_users
esmeralda generate --preview  # Preview SQL only
```

#### migrate

Runs all pending migrations.

```bash
esmeralda migrate
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

#### seed

Runs seed files.

```bash
esmeralda seed                   # All seeds
esmeralda seed user              # Specific seed
```

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
esmeralda seed           # Runs inside container

# Without docker-compose.yml
esmeralda migrate        # Runs locally (requires Lua/LuaJIT)
```

### License

MIT

---

## PT-BR

### Sobre

Esmeralda e a CLI oficial do Jade ORM. Gerencia projetos, migrations, schemas e seeds de forma simples e intuitiva.

### Instalacao

```bash
npm install -g @alehandrosv/esmeralda-cli
```

### Comandos

#### init

Cria a estrutura basica de um projeto Jade.

```bash
esmeralda init -n my-app
```

Gera:
```
my-app/
├── jade.config.lua
├── schema/
│   └── init.lua
├── migrations/
├── seeds/
└── lib/
    └── app.lua
```

#### generate

Gera uma migration a partir das alteracoes no schema.

```bash
esmeralda generate -n create_users
esmeralda generate --preview  # Apenas mostra o SQL
```

#### migrate

Roda todas as migrations pendentes.

```bash
esmeralda migrate
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

#### seed

Roda arquivos de seed.

```bash
esmeralda seed                   # Todos os seeds
esmeralda seed user              # Seed especifico
```

### Tratamento de Erros

Todos os comandos fornecem mensagens de erro claras com sugestoes:

```
[error] Not a Jade project. Run 'esmeralda init' first.
[info] Suggestion: Run 'esmeralda init' in your project directory
```

```
[error] Failed to apply migration: 20260716_create_users.lua
[info] Check the migration file for syntax errors. Original error: attempt to call nil value
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
esmeralda seed           # Roda dentro do container

# Sem docker-compose.yml
esmeralda migrate        # Roda localmente (requer Lua/LuaJIT)
```

### Licenca

MIT
