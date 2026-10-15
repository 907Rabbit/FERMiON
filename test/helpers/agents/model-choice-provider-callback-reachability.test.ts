import { describe, expect, it } from "vitest";
import {
  classifyV1JProviderCallbackReachability,
  type V1JProviderCallbackReachabilityEvent,
} from "./model-choice-provider-callback-reachability.js";

function event(
  stage: V1JProviderCallbackReachabilityEvent["stage"],
  overrides: Partial<V1JProviderCallbackReachabilityEvent> = {},
): V1JProviderCallbackReachabilityEvent {
  return {
    stage,
    entered: true,
    completed: true,
    invocationCount: 1,
    runId: "offline-run",
    promptSubmissionIndex: 1,
    modelLoopIteration: 1,
    providerInstanceId: "provider-fingerprint-a",
    hookIdentity: "hook-registration-a",
    failureClass: null,
    ...overrides,
  };
}

const successfulEvents = [
  event("provider-capture-hook-resolved"),
  event("request-observer-enter"),
  event("request-observer-exit"),
  event("provider-transform-enter"),
  event("provider-transform-exit"),
  event("provider-capture-hook-invoked", { completed: false }),
  event("provider-capture-hook-return"),
  event("capture-stop-sentinel-created"),
  event("capture-stop-sentinel-thrown"),
  event("createFailureMessage-observed"),
] satisfies V1JProviderCallbackReachabilityEvent[];

describe("v1J provider callback reachability classification", () => {
  it("recognizes observer → transform → one hook → local stop → synthetic failure with no dispatch", () => {
    expect(classifyV1JProviderCallbackReachability(successfulEvents, 0)).toBe(
      "EXPECTED_CAPTURE_SEQUENCE",
    );
  });

  it("distinguishes an observer whose provider transform is never reached", () => {
    expect(
      classifyV1JProviderCallbackReachability(
        [
          event("provider-capture-hook-resolved"),
          event("request-observer-enter"),
          event("request-observer-exit"),
        ],
        0,
      ),
    ).toBe("OBSERVER_WITHOUT_PROVIDER_TRANSFORM");
  });

  it("distinguishes a provider transform failure before the capture hook", () => {
    expect(
      classifyV1JProviderCallbackReachability(
        [
          event("request-observer-enter"),
          event("request-observer-exit"),
          event("provider-transform-enter"),
          event("provider-transform-exit", { completed: false, failureClass: "TypeError" }),
        ],
        0,
      ),
    ).toBe("PROVIDER_TRANSFORM_FAILED_BEFORE_CAPTURE_HOOK");
  });

  it("detects a resolved capture hook bypassed after the observer exits", () => {
    expect(
      classifyV1JProviderCallbackReachability(
        [
          event("provider-capture-hook-resolved"),
          event("request-observer-enter"),
          event("request-observer-exit"),
          event("provider-transform-enter"),
          event("provider-transform-exit"),
        ],
        0,
      ),
    ).toBe("CAPTURE_HOOK_RESOLVED_BUT_BYPASSED");
  });

  it("detects provider-instance or hook-registration mismatch", () => {
    expect(
      classifyV1JProviderCallbackReachability(
        [
          event("provider-capture-hook-resolved"),
          event("request-observer-enter"),
          event("request-observer-exit"),
          event("provider-transform-enter"),
          event("provider-transform-exit"),
          event("provider-capture-hook-invoked", { providerInstanceId: "provider-fingerprint-b" }),
        ],
        0,
      ),
    ).toBe("CAPTURE_HOOK_PROVIDER_INSTANCE_MISMATCH");
  });

  it("detects a local stop sentinel thrown before provider transformation", () => {
    expect(
      classifyV1JProviderCallbackReachability(
        [
          event("request-observer-enter"),
          event("request-observer-exit"),
          event("capture-stop-sentinel-created"),
          event("capture-stop-sentinel-thrown"),
        ],
        0,
      ),
    ).toBe("SYNTHETIC_STOP_BEFORE_PROVIDER_TRANSFORM");
  });

  it("keeps an unexpected second capture callback classified as a multiplicity failure", () => {
    expect(
      classifyV1JProviderCallbackReachability(
        [...successfulEvents, event("provider-capture-hook-invoked", { invocationCount: 2 })],
        0,
      ),
    ).toBe("CAPTURE_CALLBACK_MULTIPLICITY_MISMATCH");
  });

  it("does not call a capture sequence successful if any provider dispatch was attempted", () => {
    expect(classifyV1JProviderCallbackReachability(successfulEvents, 1)).toBe(
      "INCOMPLETE_PROVIDER_CALLBACK_TRACE",
    );
  });
});
