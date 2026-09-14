# USHSO UI/UX review

Review date: 30 August 2026  
Reviewed surfaces: live site at `https://ushso.org` and `https://www.ushso.org`, `POST /api/discover`, `GET /api/health`, `GET /api/contract`, and the `apps/web` + `worker` source.

This is a review of the current production website for **human** researchers and **software agents**. It does not change product behavior. Each finding includes a concrete fix.

## Method

- Walked every declared route in `apps/web/src/App.tsx`.
- Read the search, details, header/footer, facet, and provider code.
- Probed production HTTP behavior (status codes, headers, robots, sitemap, favicon, CORS, HEAD vs GET).
- Ran representative discovery queries against the live API.
- Walked the live site on desktop and a 375–414px phone: landing, suggestions, results (sort, group, facets, pagination), details, empty state, 404, and every stub page, plus the mobile menu and filter drawer.

## Visual walk, reconciled with source

The browser walk confirmed the core journey works: search suggestions and arrow keys, sort/group without reload, details sections, hamburger and filter drawer, and no horizontal scroll on a phone.

It also confirmed several code findings and corrected two easy misreads:

| Observation in the browser | What the source / HTTP actually show |
| --- | --- |
| Landing footer has no About / Privacy / Terms / Contact | True. Those links render only when `ObservatoryFooter` is passed `results` (search and successful details). `/about`, `/sources`, `/agents`, and other stubs use the same slim footer as home. |
| “Refine results” on a phone shows a badge **1** with no obvious user filter | That badge is the silent `geography:pennsylvania` filter after a PA-interpreted question (finding 2). |
| `/datasets/cms-hcris-hospital-cost-reports` loads without `?q=` | Coincidence. Missing `q` falls back to the Pennsylvania finance demo query, which includes HCRIS. A record that is not in that result set still 404s (finding 4). |
| Empty state copy looks fine | The visible string is always “No returned results match these filters,” including genuine corpus zeros. The API warning is still hidden (finding 1). |
| `/agents` “has an example” | It names `POST /api/discover` only. There is no request body, response, auth, or CORS note. Do **not** document “CORS enabled for all origins”: `OPTIONS` is 405 and there is no `Access-Control-Allow-Origin`. |
| Body text “looks ≥14px” | Result cards, facets, footnotes, and pager are **9.2–11px** in CSS. Comfortable-looking navy-on-white still fails readable-size guidance. |
| Non-PA query “Medicare hospital quality” does not check Pennsylvania | Correct. Auto-filter runs only when interpretation includes `US-PA`. |

## What works

The product already has a clear job: route people and machines to authoritative sources without pretending to warehouse the data.

- Landing search is the primary action, with a skip link, labeled combobox, and visible focus rings.
- Search state lives in the URL (`q`, `group`, `sort`, `page`, `filter`), which is the right model for shareable results.
- Result cards expose access path, coverage, and “why it matched” instead of a title-only list.
- Details pages preserve canonical provenance fields from the same discovery contract used by the API.
- Mobile breakpoints exist for header, facets (drawer), result cards, and details.
- Same-origin `POST /api/discover` returns a strict, versioned contract. Zero-result queries return an honest warning: *“This is not evidence that no source exists.”*
- Security headers on HTML responses are strong (CSP, frame deny, nosniff, permissions policy).

The issues below are about **trust, completeness, and whether a person or agent can finish the job** the homepage promises.

---

## Severity key

| Level | Meaning |
| --- | --- |
| **P0** | Blocks the core task, misleads about results, or breaks machine clients |
| **P1** | Everyday usability / accessibility / agent onboarding failure |
| **P2** | Polish, consistency, or incomplete content |
| **P3** | Nice-to-have |

Who: **H** = human visitor, **A** = software agent / crawler / MCP client.

---

## P0 — Fix first

### 1. Zero-result and loading states lie

**Who:** H  
**Where:** `/search`, `SearchResultsPage.tsx`

While discovery is in flight, the page always renders **“0 dataset families · 0 records · 0 sources”**. After a genuine zero-result query (for example `Pennsylvania flibbertigibbet qzxwvu`), the UI says **“No returned results match these filters”** and offers **Clear filters**, even when no filter caused the empty set.

The live API already returns the correct warning: *“No published offline record matched. This is not evidence that no source exists.”* The UI never renders `result.warnings`, `query.interpretation`, or corpus bounds.

**Fix**

