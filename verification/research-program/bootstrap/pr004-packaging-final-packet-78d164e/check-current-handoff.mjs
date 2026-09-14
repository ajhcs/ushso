import {pathToFileURL} from 'node:url';
const {checkHandoff}=await import(pathToFileURL("/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr003-pr004-pr085-composition-20260911/scripts/research-program/check-handoff.mjs"));
const r=await checkHandoff('docs/research-program/handoffs/PR-004.json',{repoRoot:"/mnt/d/worktrees/plumbob/.ushso-research-program-20260910-worktrees/ushso-pr004-packaging-controller-review-20260911"});
console.log(JSON.stringify(r));process.exitCode=r.ok?0:1;
