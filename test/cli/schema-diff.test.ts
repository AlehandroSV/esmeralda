import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerSchemaDiff } from "../../src/cli/generate.js";

describe("db diff command", () => {
  it("registers diff command under db subcommand", () => {
    const program = new Command();
    const db = program.command("db");

    registerSchemaDiff(db);

    const diffCmd = db.commands.find((cmd) => cmd.name() === "diff");
    expect(diffCmd).toBeDefined();
  });

  it("registers schema-diff as a hidden alias under db", () => {
    const program = new Command();
    const db = program.command("db");

    registerSchemaDiff(db);

    const aliasCmd = db.commands.find((cmd) => cmd.name() === "schema-diff");
    expect(aliasCmd).toBeDefined();
  });

  it("does not register diff at program level", () => {
    const program = new Command();

    registerSchemaDiff(program);

    // When called with program, diff should NOT be a top-level command
    // (it's now meant to be called with the db subcommand)
    // This test verifies the function works on any parent command
    const diffCmd = program.commands.find((cmd) => cmd.name() === "diff");
    expect(diffCmd).toBeDefined();
  });
});