- Gate counts on `discovery.status === 'ready'` (show “Searching…” or placeholders).
- Split empty states:
  - engine `result_count === 0` → scoped zero-result copy + “Revise search”, and print `warnings`.
  - filtered-to-empty → “No returned results match these filters” + Clear filters.
- Add an interpretation chip row: *“Understood as: Pennsylvania · hospital · financial.”*
- Surface the corpus footer as a first-class note: *“143 indexed records, published offline evidence, not a web search.”*

### 2. Pennsylvania is silently applied as a facet

**Who:** H  
**Where:** `SearchResultsPage.tsx` (effect on ready discovery)

If the compiler tags `US-PA`, the page writes `filter=geography:pennsylvania` without asking. Combined with `geographyFacets()` treating national (`US`) records as Pennsylvania-applicable, the facet looks like a user choice but is an implicit rewrite.

A visitor who searches “hospital financial and utilization data for Pennsylvania” cannot tell whether they are seeing engine rank or a post-hoc UI filter. Clearing filters is possible, but the URL mutates after first paint.

**Fix**

- Stop auto-writing the geography facet. Show interpretation chips instead.
- If a default filter is required for the demo, apply it only when `q` is absent and label it *“Showing Pennsylvania-applicable sources (from your question).”* with an undo control.
- Do not map national records onto a “Pennsylvania” checkbox without also labeling them “National (includes PA).”

### 3. `/search` and “Explore Data” invent a query

**Who:** H, A  
**Where:** `readSearchState()` default `q`; header `Link to="/search"`; StandardPage CTA

Visiting `/search` with no `q` substitutes  
`hospital financial and utilization data for Pennsylvania`.  
“Explore Data”, 404 “Explore data”, and every stub page CTA do the same. Agents and humans who open `/search` cannot browse the catalog; they inherit a demo question.

**Fix**

- Empty `/search` should be a browse/empty-prompt state, not a hidden demo query.
- Keep the demo as **example chips** on the landing page and empty search page.
- Change header “Explore Data” to `/` (focus the search box) or `/search` with no default `q`.

### 4. Dataset pages are not addressable without the original question

**Who:** H, A  
**Where:** `DatasetDetailsPage.tsx`, `catalogAdapter.ts` `detailsUrl`

Details URLs look like `/datasets/{id}?q=...`. The page re-runs discovery for `q` (or `DEMO_QUERY` if `q` is missing) and 404s the record if it was not in that result set. Opening CMS HCRIS without `q` appears to work only because that asset is in the demo response. A shared or bookmarked asset URL is otherwise unstable. Agents cannot fetch an arbitrary record by id.

**Fix**

- Resolve `/datasets/:id` from the corpus/record index, not from the last search.
- Keep `q` only as optional “why it matched” context.
- Add `GET /api/records/:id` (or include the record in a static catalog) so agents can dereference `obs:asset:…` without re-asking a question.

### 5. SPA fallback breaks machine-readable well-known files

**Who:** A, H (SEO / sharing)  
**Where:** `wrangler.jsonc` `not_found_handling: single-page-application`; missing static files

Live checks on 30 August 2026:

| URL | Expected | Actual |
| --- | --- | --- |
| `/llms.txt` | text for agents | HTML 200, then in-app “Page not found” |
| `/sitemap.xml` | sitemap | HTML 200 (SPA shell) |
| `/favicon.ico` | icon | HTML 200 (`content-type: text/html`) |
| `/apple-touch-icon.png` | icon | HTML 200 |
| `/this-page-does-not-exist` | HTTP 404 | HTML 200 |
| `/robots.txt` | robots only | Cloudflare managed robots **plus appended SPA HTML** |

