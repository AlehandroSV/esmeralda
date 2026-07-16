# Esmeralda CLI

> CLI para o [Jade ORM](https://github.com/AlehandroSV/Jade)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Sobre

Esmeralda é a CLI oficial do Jade ORM. Gerencia projetos, migrations, schemas e seeds de forma simples e intuitiva.

## Instalação

```bash
npm install -g esmeralda
```

## Comandos

### init

Cria a estrutura básica de um projeto Jade.

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

### generate

Gera uma migration a partir das alterações no schema.

```bash
esmeralda generate -n create_users
esmeralda generate --preview  # Apenas mostra o SQL
```

### migrate

Roda todas as migrations pendentes.

```bash
esmeralda migrate
esmeralda migrate --preview  # Apenas mostra o que seria executado
```

### migrate create

Cria uma migration vazia.

```bash
esmeralda migrate create add_email_to_users
```

### migrate rollback

Desfaz migrations.

```bash
esmeralda migrate rollback              # Desfaz última
esmeralda migrate rollback --steps 3    # Desfaz últimas 3
```

### db pull

Introspeciona o banco de dados e gera arquivos de entidade.

```bash
esmeralda db pull                # Todas as tabelas
esmeralda db pull -t users       # Tabela específica
```

### db push

Empurra o schema diretamente para o banco (sem migrations).

```bash
esmeralda db push --force
```

### seed

Rodar arquivos de seed.

```bash
esmeralda seed                   # Todos os seeds
esmeralda seed user              # Seed específico
```

## Estrutura do Projeto

```
esmerald/
├── src/
│   ├── index.ts              -- Entry point
│   ├── cli/                  -- Comandos da CLI
│   │   ├── init.ts
│   │   ├── generate.ts
│   │   ├── migrate.ts
│   │   ├── migrate-create.ts
│   │   ├── migrate-rollback.ts
│   │   ├── db-pull.ts
│   │   ├── db-push.ts
│   │   └── seed.ts
│   ├── core/                 -- Lógica principal
│   │   ├── schema-parser.ts
│   │   ├── diff-engine.ts
│   │   ├── migration-generator.ts
│   │   └── lua-bridge.ts
│   └── utils/                -- Utilitários
│       ├── logger.ts
│       └── errors.ts
├── bin/esmeralda.ts           -- Entry point para npm
├── test/                     -- 9 testes
├── package.json
└── tsconfig.json
```

## Desenvolvimento

```bash
# Instalar dependências
npm install

# Rodar testes
npm test

# Build
npm run build

# Desenvolvimento
npm run dev
```

## Roadmap

- [x] Publicação no npm
- [ ] Build standalone (.exe via pkg)
- [ ] Comando `esmeralda db diff`
- [ ] Comando `esmeralda db seed`
- [ ] Suporte a MySQL/SQLite

## Licença

MIT
