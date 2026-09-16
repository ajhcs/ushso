# USHSO catalog build modes

Baseline is the approved production default. Candidate is an explicit research preview. Ordinary builds never silently select the candidate.

## Baseline production default

- Corpus v1.2.0, 3434 records, generation live-2026-09-03-85b50522b420
- Search API path /api/discover, browse /api/catalog, details /api/datasets
- Env file apps/web/.env.production selects baseline
- Build with npm run build, which stages research assets (stage-corpus default mode stages all static corpora including candidate files) and builds the web app in production mode; baseline purity is enforced at the app layer (baseline mode queries only /api/discover and shows 0 candidate cards), not by asset exclusion
- Frozen evaluation and cohort files stay unchanged in both modes

    npm run build
    npm run cf:dry-run

## Candidate research preview

- Additive v1.3.0-candidate, 3436 rows, which is 3434 frozen baseline rows plus 2 documentation-first rows
- Search API path /api/candidate/discover, browse /api/candidate/catalog, details /api/candidate/datasets
- Two preview entries are HRSA AHRF documentation and Sheps rural closure tracking
- Both entries are documented-not-verified: access unknown, not live-verified, variables unknown, steps documented but not executed
- Env file apps/web/.env.candidate selects candidate with vite mode candidate
- Build with the explicit candidate command sequence below (no root shortcut script exists by design), which requires candidate assets and fails loudly if they are missing
- Run locally with npm run dev:candidate in apps/web, or vite with mode candidate

    USHSO_CATALOG_MODE=candidate node scripts/stage-corpus.mjs && node scripts/prepare-research-assets.mjs && npm run build:candidate --workspace @ushso/observatory-web
    npm run dev:candidate --workspace @ushso/observatory-web

Root package.json intentionally carries no candidate scripts: the sealed attestation pins the root manifest, so candidate orchestration stays explicit (commands above) plus the apps/web workspace scripts.

## Single source of truth

- apps/web/src/data/catalogMode.ts resolves VITE_CATALOG_MODE in one place and derives the API path, versions, generations, and counts
- apps/web/src/data/candidateCatalog.ts derives candidate facts from the corpus manifests and validates additive arithmetic
- Notice, search provider, landing counts, sources coverage, detail pages, agents routes, and exports all import from catalogMode
- Missing candidate assets fail loudly in stage-corpus and in the worker, never silently mixing generations
- Baseline worker routes stay byte-compatible; candidate routes live under /api/candidate only

## How promotion stays deliberate

- Production builds use .env.production baseline by default; no ordinary build selects the candidate catalog
- Promoting a candidate requires explicit review, explicit manifest promotion, explicit env promotion, and explicit release approval
- Candidate notices and detail pages keep plain language in the main journey and move generation ids and frozen-baseline arithmetic into expandable technical details
- Unknowns stay unknown: unknowns are not inferred, payload access is never claimed from catalog membership

## Verification per mode

- Baseline: search a baseline source such as HCRIS, open details and export packet, confirm AHRF and Sheps are absent, confirm counts show 3434 and baseline generation, confirm network shows only /api/discover paths
- Candidate: search HCRIS plus AHRF and Sheps, open details and export packet for each, confirm documented-not-verified framing, confirm counts show 3436 and candidate generation, confirm return-to-results keeps scroll and focus, confirm network shows only /api/candidate paths
- Run web, worker, and build suites via with-dev-storage; never weaken assertions to make a mode pass
