import { describe, it, expect } from "vitest";
import { escapeLuaString, validateLuaIdentifier } from "../../src/core/lua-bridge.js";

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
