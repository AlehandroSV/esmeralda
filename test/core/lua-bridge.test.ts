import { describe, it, expect } from "vitest";
import { escapeLuaString, validateLuaIdentifier, LuaBridge } from "../../src/core/lua-bridge.js";

describe("escapeLuaString", () => {
  it("escapes backslashes", () => {
    expect(escapeLuaString("foo\\bar")).toBe("foo\\\\bar");
  });

  it("escapes double quotes", () => {
    expect(escapeLuaString('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes single quotes", () => {
    expect(escapeLuaString("it's")).toBe("it\\'s");
  });

  it("escapes newlines", () => {
    expect(escapeLuaString("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes carriage returns", () => {
    expect(escapeLuaString("line1\rline2")).toBe("line1\\rline2");
  });

  it("escapes null bytes", () => {
    expect(escapeLuaString("foo\0bar")).toBe("foo\\0bar");
  });

  it("escapes multiple special characters at once", () => {
    expect(escapeLuaString("a\\b\"c'd\ne\rf\0g")).toBe("a\\\\b\\\"c\\'d\\ne\\rf\\0g");
  });

  it("returns plain strings unchanged", () => {
    expect(escapeLuaString("hello_world123")).toBe("hello_world123");
  });

  it("handles empty string", () => {
    expect(escapeLuaString("")).toBe("");
  });

  // Security: injection payloads should be fully escaped
  it("prevents Lua code injection via escaped string", () => {
    const payload = '"); os.execute("rm -rf /"); --';
    const escaped = escapeLuaString(payload);
    // The escaped version should not contain unescaped quotes that would break out
    expect(escaped).not.toContain('";');
    expect(escaped).not.toContain("'");
    // Verify it's safe to embed in a Lua double-quoted string
    const luaCode = `local x = "${escaped}"`;
    // The string should be a single valid Lua string literal — no code execution
    expect(luaCode).toContain('\\"');
  });

  it("prevents injection via table name with SQL/Lua payload", () => {
    const tableName = "users'; os.execute('id'); --";
    const escaped = escapeLuaString(tableName);
    expect(escaped).toBe("users\\'; os.execute(\\'id\\'); --");
  });

  it("prevents injection via path with Lua metacharacters", () => {
    const maliciousPath = 'C:\\Users\\evil\\"); os.execute("calc")--';
    const escaped = escapeLuaString(maliciousPath);
    // Should be safe to embed in a Lua string
    expect(escaped).toContain("\\\\");
    expect(escaped).toContain('\\"');
  });
});

describe("validateLuaIdentifier", () => {
  it("accepts valid identifiers", () => {
    expect(() => validateLuaIdentifier("users")).not.toThrow();
    expect(() => validateLuaIdentifier("User")).not.toThrow();
    expect(() => validateLuaIdentifier("_private")).not.toThrow();
    expect(() => validateLuaIdentifier("table_name")).not.toThrow();
    expect(() => validateLuaIdentifier("Column123")).not.toThrow();
    expect(() => validateLuaIdentifier("_")).not.toThrow();
  });

  it("rejects identifiers starting with a digit", () => {
    expect(() => validateLuaIdentifier("1table")).toThrow("Invalid identifier");
  });

  it("rejects identifiers with special characters", () => {
    expect(() => validateLuaIdentifier("table-name")).toThrow("Invalid identifier");
    expect(() => validateLuaIdentifier("table name")).toThrow("Invalid identifier");
    expect(() => validateLuaIdentifier("table.name")).toThrow("Invalid identifier");
  });

  it("rejects empty string", () => {
    expect(() => validateLuaIdentifier("")).toThrow("Invalid identifier");
  });

  // Security: injection payloads should be rejected
  it("rejects SQL injection payload", () => {
    expect(() => validateLuaIdentifier("users'; DROP TABLE users; --")).toThrow("Invalid identifier");
  });

  it("rejects Lua code injection payload", () => {
    expect(() => validateLuaIdentifier('users"; os.execute("rm -rf /")')).toThrow("Invalid identifier");
  });

  it("rejects Lua long bracket injection", () => {
    expect(() => validateLuaIdentifier("foo]]; os.execute('id'); --")).toThrow("Invalid identifier");
  });

  it("rejects null bytes", () => {
    expect(() => validateLuaIdentifier("table\0name")).toThrow("Invalid identifier");
  });

  it("rejects unicode special characters", () => {
    expect(() => validateLuaIdentifier("täble")).toThrow("Invalid identifier");
  });
});

describe("LuaBridge.parseJson error handling", () => {
  const bridge = new LuaBridge();

  // Access private parseJson via bracket notation for testing
  const parseJson = (bridge as any).parseJson.bind(bridge);

  it("parses valid JSON object", () => {
    expect(parseJson('{"key": "value"}', "")).toEqual({ key: "value" });
  });

  it("parses valid JSON array", () => {
    expect(parseJson('[1, 2, 3]', "")).toEqual([1, 2, 3]);
  });

  it("extracts JSON object from output with preceding warnings", () => {
    const output = 'WARNING: deprecated function\n{"result": true}';
    expect(parseJson(output, "")).toEqual({ result: true });
  });

  it("extracts JSON array from output with preceding logs", () => {
    const output = 'Loading module...\n[{"name": "users"}]';
    expect(parseJson(output, "")).toEqual([{ name: "users" }]);
  });

  it("throws informative error for non-JSON output", () => {
    expect(() => parseJson("lua: script.lua:5: attempt to index nil", "stack traceback"))
      .toThrow("Failed to parse Lua output as JSON");
  });

  it("error message includes stdout", () => {
    try {
      parseJson("not json", "");
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("stdout: not json");
    }
  });

  it("error message includes stderr when present", () => {
    try {
      parseJson("not json", "some error");
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("stderr: some error");
    }
  });

  it("error message omits stderr when empty", () => {
    try {
      parseJson("not json", "");
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.message).not.toContain("stderr:");
    }
  });

  it("throws for empty output", () => {
    expect(() => parseJson("", "")).toThrow("Failed to parse Lua output as JSON");
  });

  it("throws for partial/malformed JSON", () => {
    expect(() => parseJson('{"key":', "")).toThrow("Failed to parse Lua output as JSON");
  });
});
