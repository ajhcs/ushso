# Current source-selection API workflow

Candidate documentation for CH-049. All four example blocks were executed against the final local bundle on 2026-11-14; the earlier pre-correction observations are retained below and in the execution receipt. This is not a production deployment claim. Run examples against a locally built candidate or an explicitly selected deployed origin. The examples inspect USHSO metadata only; they do not follow publisher links, download datasets, apply for access, or execute research plans.

The inventory API is `/api/machine/v1/*`. The accepted-publication API has a different identity and rights boundary. Inventory `asset_id` values must not be assumed to be accepted-ledger aliases. HTTP success alone is insufficient: machine v1 responses can have HTTP 200 with `ok:false` and a typed error.

## curl: search, inspect, access, variables and comparison

Start the local candidate with `npm run cf:dev` after building it. The commands below require curl and Python 3, and write only under `/workspace`. Change `API_BASE` if the local port differs.

```bash
set -e
export API_BASE=http://127.0.0.1:8787
export API_OUT=/workspace/build/builderbob/ushso-api-example
mkdir -p "$API_OUT"
curl -sS -H 'Content-Type: application/json' \
  -d '{"contract_version":"observatory.machine.search-assets.input.v1.0.0","mode":"search","research_need":"hospital finances in Pennsylvania","filters":{"geography_ids":[],"subject_ids":[],"grain":[],"access_classes":[],"authority_levels":[],"machine_readiness":[],"time_period":null,"negative_constraints":[],"dimensions":[]},"grouping":"none","limit":5,"cursor":null,"expected_generation":null}' \
  "$API_BASE/api/machine/v1/search-assets" > "$API_OUT/search.json"
python3 - <<'PY'
import json, os
from urllib.parse import quote, urlencode
from pathlib import Path
out = Path(os.environ['API_OUT'])
x = json.loads((out / 'search.json').read_text())
if not x.get('ok'):
    raise SystemExit(json.dumps(x.get('error')))
rows = x['result']['summaries']
if not rows:
    raise SystemExit(x['result']['scoped_zero_statement'])
# This selects a result to inspect, not a suitable or approved source.
base = os.environ['API_BASE']
asset = quote(rows[0]['asset_id'], safe='')
pin = urlencode({'generation': x['index_generation']})
for name, suffix in [('asset',''), ('access','/access-plan'),
                     ('recipe','/retrieval-recipe'), ('variables','/variables')]:
    (out / (name + '.url')).write_text(base + '/api/machine/v1/assets/' + asset + suffix + '?' + pin)
if len(rows) >= 2:
    (out / 'compare-input.json').write_text(json.dumps({
        'contract_version':'observatory.machine.compare-assets.input.v1.0.0',
        'asset_ids':[r['asset_id'] for r in rows[:2]],
        'dimensions':['geography','time','grain','access','variables_schema'],
        'expected_generation':x['index_generation']}))
else:
    (out / 'compare-input.json').unlink(missing_ok=True)
print('Inspect result_state, warnings and each source; a ranking is not suitability evidence.')
PY
for operation in asset access recipe variables; do
  curl -sS "$(cat "$API_OUT/$operation.url")" > "$API_OUT/$operation.json"
done
if test -f "$API_OUT/compare-input.json"; then
  curl -sS -H 'Content-Type: application/json' \
    --data-binary "@$API_OUT/compare-input.json" \
    "$API_BASE/api/machine/v1/compare-assets" > "$API_OUT/compare.json"
fi
curl -sS -o "$API_OUT/publication.json" -w 'publication HTTP %{http_code}\n' \
  "$API_BASE/api/source-selection/v1/publication"
python3 - <<'PY'
import json, os
from pathlib import Path
for name in ['search','asset','access','recipe','variables','compare','publication']:
    p = Path(os.environ['API_OUT']) / (name + '.json')
    if p.exists():
        x = json.loads(p.read_text())
        print(name, json.dumps({k:x.get(k) for k in ['ok','result_state','status','reason','error']}))
PY
```

All nine structured filter fields are required, even when empty. `{}` is invalid. Search accepts a limit of 1–20. Follow `next_cursor` only with the same query/filter/grouping and `expected_generation`; keep continuation expiry and `restart_required`. A generation mismatch requires restarting the search, not silently combining records from different generations.

## Python: bounded workflow and accepted-publication branch

This standalone example uses only the standard library. It prints typed outcomes and never interprets an unresolved response as an empty, verified dictionary. It inspects at most five inventory hits and compares two; it does not exhaust the catalog.