`robots.txt` also disallows major AI crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`, …) while `/agents` invites machines. Content-Signal is `ai-train=no, use=reference`, which is reasonable, but the HTML trailer and missing `llms.txt` make the site look closed to agents.

Unknown HTML routes must not return 200 if the product wants honest 404s for humans *and* crawlers.

**Fix**

- Add real static files: `public/robots.txt`, `public/llms.txt`, `public/sitemap.xml`, `public/favicon.ico`.
- Serve them from the Worker **before** the SPA fallback (`run_worker_first` or dedicated assets).
- Return HTTP 404 (and `noindex`) for unknown document routes; keep SPA fallback only for known app paths (`/search`, `/datasets/:id`, `/about`, …).
- Decide crawler policy explicitly: if agents are a first-class audience, allow fetch-for-reference crawlers and document the distinction from training.

### 6. Agent API is undocumented and same-origin only

**Who:** A  
**Where:** `/agents`, `worker/index.mjs`

`/agents` is two paragraphs and one status note. It does not include:

- example `curl` for `POST /api/discover`
- request/response examples or links to `/api/contract` and the JSON Schemas
- auth (none) and size limit (20 KiB)
- that the API is **same-origin**: `OPTIONS` is 405, no `Access-Control-Allow-Origin`
- that `HEAD /api/health` and `HEAD /api/contract` return **405** (uptime checks that use HEAD fail)
- that WebMCP registers only when `document.modelContext` exists (most agents will never see it)

A browser agent on another origin cannot call the API. A server-side agent can, but only if it already knows the contract.

**Fix**

- Expand `/agents` into a real interface page: purpose, limits, `curl`, example JSON, links to `/api/health`, `/api/contract`, and the schemas.
- Publish `/llms.txt` pointing at those URLs.
- Allow `HEAD` on read endpoints (treat HEAD like GET without a body).
- Either document “same-origin only; call from your server” or add a tight CORS allowlist plus `OPTIONS`.
- Consider `GET /api/discover?question=` for bookmarkable, read-only agent calls (still bounded).

---

## P1 — Everyday usability and accessibility

### 7. Result cards are below readable size

**Who:** H  
**Where:** `styles.css` results/facet rules

Production CSS uses **9.2px–11px** for card metadata, access copy, footnotes, facet options, and pagination. Contrast on primary navy text is fine (~14:1), but disabled facet labels `#7185a1` on white are **3.77:1** (fails WCAG AA 4.5:1).

Four cards per page (`PAGE_SIZE = 4`) plus this density forces pagination instead of scanning.

**Fix**

- Floor UI text at 14px (16px body). Raise card metadata to 13–14px.
- Increase `PAGE_SIZE` to 8–10, or use a compact/comfortable density toggle.
- Darken disabled facet text or mark disabled options as “0 — none in these results” with sufficient contrast.
- Paginate with ellipses; do not render every page button. Add “Page X of Y” or “1–10 of N” (the live pager lists numbered buttons only).

### 8. Copy overpromises “public health data” and “open the data”

**Who:** H  
**Where:** landing hero, How it works, footer mission

The hero says *“Find the public health data that answers your question.”*  
The product is a **health-systems** discovery layer (hospital finance, HCRIS, PHC4, access recipes). “Public health” reads as surveillance/epidemiology.

How it works step 3 is titled **“Open the data.”** Many routes are application, payment, or DUA. The footer mission says *“discover, understand, and access.”*

**Fix**

- Hero: *“Find the health-systems data that can answer your question.”*
- Step 3: *“See how to get it”* / *“Review access rules at the source.”*
- Mission: *“discover and route to”* rather than *“access.”*
- Keep the existing honesty footnote; move a shorter version above the fold on results.

### 9. Legal and agent entry points are missing from the default chrome

**Who:** H, A  
**Where:** `ObservatoryHeader.tsx`, `ObservatoryFooter.tsx`

| Control | Landing / About / Agents | Results / Details |
| --- | --- | --- |
| About, Privacy, Terms, Contact | absent | footer callout only |
| Agents | absent | icon-only in results footer |
| Data sources | header | icon in results footer |
| How it Works | header → `/#how-it-works` | header |

A first-time visitor on `/` cannot reach Privacy, Terms, Contact, or Agents without running a search. `/agents` is not in the primary nav.

`Link to="/#how-it-works"` from `/about` is an SPA hash navigation. There is no `location.hash` scroll effect; the How it works block may never come into view after client render.

**Fix**

- One footer on every page: About, Privacy, Terms, Contact, Agents, Sources.
- Put Agents in the primary nav (or a “For developers” item).
- On home mount, if `hash === '#how-it-works'`, `scrollIntoView`.
- Add `aria-current="page"` on the active nav item.

### 10. Supporting pages are stubs; `/sources` lists no sources

**Who:** H, A  
**Where:** `StandardPage.tsx`, `AgentsPage.tsx`

`/about`, `/privacy`, `/terms`, `/contact`, and `/sources` are a title, one sentence, and “Explore data.” Contact mentions `ajhcs/ushso` and a security path **as plain text**, not links. `/sources` claims the Observatory routes to authoritative sources but does not name any of the 36 source identities.

