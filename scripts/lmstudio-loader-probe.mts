import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveWindowsPowerShellPath,
  resolveWindowsTaskkillPath,
} from "./lib/windows-taskkill.mjs";

export const LMSTUDIO_LOADER_PROBE_MODES = [
  "native-import",
  "require",
  "current-loader",
  "current-native-loader",
  "jiti-sync",
  "jiti-async",
  "runtime-registry",
] as const;
export type LmstudioLoaderProbeMode = (typeof LMSTUDIO_LOADER_PROBE_MODES)[number];

export type ExternalChildProbeOptions = Readonly<{
  childPath: string;
  args?: readonly string[];
  timeoutMs: number;
  outputDirectory: string;
  environment?: NodeJS.ProcessEnv;
}>;

type ChildResourceSnapshot = Readonly<{
  cpuSeconds: number | null;
  readBytes: number | null;
  writeBytes: number | null;
}>;

export type ExternalChildProbeResult = Readonly<{
  childPid: number | null;
  childProcessSpawned: boolean;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childExitReason: "EXITED" | "PARENT_WATCHDOG_TIMEOUT" | "SPAWN_ERROR";
  timedOut: boolean;
  wallTimeMs: number;
  stdout: string;
  stderr: string;
  markers: ReadonlyArray<Record<string, unknown>>;
  lastMarker: Record<string, unknown> | null;
  diagnostics: ReadonlyArray<Record<string, unknown>>;
  resourceBefore: ChildResourceSnapshot | null;
  resourceAtTimeout: ChildResourceSnapshot | null;
  artifactDirectory: string;
}>;

function readChildResourceSnapshot(pid: number): ChildResourceSnapshot | null {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    const script =
      "$p=Get-Process -Id " +
      String(pid) +
      " -ErrorAction SilentlyContinue; if($p){[pscustomobject]@{cpuSeconds=$p.TotalProcessorTime.TotalSeconds;readBytes=$p.ReadTransferCount;writeBytes=$p.WriteTransferCount}|ConvertTo-Json -Compress}";
    const raw = execFileSync(
      resolveWindowsPowerShellPath(),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        timeout: 1_000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const numberOrNull = (value: unknown) => (typeof value === "number" ? value : null);
    return {
      cpuSeconds: numberOrNull(record.cpuSeconds),
      readBytes: numberOrNull(record.readBytes),
      writeBytes: numberOrNull(record.writeBytes),
    };
  } catch {
    return null;
  }
}

function parseMarkers(output: string): Record<string, unknown>[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line);
        return value && typeof value === "object" && !Array.isArray(value)
          ? [value as Record<string, unknown>]
          : [];
      } catch {
        return [];
      }
    });
}

