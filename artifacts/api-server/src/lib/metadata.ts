export type FieldEvidenceStatus =
  | "apiBacked"
  | "partial"
  | "manual"
  | "automationCandidate"
  | "notAssessed";

export type FieldConfidenceLabel = "high" | "medium" | "low" | "unknown";

export interface FieldEvidenceMetadata {
  evidenceStatus: FieldEvidenceStatus;
  confidenceLabel: FieldConfidenceLabel;
  sourceLabel?: string;
  notes?: string[];
}

export type FieldMetadataMap = Record<string, FieldEvidenceMetadata>;

export interface MetadataEnvelope<T> {
  data: T;
  fieldMetadata: FieldMetadataMap;
  metadataVersion: "1.0";
}

export function withMetadata<T>(
  data: T,
  fieldMetadata: FieldMetadataMap,
): MetadataEnvelope<T> {
  return {
    data,
    fieldMetadata,
    metadataVersion: "1.0",
  };
}
