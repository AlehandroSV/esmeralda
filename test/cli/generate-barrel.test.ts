import { describe, it, expect } from "vitest";
import { generateBarrel } from "../../src/cli/generate.js";

describe("generateBarrel", () => {
  it("lists model names sorted", () => {
    const barrel = generateBarrel(["Post", "User"]);
    expect(barrel).toContain('"Post", "User"');
  });

  it("emits lazy proxy require path", () => {
    const barrel = generateBarrel(["User"]);
    expect(barrel).toContain("jade.generated.");
    expect(barrel).toContain("pcall(require");
    expect(barrel).toContain("__index");
  });

  it("handles empty model list", () => {
    const barrel = generateBarrel([]);
    expect(barrel).toContain("AVAILABLE = {  }");
    expect(barrel).toContain("return setmetatable");
  });

  it("supports multi-db require path", () => {
    const barrel = generateBarrel(["Event"], "jade.generated.analytics");
    expect(barrel).toContain('require("jade.generated.analytics")');
  });
});
