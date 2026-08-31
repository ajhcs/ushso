import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PROJECT_ROOT,
  canonicalJson,
  selectedFileReceipt,
  sha256Bytes,
  treeReceipt
} from './common.mjs';

const COMMAND_TIMEOUT_MS = 240_000;

function parseNodeTestCount(output) {
  const counts = [];
  for (const match of output.matchAll(/(?:^|\n)(?:#\s*)?(?:ℹ\s*)?tests\s+(\d+)\s*(?:\n|$)/g)) counts.push(Number(match[1]));
  return counts.length === 0 ? null : counts.at(-1);
}

async function runProcess(command, args, options) {
  const stdoutPath = path.join(options.captureDirectory, `${options.capturePrefix}.stdout.log`);
  const stderrPath = path.join(options.captureDirectory, `${options.capturePrefix}.stderr.log`);
  const [stdoutHandle, stderrHandle] = await Promise.all([
    fs.open(stdoutPath, 'w'),
    fs.open(stderrPath, 'w')
  ]);
  const processResult = await new Promise(resolve => {
    const started = performance.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', stdoutHandle.fd, stderrHandle.fd]
    });
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, COMMAND_TIMEOUT_MS);
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: null, signal: null, timedOut, spawnError: String(error), durationMs: Math.round(performance.now() - started) });
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode,
        signal,
        timedOut,
        spawnError: null,
        durationMs: Math.round(performance.now() - started)
      });
    });
  });
  await Promise.all([stdoutHandle.close(), stderrHandle.close()]);
  const [out, capturedError] = await Promise.all([fs.readFile(stdoutPath), fs.readFile(stderrPath)]);
  const err = processResult.spawnError
    ? Buffer.concat([capturedError, Buffer.from(processResult.spawnError, 'utf8')])
    : capturedError;
  return { ...processResult, out, err };
}

function mirrorFilter(source) {
  const relative = path.relative(PROJECT_ROOT, source);
  if (relative === '') return true;
  const parts = relative.split(path.sep);
  if (parts.includes('.git') || parts.includes('node_modules')) return false;
  if (parts.some(part => part === '.next' || part === '.wrangler' || part === '.wrangler-dry-run')) return false;
  return true;
}

async function makeMirror() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ushso-wp2-verifier-'));
  const mirror = path.join(temporaryRoot, 'repository');
  await fs.cp(PROJECT_ROOT, mirror, { recursive: true, dereference: false, filter: mirrorFilter });
  await fs.symlink(path.join(PROJECT_ROOT, 'node_modules'), path.join(mirror, 'node_modules'), 'dir');
  return { mirror, temporaryRoot };
}

function commandReceipt(packageDefinition, script, processResult, sealedBefore, sealedAfter) {
  const combined = Buffer.concat([processResult.out, Buffer.from('\n'), processResult.err]).toString('utf8');
  const sealedArtifactsUnchanged = sealedBefore === sealedAfter;
  return {
    script,
    command: script === 'test'
      ? `npm test --prefix ${packageDefinition.path}`
      : `npm run validate --prefix ${packageDefinition.path}`,
    exit_code: processResult.exitCode,
    signal: processResult.signal,
    timed_out: processResult.timedOut,
    duration_ms: processResult.durationMs,
    stdout_bytes: processResult.out.length,
    stdout_sha256: sha256Bytes(processResult.out),
    stderr_bytes: processResult.err.length,
    stderr_sha256: sha256Bytes(processResult.err),
    node_test_count: script === 'test' ? parseNodeTestCount(combined) : null,
    sealed_artifacts_before_sha256: sealedBefore,
    sealed_artifacts_after_sha256: sealedAfter,
    sealed_artifacts_unchanged: sealedArtifactsUnchanged,
    passed: processResult.exitCode === 0
      && !processResult.timedOut
      && sealedArtifactsUnchanged
      && (script !== 'test' || (parseNodeTestCount(combined) ?? 0) > 0)
  };
}

async function sealedArtifactState(mirrorPackage, packageDefinition) {
  const artifacts = [];
  for (const relative of [packageDefinition.manifest_path, packageDefinition.receipt_path]) {
    const absolute = path.join(mirrorPackage, relative);
    const [bytes, stat] = await Promise.all([
      fs.readFile(absolute),
      fs.stat(absolute, { bigint: true })
    ]);
    artifacts.push({
      path: relative,
      bytes: bytes.length,
      sha256: sha256Bytes(bytes),
      mtime_ns: stat.mtimeNs.toString(),
      ctime_ns: stat.ctimeNs.toString()
    });
  }
  return sha256Bytes(Buffer.from(canonicalJson(artifacts), 'utf8'));
}

