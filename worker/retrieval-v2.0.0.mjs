// Production-shaped wrapper for the separately versioned v2 development and
// validation ranker. Public promotion remains gated by WP8 quality and holdout
// authorization; worker/index.mjs intentionally continues to pin v1 today.
export { createRetrievalV2Engine as createRetrievalEngine, RETRIEVAL_V2_VERSION } from '../packages/retrieval/tools/retrieval-v2.mjs';
