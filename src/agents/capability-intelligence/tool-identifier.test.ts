import { describe, expect, it } from "vitest";
import { normalizeToolIdentifier } from "./tool-identifier.js";

describe("normalizeToolIdentifier", () => {
  it.each([
    ["sessions_spawn", "sessions spawn"],
    ["filesystem_read", "filesystem read"],
    ["git_diff", "git diff"],
    ["web_search", "web search"],
    ["readFile", "read file"],
    ["web-search", "web search"],
    ["namespace.tool", "namespace tool"],
    ["git.diff", "git diff"],
  ])("splits %s into lexical tokens", (name, expected) => {
    expect(normalizeToolIdentifier(name)).toBe(expected);
  });
});