```python
import json, os
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import quote, urlencode

BASE = os.environ.get('API_BASE', 'http://127.0.0.1:8787').rstrip('/')

def call(route, body=None):
    request = Request(BASE + route,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)

def show(name, reply):
    status, value = reply
    print(name, status, json.dumps({k: value.get(k) for k in
        ['ok', 'result_state', 'status', 'reason', 'error', 'restart_required']}))
    return value

filters = dict(geography_ids=[], subject_ids=[], grain=[], access_classes=[],
    authority_levels=[], machine_readiness=[], time_period=None,
    negative_constraints=[], dimensions=[])
query = dict(contract_version='observatory.machine.search-assets.input.v1.0.0',
    mode='search', research_need='hospital finances in Pennsylvania',
    filters=filters, grouping='none', limit=5, cursor=None, expected_generation=None)
search = show('search', call('/api/machine/v1/search-assets', query))
if not search.get('ok'):
    raise SystemExit('Search failed; retain its typed error.')
ids = [row['asset_id'] for row in search['result']['summaries']]
generation = search['index_generation']
if not ids:
    print(search['result']['scoped_zero_statement'])
else:
    route = '/api/machine/v1/assets/' + quote(ids[0], safe='')
    parameters = '?' + urlencode({'generation': generation})
    detail = show('asset', call(route + parameters))
    show('access', call(route + '/access-plan' + parameters))
    show('recipe', call(route + '/retrieval-recipe' + parameters))
    show('variables', call(route + '/variables' + parameters))
    # Inspect detail.result.releases/distributions/schemas. If verified context
    # exists, pass its release_id, distribution_id and schema_id to /variables.
    # Do not invent those IDs when collections are empty or completeness unknown.
    show('stale generation', call(route + '?' + urlencode({'generation':'not-current'})))
if len(ids) >= 2:
    show('inventory comparison', call('/api/machine/v1/compare-assets', dict(
        contract_version='observatory.machine.compare-assets.input.v1.0.0',
        asset_ids=ids[:2], dimensions=['geography','time','grain','access','variables_schema'],
        expected_generation=generation)))

publication = show('accepted publication', call('/api/source-selection/v1/publication'))
if publication.get('status') == 'available':
    accepted_ids = [view['asset_id'] for view in publication['views'][:4]]
    if accepted_ids:
        show('accepted comparison', call('/api/machine/v2/compare-assets', dict(
            contract_version='ushso.compare-assets.input.v2', asset_ids=accepted_ids,
            dimensions=['purpose','geography','grain','population','observation_period',
                        'access_routes','dictionaries','joins','limitations'],
            expected_pin=publication['pin'])))
    else:
        print('No accepted views published; do not substitute inventory IDs.')
else:
    print('Accepted comparison not attempted: publication unavailable.')
show('disabled planner', call('/api/machine/v1/plan-research', {}))
```

The accepted v2 comparison allows 1–4 unique accepted asset IDs and requires the complete `pin` returned by publication: generation, data-manifest digest, ranking version and schema version. It returns `409 generation_mismatch` for a different pin. Each dimension carries its own status, assertion IDs and evidence IDs; the `unresolved` list identifies assets with any requested dimension not `verified`. A comparison returns metadata, not source-value analysis or a proven join.

## Explicit interpretation corrections and coverage selection

`POST /api/discovery-controls/v1/search` is an additive contract. `/api/discover` and the machine v1 request schemas retain their existing shapes. Send corrections in this wrapper, not as extra properties on a legacy query:

```bash
curl -sS -H 'Content-Type: application/json' \
  -d '{"contract_version":"ushso.controlled-discovery.input.v1","query":{"question":"hospital finances Pennsylvania 2020","page_size":5},"intent_override":{"subjects":["hospital_financials"],"geographies":["US-PA"],"observation_years":{"start":2020,"end":2020}},"coverage_mode":"verified_only"}' \
  "$API_BASE/api/discovery-controls/v1/search"
```

The original question remains in `discovery.query.question` and `interpretation_provenance.original_question`. Each supplied override replaces that inferred dimension. Omit a property to retain inference; use `subjects:[]`, `geographies:[]`, or `observation_years:null` to remove its constraint. Subject IDs and geography codes must belong to the controlled vocabulary. Years must be integers from 1800 through 2200 with start no later than end. A complete correction to behavioral health in Ohio, with no year constraint, is:

```python
controlled = dict(contract_version='ushso.controlled-discovery.input.v1',
    query=dict(question='hospital finances Pennsylvania 2020', page_size=5),
    intent_override=dict(subjects=['behavioral_health'], geographies=['US-OH'],
                         observation_years=None), coverage_mode='all')
status, result = call('/api/discovery-controls/v1/search', controlled)
if status == 200:
    print(result['interpretation_provenance'])
    print(result['coverage_filter'])
    page = result['discovery']['pagination']
    if page['next_cursor']:
        # Keep the exact query, corrections and coverage mode for continuation.
        controlled['query'].update(cursor=page['next_cursor'], generation=page['generation'])
        show('controlled continuation', call('/api/discovery-controls/v1/search', controlled))
else:
    print(status, result)  # Retain typed errors and restart_required.
```

Use this Python block after the `call` and `show` functions above. The result contract is `ushso.controlled-discovery.result.v1`; `discovery` contains the usual records, result classifications, interpretation and pagination. `coverage_filter` reports `before_count`, `included_count`, `excluded_count`, `verified_count`, and `unresolved_count` across the complete matched collection after ordinary facets, before pagination. Counts are metadata coverage classifications, not source availability or rights decisions.

