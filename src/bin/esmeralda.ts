#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "fs";
import { join } from "path";
import { registerInit } from "../cli/init.js";
import { registerGenerate, registerSchemaDiff } from "../cli/generate.js";
import { registerGenerateLegacy } from "../cli/generate-legacy.js";
import { registerMigrate } from "../cli/migrate.js";
import { registerMigrateCreate } from "../cli/migrate-create.js";
import { registerMigrateRollback } from "../cli/migrate-rollback.js";
import { registerDbPull } from "../cli/db-pull.js";
import { registerDbPush } from "../cli/db-push.js";
import { registerDbSync } from "../cli/db-sync.js";
import { registerSeed } from "../cli/seed.js";
import { registerSeedCreate } from "../cli/db-seed-create.js";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));

const program = new Command();

program
  .name("esmeralda")
  .description("CLI for Jade ORM - a modern ORM for Lua")
  .version(pkg.version, "-v, --version")
  .addHelpText("after", "\nUse -h or --help for more information.");

registerInit(program);
registerGenerate(program);
registerGenerateLegacy(program);
const migrate = registerMigrate(program);
registerMigrateCreate(migrate);
registerMigrateRollback(migrate);
const db = program.command("db").description("Database operations");
registerDbPull(db);
registerDbPush(db);
registerDbSync(db);
registerSchemaDiff(db);
registerSeed(db);
registerSeedCreate(db);

if (process.argv.includes("-help")) {
  program.help();
}

program.parse();
