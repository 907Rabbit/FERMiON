export const V1I_PROVENANCE_AMENDMENT_FILENAME = "provenance-amendment.json";
export const V1I_MIXED_PROVENANCE_AMENDMENT_TYPE =
  "observational/resource-resolution-only mixed provenance" as const;

export type V1IProvenanceAmendment = {
  provenanceAmendment: true;
  amendmentType: typeof V1I_MIXED_PROVENANCE_AMENDMENT_TYPE;
  baseHarnessCommit: string;
  continuationHarnessCommit: string;
  scientificProtocolChanged: false;
  modelFacingBehaviorChanged: false;
  runtimeBehaviorChanged: false;
};

export function isV1IProvenanceAmendment(
  value: unknown,
  baseHarnessCommit: string,
  continuationHarnessCommit: string,
): value is V1IProvenanceAmendment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const amendment = value as Partial<V1IProvenanceAmendment>;
  return (
    amendment.provenanceAmendment === true &&
    amendment.amendmentType === V1I_MIXED_PROVENANCE_AMENDMENT_TYPE &&
    amendment.baseHarnessCommit === baseHarnessCommit &&
    amendment.continuationHarnessCommit === continuationHarnessCommit &&
    amendment.scientificProtocolChanged === false &&
    amendment.modelFacingBehaviorChanged === false &&
    amendment.runtimeBehaviorChanged === false
  );
}
