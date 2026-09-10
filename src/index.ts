#!/usr/bin/env node
import { createProgram } from "./program.js";

const program = createProgram();

if (process.argv.includes("-help")) {
  program.help();
}

program.parse();