function readJsonLines(filePath: string): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return parseMarkers(fs.readFileSync(filePath, "utf8"));
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync(resolveWindowsTaskkillPath(), ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function waitForChildClose(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function writeProbeArtifact(directory: string, name: string, value: unknown): void {
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeTextArtifact(directory: string, name: string, value: string): void {
  fs.writeFileSync(path.join(directory, name), value, "utf8");
}

export async function runExternalChildProbe(
  options: ExternalChildProbeOptions,
): Promise<ExternalChildProbeResult> {
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const diagnosticPath = path.join(options.outputDirectory, "loader-diagnostics.jsonl");
  if (fs.existsSync(diagnosticPath)) {
    fs.rmSync(diagnosticPath);
  }
  const startedAt = Date.now();
  const child = spawn(process.execPath, [...(options.args ?? [])], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...options.environment,
      OPENCLAW_PLUGIN_LOADER_DIAGNOSTICS_FILE: diagnosticPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childPid = child.pid ?? null;
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  if (!childPid) {
    return {
      childPid: null,
      childProcessSpawned: false,
      childExitCode: null,
      childSignal: null,
      childExitReason: "SPAWN_ERROR",
      timedOut: false,
      wallTimeMs: Date.now() - startedAt,
      stdout,
      stderr: `${stderr}\nchild process did not expose a pid`,
      markers: [],
      lastMarker: null,
      diagnostics: [],
      resourceBefore: null,
      resourceAtTimeout: null,
      artifactDirectory: options.outputDirectory,
    };
  }
  const resourceBefore = readChildResourceSnapshot(childPid);
  const closePromise = waitForChildClose(child);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let resourceAtTimeout: ChildResourceSnapshot | null = null;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      resourceAtTimeout = readChildResourceSnapshot(childPid);
      killProcessTree(child);
      resolve(null);
    }, options.timeoutMs);
  });
  const close = await Promise.race([closePromise, timeoutPromise]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  const finalClose =
    close ??
    (await Promise.race([
      closePromise,
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        setTimeout(() => resolve({ code: null, signal: null }), 5_000);
      }),
    ]));
  const markers = parseMarkers(stdout);
  const diagnostics = readJsonLines(diagnosticPath);
  const result: ExternalChildProbeResult = {
    childPid,
    childProcessSpawned: true,
    childExitCode: finalClose.code,
    childSignal: finalClose.signal,
    childExitReason: timedOut ? "PARENT_WATCHDOG_TIMEOUT" : "EXITED",
    timedOut,
    wallTimeMs: Date.now() - startedAt,
    stdout,
    stderr,
    markers,
    lastMarker: markers.at(-1) ?? null,
    diagnostics,
    resourceBefore,
    resourceAtTimeout,
    artifactDirectory: options.outputDirectory,
  };
  writeTextArtifact(options.outputDirectory, "stdout.log", stdout);
  writeTextArtifact(options.outputDirectory, "stderr.log", stderr);
  writeProbeArtifact(options.outputDirectory, "probe-result.json", result);
  return result;
}

function nodeArgsForMode(mode: LmstudioLoaderProbeMode, childPath: string): string[] {
  const usesSourceImports = !["native-import", "require"].includes(mode);
  return [...(usesSourceImports ? ["--import", "tsx"] : []), childPath, mode];
}

export async function runLmstudioLoaderProbe(params: {
  mode: LmstudioLoaderProbeMode;
  timeoutMs?: number;
  outputDirectory?: string;
}): Promise<ExternalChildProbeResult> {
  const outputDirectory =
    params.outputDirectory ??
    fs.mkdtempSync(path.join(os.tmpdir(), `openclaw-lmstudio-loader-${params.mode}-`));
  const childPath = fileURLToPath(new URL("./lmstudio-loader-probe-child.mjs", import.meta.url));
  return await runExternalChildProbe({
    childPath,
    args: nodeArgsForMode(params.mode, childPath),
    timeoutMs: params.timeoutMs ?? 30_000,
    outputDirectory,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requestedMode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice(7);
  const modes = requestedMode
    ? [requestedMode as LmstudioLoaderProbeMode]
    : [...LMSTUDIO_LOADER_PROBE_MODES];
  const root = path.resolve("artifacts/capability-intelligence/lmstudio-loader-probe");
  const results = [];
  for (const mode of modes) {
    const result = await runLmstudioLoaderProbe({
      mode,
      outputDirectory: path.join(root, mode),
    });
    results.push({
      mode,
      childPid: result.childPid,
      childProcessSpawned: result.childProcessSpawned,
      childExitCode: result.childExitCode,
      childSignal: result.childSignal,
      childExitReason: result.childExitReason,
      timedOut: result.timedOut,
      wallTimeMs: result.wallTimeMs,
      lastMarker: result.lastMarker,
      diagnostics: result.diagnostics,
      resourceBefore: result.resourceBefore,
      resourceAtTimeout: result.resourceAtTimeout,
      artifactDirectory: result.artifactDirectory,
    });
  }
  console.log(JSON.stringify(results, null, 2));
}
