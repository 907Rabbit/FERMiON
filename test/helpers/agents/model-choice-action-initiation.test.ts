import { describe, expect, it } from "vitest";
import {
  assertV1JSchemaBaseline,
  type V1JCapturedSchemaSurface,
  type V1JSchemaBaseline,
} from "./model-choice-action-initiation.js";

const expected: V1JSchemaBaseline = {
  baselineType: "REAL_EXACT provider-bound canonical tool surface",
  benchmarkCandidateInventoryCount: 31,
  mappedRuntimeNameCount: 16,
  expectedRealExactRuntimeCount: 15,
  expectedRuntimeNames: [
    "apply_patch",
    "edit",
    "exec",
    "memory_get",
    "memory_search",
    "message",
    "process",
    "read",
    "sessions_history",
    "sessions_list",
    "sessions_search",
    "sessions_spawn",
    "web_fetch",
    "web_search",
    "write",
  ],
  authorizedToolCount: 15,
  providerToolCount: 15,
  authorizedToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
  providerToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
  authorizedToolSchemaSha256: "e82b1930002abb9d4784edcada56491af39420d36e292c9f9792256a2231f128",
  providerToolSchemaSha256: "e87b23c436597f65b0a76c5f91a49b53440178731718efdbc70a7a048cbf39b2",
  schemaCanonicalizationVersion: "v1j-provider-schema-v1",
  schemaCanonicalization: ["Sort tools, sort object keys, preserve array order."],
  authorizedSetEqualsProviderSet: true,
  freshRuntimeRepeatability: true,
  armAArmCParity: true,
  imageBenchmarkMapping: "image",
  runtimeBuiltInImageToolName: "view_image",
  imageFactoryEligible: false,
  imageFactoryConstructed: false,
  activeFilteringEnabled: false,
};

const actual: V1JCapturedSchemaSurface = {
  authorizedToolCount: 15,
  providerToolCount: 15,
  authorizedToolNameSha256: expected.authorizedToolNameSha256,
  providerToolNameSha256: expected.providerToolNameSha256,
  authorizedToolSchemaSha256: expected.authorizedToolSchemaSha256,
  providerToolSchemaSha256: expected.providerToolSchemaSha256,
  authorizedToolNames: [...expected.expectedRuntimeNames],
};

describe("v1J schema baseline validation", () => {
  it("compares measured fields and runtime names, not descriptive protocol metadata", () => {
    expect(() => assertV1JSchemaBaseline(expected, actual)).not.toThrow();
  });

  it("rejects a mismatch in each required measurement", () => {
    const mutations: Array<[keyof V1JCapturedSchemaSurface, number | string]> = [
      ["authorizedToolCount", 14],
      ["providerToolCount", 14],
      ["authorizedToolNameSha256", "0".repeat(64)],
      ["providerToolNameSha256", "0".repeat(64)],
      ["authorizedToolSchemaSha256", "0".repeat(64)],
      ["providerToolSchemaSha256", "0".repeat(64)],
    ];
    for (const [field, value] of mutations) {
      expect(() => assertV1JSchemaBaseline(expected, { ...actual, [field]: value })).toThrow(field);
    }
  });

  it("requires exact ordered names and cannot bypass required checks with extra fields", () => {
    expect(() =>
      assertV1JSchemaBaseline(expected, {
        ...actual,
        authorizedToolNames: actual.authorizedToolNames.toReversed(),
      }),
    ).toThrow("authorizedToolNames");
    expect(() =>
      assertV1JSchemaBaseline(
        { ...expected, expectedRuntimeNames: expected.expectedRuntimeNames.toReversed() },
        actual,
      ),
    ).toThrow("authorizedToolNames");
    const withExtraMeasurement = Object.assign({}, actual, {
      providerToolCount: 14,
      diagnosticOnlyMeasurement: 15,
    });
    expect(() => assertV1JSchemaBaseline(expected, withExtraMeasurement)).toThrow(
      "providerToolCount",
    );
  });
});
