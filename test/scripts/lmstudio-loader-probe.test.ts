import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runExternalChildProbe } from "../../scripts/lmstudio-loader-probe.mts";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function writeChild(contents: string): string {
  const dir = tempDirs.make("openclaw-loader-probe-child-");
  const childPath = path.join(dir, "child.mjs");
  fs.writeFileSync(childPath, contents, "utf8");
  return childPath;
}

describe("lmstudio loader external probe", () => {
  it("spawns a separate child and retains structured progress markers", async () => {
    const childPath = writeChild(
      'process.stdout.write(JSON.stringify({stage:"child-started",pid:process.pid})+"\\n");\n',
    );
    const result = await runExternalChildProbe({
      childPath,
      args: [childPath],
      timeoutMs: 2_000,
      outputDirectory: tempDirs.make("openclaw-loader-probe-output-"),
    });

    expect(result.childProcessSpawned).toBe(true);
    expect(result.childExitReason).toBe("EXITED");
    expect(result.markers).toEqual([expect.objectContaining({ stage: "child-started" })]);
    expect(result.markers[0]?.pid).not.toBe(process.pid);
  });

  it("kills a blocked child at the parent timeout", async () => {
    const childPath = writeChild("setInterval(() => {}, 1_000);\n");
    const result = await runExternalChildProbe({
      childPath,
      args: [childPath],
      timeoutMs: 100,
      outputDirectory: tempDirs.make("openclaw-loader-probe-timeout-"),
    });

    expect(result.childProcessSpawned).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(result.childExitReason).toBe("PARENT_WATCHDOG_TIMEOUT");
  });

  it("preserves the last marker when the child blocks after progress", async () => {
    const childPath = writeChild(
      'process.stdout.write(JSON.stringify({stage:"jiti-module-load-started"})+"\\n");\nsetInterval(() => {}, 1_000);\n',
    );
    const result = await runExternalChildProbe({
      childPath,
      args: [childPath],
      timeoutMs: 100,
      outputDirectory: tempDirs.make("openclaw-loader-probe-marker-"),
    });

    expect(result.lastMarker).toEqual({ stage: "jiti-module-load-started" });
  });
});
