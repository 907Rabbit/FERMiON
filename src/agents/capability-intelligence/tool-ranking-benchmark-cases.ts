export type BenchmarkTool = {
  name: string;
  description: string;
};

export type ToolRankingBenchmarkCategory =
  | "git"
  | "filesystem"
  | "coding"
  | "shell"
  | "sessions"
  | "memory"
  | "web"
  | "messaging"
  | "cron"
  | "tool-search"
  | "mixed";

export type ToolRankingBenchmarkSplit = "development" | "held-out";

/**
 * What omitting the tool does to the task.
 * `required` means the task is not solvable without it.
 * `relevant` is a strong companion or alternate that is not required.
 * `optional` may help and must not decide promotion.
 * `runtime-mandatory` is carried beside retrieval, not judged as a semantic hit.
 */
export type ExpectedToolRole = "required" | "relevant" | "optional" | "runtime-mandatory";

export type ToolRankingBenchmarkCase = {
  id: string;
  category: ToolRankingBenchmarkCategory;
  /**
   * Development cases may inform alias and domain vocabulary.
   * Held-out cases are the promotion-gate corpus.
   */
  split: ToolRankingBenchmarkSplit;
  query: string;
  tools: BenchmarkTool[];
  /**
   * Legacy graded set. The first name is the MRR anchor, and the v1A/v1B
   * mandatory-loss comparison still counts this whole list. Promotion uses
   * `toolRoles` instead, so a name can stay here and still be relevant or optional.
   */
  expectedTopTools: string[];
  optionalRelevantTools?: string[];
  /**
   * Role for every legacy graded tool. Keys must match that set exactly.
   * Absent on hand-built cases: expected tools are required and optional tools stay optional.
   */
  toolRoles?: Readonly<Record<string, ExpectedToolRole>>;
  irrelevantTools?: string[];
  topK: number;
};

const CORE_BENCHMARK_TOOLS: BenchmarkTool[] = [
  { name: "git_diff", description: "Compare working tree changes, staged changes, and commits" },
  { name: "pytest", description: "Run Python tests and inspect test failures" },
  { name: "git_status", description: "Inspect repository status and changed files" },
  { name: "read", description: "Read source files and inspect project contents" },
  { name: "apply_patch", description: "Apply a patch to modify source files" },
  { name: "exec", description: "Run shell commands, tests, and development scripts" },
  { name: "process", description: "Manage running terminal processes and sessions" },
  { name: "web_search", description: "Search the web for current information" },
  { name: "web_fetch", description: "Fetch and read a page from a URL" },
  { name: "message", description: "Send a message to a person or channel" },
  { name: "camera", description: "Capture an image from a device camera" },
  { name: "cron", description: "Schedule and manage recurring jobs" },
  { name: "browser", description: "Control a browser and interact with web pages" },
  { name: "memory_search", description: "Search persistent notes and memories" },
  { name: "memory_get", description: "Read a selected memory entry" },
  { name: "sessions_list", description: "List recent agent sessions" },
  { name: "sessions_history", description: "Read messages from a session history" },
  { name: "image", description: "Analyze an image or visual attachment" },
  { name: "canvas", description: "Display content on a connected device canvas" },
  { name: "calendar", description: "Read and manage calendar events" },
  { name: "email", description: "Search and send email messages" },
  { name: "docker", description: "Build and manage containers and images" },
  { name: "weather", description: "Look up current weather conditions" },
  { name: "update", description: "Update the local application installation" },
];

const EXPANDED_BENCHMARK_TOOLS: BenchmarkTool[] = [
  ...CORE_BENCHMARK_TOOLS,
  { name: "edit", description: "Edit an existing source file" },
  { name: "write", description: "Create or overwrite a file" },
  { name: "sessions_spawn", description: "Start a new agent session" },
  { name: "sessions_search", description: "Search prior session transcripts" },
  { name: "tool_search", description: "Search the tool catalog" },
  { name: "tool_describe", description: "Describe a tool schema before calling it" },
  { name: "tool_call", description: "Invoke a catalog tool" },
];

// `canvas` is not a default distractor: its description uses "content", which
// stems onto file-content queries and is a precision issue, not a hard miss.
const DEFAULT_IRRELEVANT = ["camera", "docker"] as const;

const EXPECTED_TOOL_ROLES = new Set<ExpectedToolRole>([
  "required",
  "relevant",
  "optional",
  "runtime-mandatory",
]);

