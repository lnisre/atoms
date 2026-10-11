import type { GenerationResult } from "../generation";
import type { InitialGeneration, ModificationGeneration } from "../execution";
import type { PreviewPolicy } from "../team/preview-policy";
import type { ProjectVersion } from "./contract";

// A proof is a server attestation, never an authentication credential. It is
// useful only with the same owner's freshly verified ordinary user identity.
export type ArtifactProof = { payload: string; signature: string };
export type Artifact = {
  v: 1; kind: "artifact"; ownerId: string; projectId: string; taskId: string;
  requirement: string; expected: ProjectVersion | null; baseHash?: string;
  result: GenerationResult; policy: PreviewPolicy;
  initialGeneration?: InitialGeneration; generations: ModificationGeneration[];
};
export type GenerationRequest = {
  projectId: string; requirement?: string; modification?: string;
  expected?: ProjectVersion; parent?: ArtifactProof;
};
export const MAX_PROOF_BYTES = 6_000_000;
