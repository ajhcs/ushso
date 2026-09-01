import { readJson, repoPath } from "../../v1.0.0/src/common.mjs";

export {
  RELEASE_GATE_PLAN_FINGERPRINT,
  buildArtifactPins,
  loadArtifactBindings,
} from "../../v1.0.0/src/candidate-snapshot.mjs";

// The successor tests exercise only the fixture CAS implementation authorized
// at f2641a3. Reuse the already sealed v1.0.0 fixture candidate rather than
// repinning that historical package to a moving checkout.
export function buildCandidateSnapshot() {
  return readJson(repoPath("verification/wp14/v1.0.0/receipts/candidate-envelope.json"));
}
