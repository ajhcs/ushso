import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadEffectiveAuthorizationRegister } from '../tools/effective-register.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

async function jsonFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const child = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(child));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(child);
  }
  return files.sort();
}

function authorizationClaims(value, claims = []) {
  if (!value || typeof value !== 'object') return claims;
  if (Array.isArray(value)) {
    value.forEach(item => authorizationClaims(item, claims));
    return claims;
  }
  for (const key of ['authorization_reference', 'external_authorization_id']) {
    const reference = value[key];
    if (typeof reference === 'string' && /^AUTH-\d{2}$/u.test(reference)) {
      claims.push({ reference, authorized: value.authorized, statuses: [value.authorization_status, value.status].filter(status => typeof status === 'string') });
    }
  }
  Object.values(value).forEach(child => authorizationClaims(child, claims));
  return claims;
}

test('the v1.0 register is preserved and AUTH-10 is the only authorized delta', async () => {
  const register = await loadEffectiveAuthorizationRegister();
  assert.deepEqual(register.entries.map(entry => entry.id), Array.from({ length: 17 }, (_, index) => `AUTH-${String(index + 1).padStart(2, '0')}`));
  for (const entry of register.entries) {
    if (entry.id === 'AUTH-10') {
      assert.equal(entry.authorized, true);
      assert.equal(entry.status, 'authorized_scoped');
      assert.equal(entry.scope.repository, 'ajhcs/ushso');
      assert.equal(entry.scope.branch, 'codex/research-navigator-integration');
    } else {
      assert.equal(entry.authorized, false, entry.id);
      assert.equal(entry.status, 'not_requested', entry.id);
    }
  }
});

test('the AUTH-10 receipt retains every prohibited boundary', async () => {
  const receipt = JSON.parse(await readFile(new URL('../receipts/auth-10-2026-09-03.json', import.meta.url), 'utf8'));
  assert.equal(receipt.authorization_reference, 'AUTH-10');
  assert.equal(receipt.authorized, true);
  assert.ok(receipt.explicit_exclusions.includes('merging the pull request'));
  assert.ok(receipt.explicit_exclusions.includes('held-out retrieval evaluation under AUTH-13'));
  assert.ok(receipt.explicit_exclusions.some(value => value.includes('production deployment')));
});

test('verification artifacts cannot claim authority denied by the effective register', async () => {
  const register = await loadEffectiveAuthorizationRegister();
  const entries = new Map(register.entries.map(entry => [entry.id, entry]));
  for (const file of await jsonFiles(join(repositoryRoot, 'verification'))) {
    const document = JSON.parse(await readFile(file, 'utf8'));
    for (const claim of authorizationClaims(document)) {
      const entry = entries.get(claim.reference);
      assert.ok(entry, `${file} references unknown ${claim.reference}`);
      const claimsAuthorization = claim.authorized === true || claim.statuses.some(status => /^authorized(?:_|$)/u.test(status));
      if (claimsAuthorization) {
        assert.equal(entry.authorized, true, `${file} claims denied ${claim.reference}`);
        assert.match(entry.status, /^authorized(?:_|$)/u);
      }
    }
  }
});
