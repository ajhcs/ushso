import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const baselineUrl = new URL(
  '../verification/competition/webmcp-challenge-2026/baseline.json',
  import.meta.url,
)
const baseline = JSON.parse(await readFile(baselineUrl, 'utf8'))
const origin = baseline.production.urls[0]
const checks = []
const observed = {}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function check(name, passed, detail) {
  checks.push({ name, passed, detail })
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, origin), {
    ...init,
    headers: {
      'user-agent': 'ushso-webmcp-competition-monitor/1.0',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    status: response.status,
    bytes,
    sha256: sha256(bytes),
    text: bytes.toString('utf8'),
  }
}

for (const artifact of baseline.live_http_artifacts) {
  try {
    const result = await request(artifact.path)
    observed[artifact.path] = {
      status: result.status,
      bytes: result.bytes.length,
      sha256: result.sha256,
    }
    check(`${artifact.path}:status`, result.status === 200, result.status)
    check(`${artifact.path}:bytes`, result.bytes.length === artifact.bytes, {
      expected: artifact.bytes,
      actual: result.bytes.length,
    })
    check(`${artifact.path}:sha256`, result.sha256 === artifact.sha256, {
      expected: artifact.sha256,
      actual: result.sha256,
    })

    if (artifact.path === '/api/health') {
      const health = JSON.parse(result.text)
      check('/api/health:semantic', health.status === 'ok', health.status)
    }
    if (artifact.path === '/api/contract') {
      const contract = JSON.parse(result.text)
      check(
        '/api/contract:tool',
        contract.tool?.name === 'observatory.discover_sources',
        contract.tool?.name ?? null,
      )
      check(
        '/api/contract:version',
        contract.contract_version === 'observatory-webmcp-tool.v1.0.0',
        contract.contract_version ?? null,
      )
    }
  } catch (error) {
    check(`${artifact.path}:request`, false, error instanceof Error ? error.message : String(error))
  }
}

try {
  const canonical = baseline.canonical_query
  const result = await request(canonical.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(canonical.request),
  })
  const body = JSON.parse(result.text)
  const leadingIds = body.results
    .slice(0, canonical.required_leading_record_ids.length)
    .map((entry) => entry.record_id)
  observed.canonical_query = {
    status: result.status,
    bytes: result.bytes.length,
    sha256: result.sha256,
    returned_count: body.returned_count,
    join_route_count: body.join_routes?.length ?? null,
    leading_record_ids: leadingIds,
  }
  check('canonical-query:status', result.status === 200, result.status)
  check('canonical-query:sha256', result.sha256 === canonical.response_sha256, {
    expected: canonical.response_sha256,
    actual: result.sha256,
  })
  check('canonical-query:bytes', result.bytes.length === canonical.response_bytes, {
    expected: canonical.response_bytes,
    actual: result.bytes.length,
  })
  check(
    'canonical-query:contract',
    body.contract_version === canonical.contract_version,
    body.contract_version ?? null,
  )
  check(
    'canonical-query:returned-count',
    body.returned_count === canonical.returned_count,
    body.returned_count ?? null,
  )
  check(
    'canonical-query:join-routes',
    body.join_routes?.length === canonical.join_route_count,
    body.join_routes?.length ?? null,
  )
  check(
    'canonical-query:leading-records',
    JSON.stringify(leadingIds) === JSON.stringify(canonical.required_leading_record_ids),
    leadingIds,
  )
} catch (error) {
  check('canonical-query:request', false, error instanceof Error ? error.message : String(error))
}

const failures = checks.filter((entry) => !entry.passed)
const receipt = {
  schema: 'ushso.webmcp-competition-monitor-receipt.v1',
  checked_at: new Date().toISOString(),
  baseline_recorded_at: baseline.recorded_at,
  judged_origin: origin,
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  native_webmcp_host_status: baseline.verification.native_webmcp_host.status,
  note: 'HTTP/API parity does not satisfy the separate native WebMCP host discovery-and-invocation gate.',
  checks,
  failures,
  observed,
}

console.log(JSON.stringify(receipt, null, 2))
process.exitCode = failures.length === 0 ? 0 : 1