**Fix**

- `/sources`: list indexed sources (name, home URL, record count, access posture) from the corpus.
- `/about`: what USHSO is / is not, corpus size, no-LLM / no-live-crawl, link to architecture.
- `/contact`: real `<a href="https://github.com/ajhcs/ushso">` and a concrete security contact.
- `/privacy` and `/terms`: keep them short, but link Cloudflare’s privacy notice and state that source licenses still apply (already sketched).
- 404: Home + Search, not only “Explore data.”

### 11. Search suggestions ignore the query and do not dismiss

**Who:** H  
**Where:** `SearchBox.tsx`, `getSuggestions()`

Any non-empty input shows the same five demo strings. There is no `onBlur` / outside-click handler, so the list can stay open. Opening suggestions also triggers a large layout jump (`:has(.search-suggestions)` changes hero height, pushes dimensions 263px, and shrinks How it works to 191px).

**Fix**

- Filter or rank suggestions; if the query does not match, hide the list or show “Search for ‘…’”.
- Close on blur, Escape (already), and outside click.
- Overlay the list (`position: absolute`) without resizing the page.
- Keep How it works at its natural height.

### 12. “I need …” prefix and “Edit search” mislabel the results query

**Who:** H  
**Where:** `presentQuery` / `normalizeEditedQuery`

The results field rewrites `hospital financial…` to **`I need hospital financial…`**. The submit button is labeled **Edit search** with a pencil, which reads as “enter edit mode,” not “run this query.”

**Fix**

- Show the actual `q`. Do not add a conversational prefix.
- Button label: **Search** or **Update results**.
- Keep “I need” only as an optional example on the landing placeholder.

### 13. Dialogs and menus are not complete

**Who:** H (keyboard, mobile)  
**Where:** mobile nav, filter overlay

The filter drawer is `role="dialog"` `aria-modal` but has no focus trap, no initial focus, and no Escape handler (overlay click works). The hamburger menu has no trap, no Escape, and no backdrop. Info icons next to facets and grouping have no tooltip for sighted users; one `aria-label` sits on a non-focusable SVG.

**Fix**

- Focus trap + Escape + restore focus for the filter dialog.
- Escape / click-outside / `aria-expanded` already exist for the menu; add a backdrop and move focus into the nav when opened.
- Turn Info icons into buttons with a short popover, or drop them and keep the helper sentence.

### 14. Details drop most of the contract the API already has

**Who:** H, A  
**Where:** `DatasetDetailsPage.tsx`, `accessOptions()` (first two retrieval steps only)

The details page shows a short dl and a provenance teaser. It does not list:

- remaining retrieval steps
- typed restrictions / `requires_human`
- provenance objects
- join routes (only a count)
- evidence items
- full access requirements on the **card** (cards hide `requirements`)

Family grouping keeps only the first record per `family_id`. Users cannot see siblings without turning grouping off, and the card does not say “3 records in this family.”

**Fix**

- Render the full instruction list, restrictions, and join routes (with compatibility state).
- On family cards: “Family · 3 records” linking to grouped siblings or `group=record`.
- Show requirements on the card when status is not `none`.
- Mark external links with “Opens in a new tab.”

### 15. No document titles, social tags, or favicon

**Who:** H, A  
**Where:** `index.html`

Every route shares `United States Health Systems Observatory`. There is no per-page `<title>`, no canonical, no Open Graph / Twitter tags, no JSON-LD, and no favicon (see P0).

**Fix**

- Set `document.title` per route: `Search · …`, `{Dataset title} · USHSO`, `About · USHSO`.
- Add `og:title`, `og:description`, `og:image` (lighthouse), canonical apex URL.
- Add a real favicon and apple-touch icon.
- Optional: JSON-LD `Dataset` / `SearchAction` on details and home for agents that read HTML.

---

## P2 — Consistency and completeness

### 16. Duplicate metadata and placeholder facets

Reporting unit and population/facility scope are filled from the same `unit_of_analysis` list (`catalogAdapter.ts`). Years, variables/codebook, and record-type facets are collapsed placeholders: *“will be connected … in a later phase.”* That is honest, but it looks unfinished on a live `.org`.

**Fix:** Deduplicate the two rows. Hide empty facet groups until they have options. If a phase is later, do not ship the empty chrome.

### 17. National vs Pennsylvania facet logic