type BenchmarkCaseInput = {
  id: string;
  category: ToolRankingBenchmarkCategory;
  split: ToolRankingBenchmarkSplit;
  query: string;
  expectedTopTools: string[];
  optionalRelevantTools?: string[];
  toolRoles: Readonly<Record<string, ExpectedToolRole>>;
  irrelevantTools?: string[];
  tools?: BenchmarkTool[];
};

function defineBenchmarkCase(input: BenchmarkCaseInput): ToolRankingBenchmarkCase {
  const tools = input.tools ?? EXPANDED_BENCHMARK_TOOLS;
  const graded = [...input.expectedTopTools, ...(input.optionalRelevantTools ?? [])];
  const relevant = new Set(graded);
  if (relevant.size !== graded.length) {
    throw new Error(`duplicate graded tool in ${input.id}`);
  }
  const roleNames = Object.keys(input.toolRoles);
  if (
    roleNames.length !== relevant.size ||
    roleNames.some((name) => !relevant.has(name)) ||
    Object.values(input.toolRoles).some((role) => !EXPECTED_TOOL_ROLES.has(role))
  ) {
    throw new Error(`tool roles for ${input.id} must match the graded tools`);
  }
  const irrelevantTools =
    input.irrelevantTools ??
    DEFAULT_IRRELEVANT.filter(
      (name) => !relevant.has(name) && tools.some((tool) => tool.name === name),
    );
  return {
    id: input.id,
    category: input.category,
    split: input.split,
    query: input.query,
    tools,
    expectedTopTools: input.expectedTopTools,
    ...(input.optionalRelevantTools ? { optionalRelevantTools: input.optionalRelevantTools } : {}),
    toolRoles: input.toolRoles,
    irrelevantTools,
    topK: 8,
  };
}

export function toolRole(
  benchmarkCase: ToolRankingBenchmarkCase,
  name: string,
): ExpectedToolRole | undefined {
  const explicit = benchmarkCase.toolRoles?.[name];
  if (explicit) {
    return explicit;
  }
  if (benchmarkCase.expectedTopTools.includes(name)) {
    return "required";
  }
  if (benchmarkCase.optionalRelevantTools?.includes(name)) {
    return "optional";
  }
  return undefined;
}

const V1A_COMPARISON_IDS = new Set([
  "python-test-regression",
  "web-research",
  "find-prior-decision",
  "schedule-reminder",
]);

