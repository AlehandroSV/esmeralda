#!/usr/bin/env node
import { Command } from "commander";
import { registerInit } from "./cli/init.js";
import { registerGenerate } from "./cli/generate.js";
import { registerMigrate } from "./cli/migrate.js";
import { registerMigrateCreate } from "./cli/migrate-create.js";
import { registerMigrateRollback } from "./cli/migrate-rollback.js";
import { registerDbPull } from "./cli/db-pull.js";
import { registerDbPush } from "./cli/db-push.js";
import { registerSeed } from "./cli/seed.js";

const program = new Command();

program
  .name("esmeralda")
  .description("CLI for Jade ORM")
  .version("0.1.0");

registerInit(program);
registerGenerate(program);
registerMigrate(program);
registerMigrateCreate(program);
registerMigrateRollback(program);
registerDbPull(program);
registerDbPush(program);
registerSeed(program);

program.parse();