`geographyFacets()` adds `pennsylvania` to every record with jurisdiction `US`. A “Pennsylvania” checkbox then includes national series. That can be correct (“applicable to PA”) but the label does not say so. “Other states” is a single bucket.

**Fix:** Options like “Pennsylvania-only”, “National (includes PA)”, “Other state-specific.” Drive them from `coverage_level` + jurisdictions, not string includes.

### 18. `www` does not canonicalize to apex

`https://www.ushso.org/` returns 200 with the same HTML as apex (no `Location`). Duplicate index for humans and agents.

**Fix:** 301 `www` → `https://ushso.org` (and vice versa if you prefer www).

### 19. Header “Explore Data” vs landing “search first”

The information architecture is search-first, but the first nav item is Explore Data (a canned search). Discovery dimensions look clickable and are not.

**Fix:** Make dimensions example queries, or demote them to a caption. Put Search / Home first in the nav.

### 20. Pagination and sort edge cases

- Pagination renders even for one page.
- “Newest release” sorts the display string (`2022 (Verified)`), which is brittle.
- Rank numbers restart per page correctly, but with 4 items the list feels like a carousel.

**Fix:** Hide pager when `pageCount === 1`. Sort on `data_through` / a parsed date. Raise page size (see P1). Show “Page X of Y” next to the numbered buttons.

### 21. Logo image is not in the obvious public listing during some checkouts

Production serves `/observatory-lighthouse.png`. The file is tracked as `apps/web/public/observatory-lighthouse.png`. Confirm CI `npm run build` copies it; a missing logo on a clean build would silently break identity.

**Fix:** Add a build assertion that the PNG (and future favicon) exist in `dist`.

---

## P3 — Enhancements

- Keyboard `/` to focus search.
- Copy permalink / citation on details (record id + authoritative URL).
- Highlight matched terms in titles.
- `prefers-reduced-motion` is already honored; keep it when adding traps/overlays.
- A small “corpus version” stamp in the footer for agents that only scrape HTML.
- GET-able discovery URLs for the API (see P0).
- Shorten the landing placeholder on narrow widths (“What data do you need?”) so it does not clip.

---

## Recommended implementation order

1. **Honesty on results** — loading counts, zero-result copy, warnings, interpretation chips; remove silent PA filter and default `/search` query.
2. **Machine surface** — real `robots.txt` / `llms.txt` / sitemap / favicon; HTTP 404 for unknown paths; HEAD on health/contract; rewrite `/agents`.
3. **Addressable records** — details by id; optional `GET /api/records/:id`.
4. **Readable results** — type scale, page size, external-link names, family counts.
5. **Global chrome** — one footer, Agents in nav, hash scroll, per-page titles.
6. **Content** — sources index, About, linked Contact, rewrite hero/How-it-works verbs.

None of these require changing the retrieval engine. Items 1–3 are UI/Worker only and align the website with the contract the API already returns.

---

## Route inventory (as shipped)

| Path | Role | Review note |
| --- | --- | --- |
| `/` | Landing search | Strong primary action; copy and suggestion layout issues |
| `/search` | Results | Core product; P0 empty/filter/default-query issues |
| `/datasets/:id` | Details | Coupled to `q`; incomplete contract rendering |
| `/agents` | Machine docs | Not enough to use the API |
| `/sources` | Sources | No source list |
| `/about` `/privacy` `/terms` `/contact` | Policy | One sentence each; missing from default footer |
| `*` | 404 | HTTP 200; CTA is canned search |
| `POST /api/discover` | Agent API | Works same-origin; undocumented on `/agents` |
| `GET /api/health` | Readiness | GET 200; HEAD 405 |
| `GET /api/contract` | WebMCP descriptor | GET 200; HEAD 405; not linked from `/agents` |

---

## Suggested acceptance checks after fixes

- `/search` with no `q` does not run the Pennsylvania demo.
- Nonsense query shows the API zero-result warning, not “clear filters.”
- Any `/datasets/:id` in the corpus works without `?q=` (not only records that appear in the Pennsylvania demo).
- `curl -I https://ushso.org/api/health` → 200.
- `curl -s https://ushso.org/llms.txt` is text, not HTML.
- `curl -sI https://ushso.org/not-a-page` → 404.
- Landing, results, and details footers all include Privacy and Agents.
- Result metadata is ≥ 14px; disabled facets ≥ 4.5:1.
- `/agents` includes a copy-paste `curl` that returns `observatory-discovery-result.v1.0.0`.
