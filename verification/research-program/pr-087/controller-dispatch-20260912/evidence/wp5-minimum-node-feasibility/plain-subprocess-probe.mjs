import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const root = process.env.WP5_PLAIN_PROBE_DIR;
const records = [];
for (const [label, node] of [['node22', '/mnt/d/tmp/plumbob/ushso-implementation-plan-20260907/toolchains/node-v22.15.0-linux-x64/bin/node'], ['node24', '/home/plumbob/.nvm/versions/node/v24.14.0/bin/node']]) {
  for (const mode of ['spawn', 'spawnSync']) {
    const marker = path.join(root, `${label}-${mode}.json`);
    const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({version:process.version}));process.stdout.write('probe-json\\n');process.stderr.write('probe-stderr\\n');require('node:fs').writeSync(1,'probe-sync-stdout\\n');require('node:fs').writeSync(2,'probe-sync-stderr\\n');`;
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    let result;
    if (mode === 'spawnSync') {
      const child = spawnSync(node, ['-e', code], { env, encoding: 'utf8', timeout: 5000 });
      result = { status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr, error: child.error?.message ?? null };
    } else {
      result = await new Promise((resolve, reject) => {
        const child = spawn(node, ['-e', code], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.stdout.on('data', (x) => stdout += x);
        child.stderr.on('data', (x) => stderr += x);
        child.once('error', reject);
        child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }); });
      });
    }
    records.push({ label, mode, node, result, marker_exists: existsSync(marker), marker_value: existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : null });
  }
}
writeFileSync(path.join(root, 'observations.json'), JSON.stringify({ parent_node: process.version, parent_path: process.execPath, records }, null, 2) + '\n');
process.stdout.write(JSON.stringify(records.map(({ label, mode, result, marker_exists }) => ({ label, mode, result, marker_exists }))) + '\n');
