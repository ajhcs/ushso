import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = process.cwd()
const outDir = path.join(repoRoot, 'verification/research-program/pr-086/command-receipts')
await mkdir(outDir, { recursive: true })

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function emptyHash() {
  return sha256(Buffer.alloc(0))
}

const commands = JSON.parse(process.argv[2])
const recorded = []
for (const spec of commands) {
  const started = new Date()
  const result = spawnSync(spec.argv[0], spec.argv.slice(1), {
    cwd: repoRoot,
    env: { ...process.env, ...(spec.env ?? {}) },
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
    timeout: spec.timeout_ms ?? 180_000,
  })
  const completed = new Date()
  const stdout = result.stdout ?? Buffer.alloc(0)
  const stderr = result.stderr ?? Buffer.alloc(0)
  const receipt = {
    id: spec.id,
    command: spec.command,
    argv: spec.argv,
    started_at: started.toISOString(),
    completed_at: completed.toISOString(),
    duration_ms: completed.getTime() - started.getTime(),
    exit_code: result.status,
    signal: result.signal ?? null,
    error: result.error ? { message: result.error.message, code: result.error.code ?? null } : null,
    expected_exit_code: spec.expected_exit_code,
    stdout: { bytes: stdout.length, sha256: stdout.length ? sha256(stdout) : emptyHash(), truncated: false },
    stderr: { bytes: stderr.length, sha256: stderr.length ? sha256(stderr) : emptyHash(), truncated: false },
  }
  const receiptPath = path.join(outDir, `${spec.id}.json`)
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(path.join(outDir, `${spec.id}.stdout`), stdout)
  await writeFile(path.join(outDir, `${spec.id}.stderr`), stderr)
  recorded.push({ ...receipt, receipt_path: path.relative(repoRoot, receiptPath) })
  if (result.status !== spec.expected_exit_code) {
    process.stderr.write(`${spec.id} expected ${spec.expected_exit_code} got ${result.status}\n`)
    process.exitCode = 1
  }
}
process.stdout.write(JSON.stringify(recorded, null, 2) + '\n')
