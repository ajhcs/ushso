#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const commands = JSON.parse(process.argv[2] ?? '[]');
const outDir = path.resolve(root, process.argv[3] ?? 'verification/research-program/pr-005/evidence');

function rfc3339() {
  return new Date().toISOString();
}

function run(command) {
  return new Promise(resolve => {
    const child = spawn(command, { cwd: root, shell: true, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.on('close', exitCode => resolve({ stdout, stderr, exitCode }));
  });
}

fs.mkdirSync(outDir, { recursive: true });
const receipts = [];
for (const item of commands) {
  const startedAt = rfc3339();
  const result = await run(item.command);
  const completedAt = rfc3339();
  const stdoutPath = path.join(outDir, `${item.id}.stdout`);
  const stderrPath = path.join(outDir, `${item.id}.stderr`);
  fs.writeFileSync(stdoutPath, result.stdout);
  fs.writeFileSync(stderrPath, result.stderr);
  receipts.push({
    id: item.id,
    command: item.command,
    started_at: startedAt,
    completed_at: completedAt,
    exit_code: result.exitCode,
    completion_status: 'completed',
    stdout_path: path.relative(root, stdoutPath),
    stderr_path: path.relative(root, stderrPath)
  });
}
fs.writeFileSync(path.join(outDir, 'commands.json'), `${JSON.stringify(receipts, null, 2)}\n`);
process.exit(receipts.every(item => item.exit_code === 0) ? 0 : 1);
