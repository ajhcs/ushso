import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const args = process.argv.slice(2);
let preparedBuild = null;
if (['dev','deploy'].includes(args[0])&&!args.includes('--help')&&!args.includes('-h')) {
  const {createRuntimeBuildIdentity,writeRuntimeBuildReceipt}=await import('./runtime-build-identity.mjs');
  const configIndex=args.indexOf('--config');
  const configurationPath=path.resolve(root,configIndex>=0?args[configIndex+1]:args.find(arg=>arg.startsWith('--config='))?.slice('--config='.length)??'wrangler.jsonc');
  const configuration=JSON.parse(await fs.readFile(configurationPath,'utf8'));
  if(path.resolve(path.dirname(configurationPath),configuration.main)!==path.join(root,'worker/index.mjs')||typeof configuration.assets?.directory!=='string'||args.some(arg=>arg==='--no-bundle'||arg==='--assets'||arg.startsWith('--assets=')))throw new Error('BUILD_IDENTITY_UNSUPPORTED_ENTRY_OR_ASSETS_OVERRIDE');
  const receipt=await createRuntimeBuildIdentity({assetsDirectory:path.resolve(path.dirname(configurationPath),configuration.assets.directory),configurationPath,buildArguments:[...args]});
  await writeRuntimeBuildReceipt(receipt);
  preparedBuild={receipt,configurationPath,buildArguments:[...args],assetsDirectory:path.resolve(path.dirname(configurationPath),configuration.assets.directory)};
  args.push('--define',`USHSO_RUNTIME_BUILD_IDENTITY:${JSON.stringify(receipt.identity)}`);
}
const child = spawn(process.execPath, [wrangler, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', async (code, signal) => {
  if (signal) {
    console.error(`Wrangler exited from signal ${signal}.`);
    process.exitCode = 1;
  } else {
    if(code===0&&preparedBuild&&args[0]==='deploy'&&args.includes('--dry-run')) {
      try {
        const outputIndex=args.indexOf('--outdir');
        const output=outputIndex>=0?args[outputIndex+1]:args.find(arg=>arg.startsWith('--outdir='))?.slice('--outdir='.length);
        if(!output)throw new Error('BUILD_IDENTITY_DRY_RUN_OUTPUT_REQUIRED');
        const {finalizeRuntimeBuildReceipt}=await import('./runtime-build-identity.mjs');
        await finalizeRuntimeBuildReceipt(preparedBuild.receipt,{assetsDirectory:preparedBuild.assetsDirectory,configurationPath:preparedBuild.configurationPath,buildArguments:preparedBuild.buildArguments,workerArtifact:path.resolve(root,output,'index.js')});
      }catch(error){console.error(error.message);process.exitCode=1;return}
    }
    process.exitCode = code ?? 1;
  }
});
