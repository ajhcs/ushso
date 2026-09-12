import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, sha256 } from '../../packages/connectors/src/canonical.mjs';
import { compileManifestRequest, validateDescriptor } from '../../packages/connectors/src/route-manifest.mjs';
import { createInMemoryControlPlane } from '../../packages/ingestion/src/in-memory-control-plane.mjs';
import { createScheduler } from '../../packages/ingestion/src/scheduler.mjs';
import { admitCollectionJob } from '../../packages/ingestion/src/collection-job.mjs';
import { loadFixtureCatalog, createFixtureRegistry } from '../../packages/ingestion/src/local-fixture-catalog.mjs';

const copy = value => structuredClone(value);
test('A1/L1 approved exact fixture descriptor and route produce a strict collection job', async () => {
  const fixture = await loadFixtureCatalog();
  const result = await admitCollectionJob(fixture.input, fixture);
  assert.equal(result.kind, 'admitted');
  assert.equal(result.job.identity.descriptor_sha256, sha256(canonicalJson(validateDescriptor(fixture.descriptor))));
  assert.equal(compileManifestRequest(fixture.descriptor, result.job.initial_request).url.href, 'https://catalog.example.gov/data.json');
  assert.notEqual(result.job.execution_run_id, result.job.parent_run_id);
  assert.equal(result.job.activation.live_network, false);
});

test('A2 invalid identity, route, scope, extra fields and unapproved context block admission', async () => {
  const fixture = await loadFixtureCatalog();
  for (const [field, value] of [['source_id','source_cdc_socrata'],['descriptor_id','descriptor_other'],['configuration_revision',2],['scope_id','scope_other'],['endpoint_id','endpoint_other'],['template_id','route_other'],['extra',true],['fixture_manifest_sha256','f'.repeat(64)]]) {
    const input = { ...fixture.input, [field]: value };
    assert.equal((await admitCollectionJob(input, fixture)).kind, 'blocked', field);
  }
  assert.equal((await admitCollectionJob(fixture.input, {...fixture,resolveApprovedDescriptor:undefined})).code, 'APPROVED_REGISTRY_REQUIRED');
  assert.equal((await admitCollectionJob(fixture.input,{...fixture,resolveApprovedDescriptor:async()=>({kind:'resolved',approvalScope:'live'})})).code,'DESCRIPTOR_NOT_APPROVED');
});

test('A3 canonical key ordering preserves identity; stale hashes block; approved revision changes identity', async () => {
  const fixture = await loadFixtureCatalog();
  const a = await admitCollectionJob(fixture.input, fixture);
  const reordered = Object.fromEntries(Object.entries(fixture.input).reverse());
  assert.equal((await admitCollectionJob(reordered,fixture)).job.collection_job_id,a.job.collection_job_id);
  assert.equal((await admitCollectionJob({...fixture.input,descriptor_sha256:'a'.repeat(64)},fixture)).code,'DESCRIPTOR_HASH_MISMATCH');
  const descriptor=copy(fixture.descriptor);descriptor.configuration_revision=2;
  const registry=createFixtureRegistry({descriptor,manifest:fixture.manifest,policySha256:fixture.policySha256});
  const b=await admitCollectionJob({...fixture.input,configuration_revision:2,descriptor_sha256:sha256(canonicalJson(descriptor))},{...fixture,...registry});
  assert.equal(b.kind,'admitted');assert.notEqual(a.job.parent_run_id,b.job.parent_run_id);assert.notEqual(a.job.collection_job_id,b.job.collection_job_id);
});

test('A4 real, paused and activated foreign descriptors cannot enter the fixture lane', async()=>{
  const fixture=await loadFixtureCatalog();
  for(const state of ['paused','auth_blocked']){
    const descriptor=copy(fixture.descriptor);descriptor.source_state=state;
    const registry=createFixtureRegistry({descriptor,manifest:fixture.manifest,policySha256:fixture.policySha256});
    assert.equal((await admitCollectionJob({...fixture.input,descriptor_sha256:sha256(canonicalJson(descriptor))},{...fixture,...registry})).code,'FIXTURE_DESCRIPTOR_NOT_ACTIVE');
  }
  const policy=copy(fixture.policy);policy.activation.live_network=true;
  assert.equal((await admitCollectionJob(fixture.input,{...fixture,policy})).code,'ACTIVATION_FORBIDDEN');
});

test('A5 repeated actual scheduler slots converge on one run and workflow outbox',async()=>{
  const fixture=await loadFixtureCatalog();const admitted=await admitCollectionJob(fixture.input,fixture);const job=admitted.job;
  const control=createInMemoryControlPlane();control.seedSource({source_id:job.identity.source_id,endpoint_id:job.identity.endpoint_id,scope_ids:[job.identity.scope_id],configuration_revision:1,next_due_at:job.identity.scheduled_slot,mode:job.identity.mode});
  const scheduler=createScheduler({openDatabase:control.openDatabase,configuration:{mode:'full_membership'}});
  const first=await scheduler.dispatchScheduledSlot({scheduledTime:job.identity.scheduled_slot});
  const second=await scheduler.dispatchScheduledSlot({scheduledTime:job.identity.scheduled_slot});
  assert.equal(first.created,1);assert.equal(second.created,0);assert.equal(control.inspect().runs.size,1);assert.equal(control.inspect().outbox.size,1);
  assert.equal([...control.inspect().runs.keys()][0],job.parent_run_id);
  assert.ok(control.inspect().clientLifecycle.every(client=>client.closed));
});

test('A6 selections and reservations give child identities while rejecting duplicates and loose limits',async()=>{
  const fixture=await loadFixtureCatalog();const a=await admitCollectionJob(fixture.input,fixture);
  const b=await admitCollectionJob({...fixture.input,selected_record_ids:[fixture.input.selected_record_ids[0]]},fixture);
  assert.equal(b.kind,'admitted');assert.equal(a.job.parent_run_id,b.job.parent_run_id);assert.notEqual(a.job.collection_job_id,b.job.collection_job_id);assert.notEqual(a.job.execution_run_id,b.job.execution_run_id);
  assert.equal((await admitCollectionJob({...fixture.input,selected_record_ids:['fixture-record-a','fixture-record-a']},fixture)).code,'SELECTED_RECORDS_DUPLICATE');
  for(const value of [0,-1,1.5,3])assert.equal((await admitCollectionJob({...fixture.input,budget_reservation:{...fixture.input.budget_reservation,maximum_requests:value}},fixture)).kind,'blocked');
  assert.equal((await admitCollectionJob({...fixture.input,capture_class:'source_data_payload'},fixture)).code,'CAPTURE_CLASS_NOT_SUPPORTED');
  const c=await admitCollectionJob({...fixture.input,budget_reservation:{...fixture.input.budget_reservation,reservation_id:'reservation_other'}},fixture);
  assert.notEqual(c.job.collection_job_id,a.job.collection_job_id);
});