Coverage mode is `all` (default), `verified_only`, or `unresolved_only`. Verified selection requires first-party evidence explicitly scoped to this record and its stated geography value, compatible with every requested geography. Requested years additionally require scoped observation-period evidence and valid documented dates covering the requested years. Generic catalog evidence, text mentions, inferred geography, and a first-party label without that scope do not qualify. Unresolved selection is the complement within this matched collection; zero verified results does not prove source absence.

Changing corrections or coverage mode invalidates a continuation cursor. Restart at the first page with no cursor or generation after changing them. The route returns HTTP 409 for `invalid_cursor` or `cursor_query_mismatch`, and HTTP 410 for `generation_unavailable`, with `restart_required:true`; ordinary invalid input returns 400. Preserve response errors instead of treating them as empty results. Freshness is evaluated against the request clock.

The current Worker machine search now uses the retrieval engine's shared `rankAssets` ordering when that engine is available, then applies the inventory filters and grouping. Its ordering version is `observatory-canonical-ranking.v1.3.0`. A standalone service without that engine retains its explicitly named lexical fallback. Shared ordering does not make the machine and discovery contracts interchangeable or establish source suitability. The earlier Census-leading result below is retained as a historical observation of the pre-correction candidate; it is not the expected ranking of the corrected implementation. All four documented examples were rerun against the final local bundle; independent three-query parity is tracked separately from this documentation check.

## Final local bundle observations

At 00:35 UTC on 2026-11-14 all four blocks exited zero against local workerd port 18789. Only the origin and output-directory configuration changed; the final Python block reused the documented helper functions. Machine search reported `observatory-canonical-ranking.v1.3.0` and led with **Hospital Provider Cost Report**, followed by **Provider Relief Fund by State**. Both retain unresolved geographic coverage, access and analytical suitability. This corrects the earlier Census-leading ranking without establishing fitness for a Pennsylvania study.

Asset retrieval remained partial; access and recipe remained `route_not_documented`, variables remained `schema_context_required`, and inventory comparison completed. Accepted publication still returned 503 `current_rights_pin_required`; accepted v2 success and schema-backed variables remain unrun. The disabled planner and unmapped alias remained 404.

The strict Pennsylvania hospital-finance/2020 controls example returned HTTP 200 with 60 pre-filter matches, zero verified, 60 unresolved, and zero included. The behavioral-health/Ohio correction returned 93 matches, all unresolved; its next page returned HTTP 200 with the same counts and a distinct page. Additional continuation checks returned 409 `cursor_query_mismatch` after changing coverage mode and 410 `generation_unavailable` for a stale generation, both with `restart_required:true`. These are scoped metadata results, not source absence or permission conclusions. The local server was stopped after execution.

## Earlier observations retained for traceability

Earlier local workerd execution on 2026-11-14, before the shared-ranking correction, produced the following (retained in `api-workflow-execution.json`). These observations describe that candidate and configuration; they are not frozen expected responses for every generation.

| Operation | HTTP / result | Meaning and next action |
|---|---|---|
| Search, with all required filters | 200; `ok:true`, `partial` | Preserve warnings and evidence states. Leading results included Census school-system and state-government finances: these do **not** establish hospital-finance suitability. Investigate the source gaps and publisher evidence before making a shortlist. |
| Get first asset | 200; `ok:true`, `partial` | Releases, distributions and schemas were empty with completeness `unknown`; not evidence they do not exist. |
| Access plan and retrieval recipe | 200; `ok:false`, `unknown`, `route_not_documented` | The catalog has no supported route in this context. Consult permitted publisher documentation; do not guess eligibility or authorize acquisition. |
| Variables without schema context | 200; `ok:false`, `unknown`, `schema_context_required` | Obtain a release/distribution-bound dictionary. An empty list is not an established complete schema. |
| v1 comparison | 200; `ok:true`, `complete` | The comparison operation completed; individual facts may still be unknown or unsuitable. |
| Accepted publication | 503; `unavailable`, `current_rights_pin_required` | This configuration has no trusted current rights pin. Do not generate one from the response or package to bypass the gate. Successful accepted v2 execution remains unrun in this documentation check. |
| `/api/source-selection/v1/assets/example` | 404; `unmapped`, `accepted_legacy_alias_required` | No accepted legacy alias is established. Do not translate identities by string resemblance. |
| Planner | 404; `capability_unavailable` | Planner remains disabled; do not retry as an acquisition or analysis request. |

For malformed requests, transport may return 400/413/415; domain errors may still return HTTP 200. Check both. A `partial` or `unknown` result is never rewritten as `not_found`. Do not infer source absence from scoped zero results. Use publisher links only after separately determining the permitted action.

Contract sources: `worker/machine-toolkit-router.mjs`, `contracts/machine-toolkit/v1.0.0/schemas/`, `worker/source-selection-publication.mjs`, and the source-selection routes in `worker/index.mjs`. The new publication/v2 interface is additive and does not upgrade v1 inventory claims. Actual rights approval, successful schema-backed variable retrieval, and suitable-source task validation remain open acceptance evidence.