export async function runPublicCommands(registry) {
  const errors = [];
  const sourceBefore = new Map();
  const receiptsBefore = new Map();
  for (const packageDefinition of registry.packages) {
    const root = path.join(PROJECT_ROOT, packageDefinition.path);
    sourceBefore.set(packageDefinition.package_id, await treeReceipt(root));
    receiptsBefore.set(packageDefinition.package_id, await selectedFileReceipt(root, relative => /(^|\/)(?:validation|receipts)\/.*\.json$/.test(relative)));
  }

  const { mirror, temporaryRoot } = await makeMirror();
  const commandResults = new Map();
  const mirrorSealedBefore = new Map();
  const mirrorSealedAfter = new Map();
  try {
    for (const packageDefinition of registry.packages) {
      mirrorSealedBefore.set(
        packageDefinition.package_id,
        await sealedArtifactState(path.join(mirror, packageDefinition.path), packageDefinition)
      );
    }
    const environment = {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      TZ: 'UTC',
      npm_config_update_notifier: 'false',
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    };
    for (const packageDefinition of registry.packages) {
      const packageResults = [];
      const mirrorPackage = path.join(mirror, packageDefinition.path);
      for (const script of ['test', 'validate']) {
        const sealedBefore = await sealedArtifactState(mirrorPackage, packageDefinition);
        const args = script === 'test'
          ? ['test', '--prefix', mirrorPackage]
          : ['run', 'validate', '--prefix', mirrorPackage];
        const result = await runProcess('npm', args, {
          cwd: mirror,
          env: environment,
          captureDirectory: temporaryRoot,
          capturePrefix: `${packageDefinition.package_id}-${script}`
        });
        const sealedAfter = await sealedArtifactState(mirrorPackage, packageDefinition);
        const receipt = commandReceipt(packageDefinition, script, result, sealedBefore, sealedAfter);
        packageResults.push(receipt);
        if (!receipt.passed) errors.push(`PUBLIC_COMMAND_FAILED:${packageDefinition.package_id}:${script}:exit=${receipt.exit_code}:tests=${receipt.node_test_count}`);
        if (!receipt.sealed_artifacts_unchanged) errors.push(`SEALED_ARTIFACT_MUTATED_BY_PUBLIC_COMMAND:${packageDefinition.package_id}:${script}`);
      }
      commandResults.set(packageDefinition.package_id, packageResults);
    }
    for (const packageDefinition of registry.packages) {
      const after = await sealedArtifactState(path.join(mirror, packageDefinition.path), packageDefinition);
      mirrorSealedAfter.set(packageDefinition.package_id, after);
      if (mirrorSealedBefore.get(packageDefinition.package_id) !== after) {
        errors.push(`MIRROR_GLOBAL_SEALED_ARTIFACT_MUTATION:${packageDefinition.package_id}`);
      }
    }
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  const sourceIntegrity = new Map();
  for (const packageDefinition of registry.packages) {
    const root = path.join(PROJECT_ROOT, packageDefinition.path);
    const after = await treeReceipt(root);
    const receiptAfter = await selectedFileReceipt(root, relative => /(^|\/)(?:validation|receipts)\/.*\.json$/.test(relative));
    const treeUnchanged = sourceBefore.get(packageDefinition.package_id).tree_sha256 === after.tree_sha256;
    const receiptsUnchanged = receiptsBefore.get(packageDefinition.package_id).tree_sha256 === receiptAfter.tree_sha256;
    if (!treeUnchanged) errors.push(`SOURCE_PACKAGE_MUTATED_DURING_COMMANDS:${packageDefinition.package_id}`);
    if (!receiptsUnchanged) errors.push(`SOURCE_RECEIPT_MUTATED_DURING_COMMANDS:${packageDefinition.package_id}`);
    sourceIntegrity.set(packageDefinition.package_id, {
      tree_sha256_before: sourceBefore.get(packageDefinition.package_id).tree_sha256,
      tree_sha256_after: after.tree_sha256,
      tree_unchanged: treeUnchanged,
      receipt_tree_sha256_before: receiptsBefore.get(packageDefinition.package_id).tree_sha256,
      receipt_tree_sha256_after: receiptAfter.tree_sha256,
      receipts_unchanged: receiptsUnchanged
    });
  }
  return {
    commandResults,
    sourceIntegrity,
    mirrorSealedArtifactsGloballyUnchanged: registry.packages.every(packageDefinition =>
      mirrorSealedBefore.get(packageDefinition.package_id) === mirrorSealedAfter.get(packageDefinition.package_id)),
    errors
  };
}
