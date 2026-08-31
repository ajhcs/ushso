// Explicit emergency-static entry point. It has the same static ASSETS-only
// composition as the default WP1 Worker and deliberately imports no database,
// connector, queue, workflow, or source-network adapter.
import { createWorker, loadCatalogFromAssets, loadEngineFromAssets } from './index.mjs';

export default createWorker({
  loadCatalog: loadCatalogFromAssets,
  loadEngine: loadEngineFromAssets
});
