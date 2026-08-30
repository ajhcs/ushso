# Observatory Retrieval v1.0.1

This immutable offline successor converts evidence-backed asset records into non-authoritative search documents, compiles questions with a deterministic controlled vocabulary, ranks candidate assets, preserves access and provenance, and returns explicit join-route objects through one discovery-result contract shared by the browser and agent surfaces.

The successor fixes the v1.0.0 validation failure in which an inferred geography name could count as the only lexical relevance signal. In v1.0.1, geography aliases are removed from lexical evidence; geography-only retrieval is permitted only through an explicit structured geography filter. A zero-result response remains explicitly non-evidence of corpus-wide absence.

## Offline fixture workflow

```bash
npm install --ignore-scripts
npm test
npm run build:fixture
npm run validate
npm run example
```

No command performs network discovery, payload acquisition, coverage execution, identity resolution, or deployment. Generated corpus outputs are immutable: changed inputs or code require another versioned successor.
