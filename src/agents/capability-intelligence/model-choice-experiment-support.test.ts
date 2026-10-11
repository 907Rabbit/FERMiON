import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createV1IAttemptCheckpointJournal,
  makeTestInvalidObservationInput,
  runV1IAttempt,
  V1IAttemptCheckpointJournalError,
} from "./model-choice-experiment-support.js";

describe("v1I attempt checkpoint journal", () => {
  it("persists stage-start while an awaited operation is unresolved", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-checkpoint-hang-"));
    try {
      const journal = createJournal(root);
      journal.record("attempt-initialized");
      journal.record("provider-response-wait-start");
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });

      await Promise.resolve();

      expect(readStages(root)).toEqual(["attempt-initialized", "provider-response-wait-start"]);
      release();
      await pending;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps normal completion checkpoints ordered and unique", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-checkpoint-complete-"));
    try {
      const journal = createJournal(root);
      journal.record("attempt-initialized");
      journal.record("prompt-preparation-start");
      journal.record("prompt-preparation-complete");
      journal.record("terminal-observed");

      const records = readRecords(root);
      expect(records.map((record) => record.stage)).toEqual([
        "attempt-initialized",
        "prompt-preparation-start",
        "prompt-preparation-complete",
        "terminal-observed",
      ]);
      expect(records.map((record) => record.sequenceNumber)).toEqual([1, 2, 3, 4]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("records the asynchronous timeout and abort ordering", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-checkpoint-timeout-"));
    try {
      const journal = createJournal(root);
      journal.record("provider-response-wait-start");
      journal.record("timeout-armed");
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          journal.record("timeout-fired");
          journal.record("abort-requested");
          resolve();
        }, 5);
      });

      expect(readStages(root)).toEqual([
        "provider-response-wait-start",
        "timeout-armed",
        "timeout-fired",
        "abort-requested",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows that a blocked event loop delays the timeout callback", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-checkpoint-blocked-"));
    try {
      const journal = createJournal(root);
      let timeoutFired = false;
      journal.record("provider-response-wait-start");
      const timer = setTimeout(() => {
        timeoutFired = true;
        journal.record("timeout-fired");
      }, 1);
      const startedAt = Date.now();
      while (Date.now() - startedAt < 20) {
        // Bounded fixture: prove timer starvation without creating a deadlock.
      }
      expect(timeoutFired).toBe(false);
      clearTimeout(timer);
      expect(readStages(root)).toEqual(["provider-response-wait-start"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("surfaces journal write failures instead of pretending durability exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-checkpoint-failure-"));
    try {
      const journal = createJournal(root);
      fs.mkdirSync(path.join(root, "attempt-checkpoints.jsonl"));
      expect(() => journal.record("attempt-initialized")).toThrow(V1IAttemptCheckpointJournalError);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not convert a journal failure into a scientific invalid attempt", async () => {
    const onObservation = vi.fn();
    const journalError = new V1IAttemptCheckpointJournalError("provider-request-send-start", {});

    await expect(
      runV1IAttempt(
        makeTestInvalidObservationInput(),
        async () => {
          throw journalError;
        },
        onObservation,
      ),
    ).rejects.toBe(journalError);
    expect(onObservation).not.toHaveBeenCalled();
  });
});

function createJournal(root: string) {
  return createV1IAttemptCheckpointJournal({
    root,
    attemptId: "v1i-real-exact-file-write-notes-B-3-attempt-2",
    caseId: "file-write-notes",
    arm: "B",
    replicate: 3,
    attemptIndex: 2,
  });
}

function readRecords(root: string): Array<{ stage: string; sequenceNumber: number }> {
  return fs
    .readFileSync(path.join(root, "attempt-checkpoints.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { stage: string; sequenceNumber: number });
}

function readStages(root: string): string[] {
  return readRecords(root).map((record) => record.stage);
}