export const TOOL_RANKING_BENCHMARK_CASES: readonly ToolRankingBenchmarkCase[] = [
  defineBenchmarkCase({
    id: "python-test-regression",
    category: "coding",
    split: "development",
    query: "Find why my Python tests started failing after my changes",
    tools: CORE_BENCHMARK_TOOLS,
    expectedTopTools: ["pytest", "git_diff"],
    optionalRelevantTools: ["git_status", "read"],
    toolRoles: {
      pytest: "required",
      git_diff: "required",
      git_status: "relevant",
      read: "relevant",
    },
    irrelevantTools: ["camera", "message", "cron"],
  }),
  defineBenchmarkCase({
    id: "web-research",
    category: "web",
    split: "development",
    query: "Research the latest documentation about browser automation and summarize it",
    tools: CORE_BENCHMARK_TOOLS,
    expectedTopTools: ["web_search", "web_fetch"],
    optionalRelevantTools: ["browser", "read"],
    // Local file read is not required to research and summarize documentation.
    toolRoles: {
      web_search: "required",
      web_fetch: "required",
      browser: "optional",
      read: "optional",
    },
    irrelevantTools: ["camera", "cron", "calendar"],
  }),
  defineBenchmarkCase({
    id: "find-prior-decision",
    category: "mixed",
    split: "development",
    query: "Find the previous conversation where we decided how memory search should work",
    tools: CORE_BENCHMARK_TOOLS,
    expectedTopTools: ["sessions_history", "memory_search"],
    optionalRelevantTools: ["sessions_list", "memory_get"],
    toolRoles: {
      sessions_history: "required",
      memory_search: "relevant",
      sessions_list: "optional",
      memory_get: "optional",
    },
    irrelevantTools: ["camera", "docker", "weather"],
  }),
  defineBenchmarkCase({
    id: "schedule-reminder",
    category: "cron",
    split: "development",
    query: "Schedule a recurring reminder to send a weekly project update to the team",
    tools: CORE_BENCHMARK_TOOLS,
    expectedTopTools: ["cron", "message"],
    optionalRelevantTools: ["calendar", "sessions_history"],
    // Creating the schedule does not require sending the update now.
    toolRoles: {
      cron: "required",
      message: "relevant",
      calendar: "optional",
      sessions_history: "optional",
    },
    irrelevantTools: ["camera", "pytest", "docker"],
  }),
  defineBenchmarkCase({
    id: "git-what-changed",
    category: "git",
    split: "development",
    query: "Show me what changed in the repository since the last commit",
    expectedTopTools: ["git_diff", "git_status"],
    toolRoles: { git_diff: "required", git_status: "relevant" },
  }),
  defineBenchmarkCase({
    id: "git-status-only",
    category: "git",
    split: "development",
    query: "Which files are modified but not staged?",
    expectedTopTools: ["git_status"],
    optionalRelevantTools: ["git_diff"],
    toolRoles: { git_status: "required", git_diff: "relevant" },
  }),
  defineBenchmarkCase({
    id: "file-lookup",
    category: "filesystem",
    split: "development",
    query: "Open the source file that defines the ranking helper and show its contents",
    expectedTopTools: ["read"],
    optionalRelevantTools: ["edit"],
    toolRoles: { read: "required", edit: "optional" },
  }),
  defineBenchmarkCase({
    id: "pytest-suite",
    category: "coding",
    split: "development",
    query: "Run the Python unit test suite and show the failures",
    expectedTopTools: ["pytest"],
    optionalRelevantTools: ["exec"],
    toolRoles: { pytest: "required", exec: "optional" },
  }),
  defineBenchmarkCase({
    id: "apply-source-patch",
    category: "coding",
    split: "development",
    query: "Apply this patch to the source files",
    expectedTopTools: ["apply_patch"],
    optionalRelevantTools: ["read", "edit", "git_diff"],
    toolRoles: {
      apply_patch: "required",
      read: "relevant",
      edit: "optional",
      git_diff: "optional",
    },
  }),
  defineBenchmarkCase({
    id: "shell-command",
    category: "shell",
    split: "development",
    query: "Run a shell command in the workspace and leave it running in the terminal",
    expectedTopTools: ["exec", "process"],
    toolRoles: { exec: "required", process: "required" },
  }),
  defineBenchmarkCase({
    id: "process-and-logs",
    category: "shell",
    split: "development",
    query: "Run the dev server in a terminal session and keep the process attached",
    expectedTopTools: ["exec", "process"],
    toolRoles: { exec: "required", process: "required" },
  }),
  defineBenchmarkCase({
    id: "list-sessions",
    category: "sessions",
    split: "development",
    query: "List recent agent sessions so I can reopen the last one",
    expectedTopTools: ["sessions_list"],
    optionalRelevantTools: ["sessions_history", "sessions_search"],
    toolRoles: {
      sessions_list: "required",
      sessions_history: "relevant",
      sessions_search: "optional",
    },
  }),
  defineBenchmarkCase({
    id: "memory-recall",
    category: "memory",
    split: "development",
    query: "Look up the note I saved about how we want hybrid search to behave",
    expectedTopTools: ["memory_search"],
    optionalRelevantTools: ["memory_get"],
    toolRoles: { memory_search: "required", memory_get: "relevant" },
  }),
  defineBenchmarkCase({
    id: "fetch-docs",
    category: "web",
    split: "development",
    query: "Fetch this documentation page and pull out the configuration section",
    expectedTopTools: ["web_fetch"],
    optionalRelevantTools: ["web_search", "browser"],
    toolRoles: { web_fetch: "required", web_search: "optional", browser: "optional" },
  }),
  defineBenchmarkCase({
    id: "web-latest",
    category: "web",
    split: "development",
    query: "What changed in the latest release notes online?",
    expectedTopTools: ["web_search"],
    optionalRelevantTools: ["web_fetch", "browser"],
    toolRoles: { web_search: "required", web_fetch: "relevant", browser: "optional" },
  }),
  defineBenchmarkCase({
    id: "send-channel-message",
    category: "messaging",
    split: "development",
    query: "Send a message to the team channel with today's progress",
    expectedTopTools: ["message"],
    optionalRelevantTools: ["email"],
    toolRoles: { message: "required", email: "optional" },
  }),
  defineBenchmarkCase({
    id: "daily-job",
    category: "cron",
    split: "development",
    query: "Set up a daily job that runs every morning",
    expectedTopTools: ["cron"],
    toolRoles: { cron: "required" },
  }),
  defineBenchmarkCase({
    id: "find-tool",
    category: "tool-search",
    split: "development",
    query: "Search the tool catalog for something that can describe a tool before calling it",
    expectedTopTools: ["tool_search", "tool_describe"],
    optionalRelevantTools: ["tool_call"],
    toolRoles: { tool_search: "required", tool_describe: "required", tool_call: "optional" },
  }),
  defineBenchmarkCase({
    id: "changes-and-tests",
    category: "mixed",
    split: "development",
    query: "find what changed and why tests fail",
    expectedTopTools: ["git_diff", "pytest"],
    optionalRelevantTools: ["git_status", "read"],
    toolRoles: {
      git_diff: "required",
      pytest: "required",
      git_status: "relevant",
      read: "relevant",
    },
  }),
  defineBenchmarkCase({
    id: "memory-and-session",
    category: "mixed",
    split: "development",
    query: "Find where we previously decided the compaction threshold",
    expectedTopTools: ["memory_search", "sessions_history"],
    optionalRelevantTools: ["memory_get", "sessions_list"],
    toolRoles: {
      memory_search: "required",
      sessions_history: "required",
      memory_get: "relevant",
      sessions_list: "relevant",
    },
  }),
  defineBenchmarkCase({
    id: "spawn-and-message",
    category: "mixed",
    split: "development",
    query: "Spawn a helper session and message me when it finishes",
    expectedTopTools: ["sessions_spawn", "message"],
    optionalRelevantTools: ["sessions_list"],
    toolRoles: { sessions_spawn: "required", message: "required", sessions_list: "optional" },
  }),
  defineBenchmarkCase({
    id: "git-review-patch",
    category: "git",
    split: "held-out",
    query: "Review the uncommitted edits before I commit them",
    expectedTopTools: ["git_diff", "git_status"],
    optionalRelevantTools: ["read"],
    // The diff is enough to review the edits. Status and read are companions.
    toolRoles: { git_diff: "required", git_status: "relevant", read: "relevant" },
  }),
  defineBenchmarkCase({
    id: "file-write-notes",
    category: "filesystem",
    split: "held-out",
    query: "Create a new markdown file and put the meeting notes in it",
    expectedTopTools: ["write"],
    optionalRelevantTools: ["read", "edit"],
    toolRoles: { write: "required", read: "optional", edit: "optional" },
  }),
  defineBenchmarkCase({
    id: "read-then-edit",
    category: "filesystem",
    split: "held-out",
    query: "Read the config file and edit the port setting",
    expectedTopTools: ["read", "edit"],
    optionalRelevantTools: ["apply_patch"],
    toolRoles: { read: "required", edit: "required", apply_patch: "optional" },
  }),
  defineBenchmarkCase({
    id: "fix-regression",
    category: "coding",
    split: "held-out",
    query: "The test suite went red after the last edit. Find the failure and patch the code",
    expectedTopTools: ["pytest", "apply_patch"],
    optionalRelevantTools: ["git_diff", "read", "edit"],
    toolRoles: {
      pytest: "required",
      apply_patch: "required",
      git_diff: "relevant",
      read: "relevant",
      edit: "relevant",
    },
  }),
  defineBenchmarkCase({
    id: "python-failure-only",
    category: "coding",
    split: "held-out",
    query: "Re-run pytest and tell me which assertions failed",
    expectedTopTools: ["pytest"],
    optionalRelevantTools: ["exec", "read"],
    toolRoles: { pytest: "required", exec: "optional", read: "relevant" },
  }),
  defineBenchmarkCase({
    id: "stop-process",
    category: "shell",
    split: "held-out",
    query: "Check the background command I started and stop it if it is still running",
    expectedTopTools: ["process"],
    optionalRelevantTools: ["exec"],
    toolRoles: { process: "required", exec: "optional" },
  }),
  defineBenchmarkCase({
    id: "spawn-worker",
    category: "sessions",
    split: "held-out",
    query: "Start another agent session to handle this task in parallel",
    expectedTopTools: ["sessions_spawn"],
    optionalRelevantTools: ["sessions_list"],
    toolRoles: { sessions_spawn: "required", sessions_list: "optional" },
  }),
  defineBenchmarkCase({
    id: "session-history",
    category: "sessions",
    split: "held-out",
    query: "Read the transcript of yesterday's agent conversation",
    expectedTopTools: ["sessions_history"],
    optionalRelevantTools: ["sessions_list", "sessions_search"],
    toolRoles: {
      sessions_history: "required",
      sessions_list: "relevant",
      sessions_search: "relevant",
    },
  }),
  defineBenchmarkCase({
    id: "read-memory",
    category: "memory",
    split: "held-out",
    query: "Open the saved memory entry about the release checklist",
    expectedTopTools: ["memory_get"],
    optionalRelevantTools: ["memory_search"],
    toolRoles: { memory_get: "required", memory_search: "relevant" },
  }),
  defineBenchmarkCase({
    id: "browse-site",
    category: "web",
    split: "held-out",
    query: "Open the browser and click through the signup flow on the site",
    expectedTopTools: ["browser"],
    optionalRelevantTools: ["web_fetch", "web_search"],
    toolRoles: { browser: "required", web_fetch: "optional", web_search: "optional" },
  }),
  defineBenchmarkCase({
    id: "email-thread",
    category: "messaging",
    split: "held-out",
    query: "Find the email thread about the contract and draft a reply",
    expectedTopTools: ["email"],
    optionalRelevantTools: ["message"],
    toolRoles: { email: "required", message: "optional" },
  }),
  defineBenchmarkCase({
    id: "calendar-event",
    category: "cron",
    split: "held-out",
    query: "Put a meeting on my calendar for tomorrow afternoon",
    expectedTopTools: ["calendar"],
    optionalRelevantTools: ["cron"],
    toolRoles: { calendar: "required", cron: "optional" },
  }),
  defineBenchmarkCase({
    id: "invoke-tool",
    category: "tool-search",
    split: "held-out",
    query: "Look up how to call a deferred tool and then invoke it",
    expectedTopTools: ["tool_describe", "tool_call"],
    optionalRelevantTools: ["tool_search"],
    toolRoles: { tool_describe: "required", tool_call: "required", tool_search: "relevant" },
  }),
  defineBenchmarkCase({
    id: "tool-search-only",
    category: "tool-search",
    split: "held-out",
    query: "Which tools are available for this task? Search the directory first",
    expectedTopTools: ["tool_search"],
    optionalRelevantTools: ["tool_describe", "tool_call"],
    toolRoles: { tool_search: "required", tool_describe: "optional", tool_call: "optional" },
  }),
  defineBenchmarkCase({
    id: "research-then-remember",
    category: "mixed",
    split: "held-out",
    query: "Research the current docs for this API and save a note about the decision",
    expectedTopTools: ["web_search", "memory_search"],
    optionalRelevantTools: ["web_fetch", "memory_get"],
    toolRoles: {
      web_search: "required",
      memory_search: "required",
      web_fetch: "relevant",
      memory_get: "optional",
    },
  }),
  defineBenchmarkCase({
    id: "remind-and-email",
    category: "mixed",
    split: "held-out",
    query: "Remind me every Monday to email the status report",
    expectedTopTools: ["cron", "email"],
    optionalRelevantTools: ["message", "calendar"],
    // Scheduling the reminder does not send the email. message is a different channel.
    toolRoles: { cron: "required", email: "relevant", message: "optional", calendar: "optional" },
  }),
  defineBenchmarkCase({
    id: "fetch-and-read",
    category: "mixed",
    split: "held-out",
    query: "Download the page at this URL and read the local copy of the spec next to it",
    expectedTopTools: ["web_fetch", "read"],
    optionalRelevantTools: ["browser", "web_search"],
    toolRoles: {
      web_fetch: "required",
      read: "required",
      browser: "optional",
      web_search: "optional",
    },
  }),
];

export const TOOL_RANKING_DEVELOPMENT_CASES = TOOL_RANKING_BENCHMARK_CASES.filter(
  (benchmarkCase) => benchmarkCase.split === "development",
);

export const TOOL_RANKING_HELD_OUT_CASES = TOOL_RANKING_BENCHMARK_CASES.filter(
  (benchmarkCase) => benchmarkCase.split === "held-out",
);

export const TOOL_RANKING_V1A_COMPARISON_CASES = TOOL_RANKING_BENCHMARK_CASES.filter(
  (benchmarkCase) => V1A_COMPARISON_IDS.has(benchmarkCase.id),
);
