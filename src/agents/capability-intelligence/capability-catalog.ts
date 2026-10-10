import { normalizeToolIdentifier } from "./tool-identifier.js";

export const CAPABILITY_DOMAIN_IDS = [
  "git",
  "filesystem",
  "shell",
  "coding",
  "web",
  "sessions",
  "messaging",
  "automation",
  "memory",
  "tooling",
] as const;

export type CapabilityDomain = (typeof CAPABILITY_DOMAIN_IDS)[number];

/**
 * Retrieval vocabulary for stage-1 domain inference. Not prompt text.
 * `tooling` covers tool-search controls, which are not one of the product domains.
 */
export const CAPABILITY_DOMAINS: readonly {
  id: CapabilityDomain;
  terms: readonly string[];
}[] = [
  {
    id: "git",
    terms: [
      "git",
      "diff",
      "commit",
      "repository",
      "change",
      "changed",
      "status",
      "branch",
      "uncommitted",
      "staged",
    ],
  },
  {
    id: "filesystem",
    terms: ["file", "files", "directory", "folder", "path", "read", "write", "contents", "source"],
  },
  {
    id: "shell",
    terms: ["shell", "command", "terminal", "process", "exec", "script", "background"],
  },
  {
    id: "coding",
    terms: [
      "code",
      "test",
      "tests",
      "pytest",
      "python",
      "failing",
      "failure",
      "patch",
      "edit",
      "bug",
      "lint",
      "assertion",
    ],
  },
  {
    id: "web",
    terms: [
      "web",
      "url",
      "page",
      "browser",
      "fetch",
      "documentation",
      "online",
      "site",
      "internet",
    ],
  },
  {
    id: "sessions",
    terms: ["session", "sessions", "conversation", "transcript", "spawn", "agent", "history"],
  },
  {
    id: "messaging",
    terms: ["message", "send", "channel", "email", "notify", "reply", "team"],
  },
  {
    id: "automation",
    terms: [
      "schedule",
      "cron",
      "recurring",
      "reminder",
      "remind",
      "calendar",
      "daily",
      "weekly",
      "job",
      "meeting",
    ],
  },
  {
    id: "memory",
    terms: ["memory", "note", "notes", "remember", "recall", "saved", "decision", "decided"],
  },
  {
    id: "tooling",
    terms: ["catalog", "describe", "invoke", "schema", "parameter", "available"],
  },
];

const READ_ALIASES = [
  "read file",
  "open file",
  "file contents",
  "source file",
  "inspect file",
] as const;

const WRITE_ALIASES = ["write file", "create file", "new file", "save file"] as const;

const EDIT_ALIASES = ["edit file", "modify source file"] as const;

/**
 * Compact retrieval vocabulary keyed by tool name. These phrases are indexed
 * for ranking only and must never be copied into a prompt.
 */
export const CAPABILITY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  git_diff: [
    "git",
    "diff",
    "changes",
    "modified files",
    "compare changes",
    "repository changes",
    "uncommitted",
    "commit",
  ],
  git_status: [
    "git",
    "status",
    "changed files",
    "modified",
    "staged",
    "untracked",
    "repository status",
  ],
  pytest: [
    "python tests",
    "test suite",
    "run tests",
    "failing tests",
    "pytest",
    "unit tests",
    "assertions",
  ],
  read: READ_ALIASES,
  read_file: READ_ALIASES,
  write: WRITE_ALIASES,
  write_file: WRITE_ALIASES,
  edit: EDIT_ALIASES,
  edit_file: EDIT_ALIASES,
  apply_patch: ["apply patch", "patch file", "code patch"],
  exec: ["shell", "command", "terminal", "run command", "execute"],
  process: ["background process", "running process", "stop process", "attached process"],
  web_search: ["web search", "search the web", "internet", "online", "documentation"],
  web_fetch: ["fetch url", "fetch page", "open page", "download page", "web page"],
  browser: ["browser", "click", "navigate site", "web automation"],
  message: ["send message", "channel", "notify", "team message"],
  email: ["email", "inbox", "mail thread", "reply"],
  cron: ["schedule", "recurring", "cron job", "daily", "weekly", "reminder"],
  calendar: ["calendar", "meeting", "event", "appointment", "schedule"],
  memory_search: ["memory", "saved note", "remember", "recall", "search notes", "decision"],
  memory_get: ["memory entry", "open note", "saved memory", "read note"],
  sessions_list: ["list sessions", "recent sessions", "agent sessions", "conversation"],
  sessions_history: ["session history", "conversation", "transcript", "previous conversation"],
  sessions_spawn: ["spawn session", "new agent session", "parallel session", "start agent"],
  sessions_search: ["search sessions", "find conversation"],
  tool_search: ["search tools", "tool catalog", "available tools", "tool directory"],
  tool_describe: ["describe tool", "tool schema", "tool parameters"],
  tool_call: ["call tool", "invoke tool"],
};

const TOOL_DOMAINS: Readonly<Record<string, CapabilityDomain>> = {
  git_diff: "git",
  git_status: "git",
  read: "filesystem",
  read_file: "filesystem",
  write: "filesystem",
  write_file: "filesystem",
  edit: "coding",
  edit_file: "coding",
  apply_patch: "coding",
  pytest: "coding",
  exec: "shell",
  process: "shell",
  terminal: "shell",
  web_search: "web",
  web_fetch: "web",
  browser: "web",
  message: "messaging",
  email: "messaging",
  cron: "automation",
  calendar: "automation",
  memory_search: "memory",
  memory_get: "memory",
  sessions_list: "sessions",
  sessions_history: "sessions",
  sessions_spawn: "sessions",
  sessions_search: "sessions",
  session_status: "sessions",
  tool_search: "tooling",
  tool_describe: "tooling",
  tool_call: "tooling",
};

const DOMAIN_FROM_TOKEN: Readonly<Record<string, CapabilityDomain>> = {
  git: "git",
  file: "filesystem",
  filesystem: "filesystem",
  read: "filesystem",
  write: "filesystem",
  dir: "filesystem",
  directory: "filesystem",
  shell: "shell",
  exec: "shell",
  process: "shell",
  terminal: "shell",
  bash: "shell",
  pytest: "coding",
  test: "coding",
  edit: "coding",
  patch: "coding",
  web: "web",
  browser: "web",
  http: "web",
  fetch: "web",
  session: "sessions",
  sessions: "sessions",
  message: "messaging",
  email: "messaging",
  cron: "automation",
  calendar: "automation",
  schedule: "automation",
  memory: "memory",
  tool: "tooling",
};

export function domainForTool(name: string): CapabilityDomain | undefined {
  const key = name.trim().toLowerCase();
  const explicit =
    TOOL_DOMAINS[key] ?? TOOL_DOMAINS[normalizeToolIdentifier(key).replace(/ /g, "_")];
  if (explicit) {
    return explicit;
  }
  for (const token of normalizeToolIdentifier(key).split(" ")) {
    const domain = DOMAIN_FROM_TOKEN[token];
    if (domain) {
      return domain;
    }
  }
  return undefined;
}

export function aliasesForTool(name: string): readonly string[] {
  const key = name.trim().toLowerCase();
  const direct = CAPABILITY_ALIASES[key];
  if (direct) {
    return direct;
  }
  return CAPABILITY_ALIASES[normalizeToolIdentifier(key).replace(/ /g, "_")] ?? [];
}
