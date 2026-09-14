import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createLocalCollector,
  localFailure,
  previewLocalFixture
} from './local-collector-adapter.mjs';
import { FIXTURE_ID, loadFixtureCatalog } from './local-fixture-catalog.mjs';
import { requireLocal } from './collection-job.mjs';

/** Fixed synthetic fixture only. No user-controlled route or service options. */
export async function localJobCommand(args = process.argv.slice(2)) {
  let app;
  try {
    const command = args[0] ?? 'preview';
    requireLocal(
      ['preview', 'run-fixture', 'resume', 'status'].includes(command),
      'COMMAND_NOT_SUPPORTED'
    );
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: { fixture: { type: 'string' }, 'state-dir': { type: 'string' } }
    });
    requireLocal(positionals.length === 0, 'COMMAND_ARGUMENT_INVALID');
    if (command === 'preview') {
      requireLocal(values['state-dir'] === undefined, 'PREVIEW_STATE_DIRECTORY_FORBIDDEN');
      return { exitCode: 0, result: await previewLocalFixture(values.fixture ?? FIXTURE_ID) };
    }
    requireLocal(
      typeof values['state-dir'] === 'string' && path.isAbsolute(values['state-dir']),
      'STATE_DIRECTORY_REQUIRED'
    );
    if (command !== 'run-fixture')
      requireLocal(values.fixture === undefined, 'RESUME_FIXTURE_OVERRIDE_FORBIDDEN');
    const fixture = await loadFixtureCatalog(values.fixture ?? FIXTURE_ID);
    app = await createLocalCollector({
      stateDir: values['state-dir'],
      fixture,
      readOnly: command === 'status'
    });
    let jobs = [...app.inspect().children.values()];
    if (command === 'run-fixture') jobs = [(await app.admit()).job];
    requireLocal(jobs.length > 0, 'NO_ADMITTED_JOBS');
    const outcomes = [];
    for (const job of jobs)
      outcomes.push(
        command === 'status'
          ? app.status(job.collection_job_id)
          : await app.execute(job.collection_job_id)
      );
    const complete = outcomes.every((outcome) => outcome.status === 'complete_fixture');
    return {
      exitCode: command === 'status' || complete ? 0 : 2,
      result: {
        status: complete
          ? 'complete_fixture'
          : outcomes.length === 1
            ? outcomes[0].status
            : 'partial',
        jobs: outcomes,
        journal_directory: path.join(values['state-dir'], 'journal'),
        fixture_only: true,
        publication_authorized: false,
        production_composition: false
      }
    };
  } catch (error) {
    return { exitCode: 2, result: localFailure(error) };
  } finally {
    await app?.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { exitCode, result } = await localJobCommand();
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = exitCode;
}
