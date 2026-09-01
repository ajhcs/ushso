import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root });
const files = output.toString('utf8').split('\0').filter(Boolean).sort();
const violations = [];
const forbiddenSegments = new Set(['node_modules', 'dist', '.wrangler', '.wrangler-dry-run', '.nyc_output']);
const secretPatterns = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['OpenAI-style secret', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Cloudflare token assignment', /\bCLOUDFLARE_API_TOKEN\s*=\s*[^\s#]+/]
];
let bytes = 0;

for (const relative of files) {
  const normalized = relative.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.some(segment => forbiddenSegments.has(segment))) violations.push(`${relative}: generated or dependency directory`);
  if (normalized === 'coverage' || normalized.startsWith('coverage/') || /(?:^|\/)coverage\/(?:lcov-report\/|lcov\.info$|coverage-final\.json$)/u.test(normalized)) {
    violations.push(`${relative}: generated coverage output`);
  }
  if (normalized.startsWith('apps/web/public/corpus/')) violations.push(`${relative}: staged corpus duplicate`);
  const filePath = path.join(root, relative);
  const stat = fs.statSync(filePath);
  bytes += stat.size;
  if (stat.size > 10 * 1024 * 1024) violations.push(`${relative}: file exceeds 10 MiB`);
  const content = fs.readFileSync(filePath);
  if (content.includes(0)) continue;
  const text = content.toString('utf8');
  if (/C:\\Users\\|C:\/Users\//i.test(text)) violations.push(`${relative}: local absolute path`);
  for (const [label, pattern] of secretPatterns) if (pattern.test(text)) violations.push(`${relative}: possible ${label}`);
}

if (violations.length) {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', file_count: files.length, bytes, violations }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ status: 'PASS', file_count: files.length, bytes, checks: ['ignored-artifacts', 'file-size', 'absolute-paths', 'credential-patterns'] }, null, 2)}\n`);
}
