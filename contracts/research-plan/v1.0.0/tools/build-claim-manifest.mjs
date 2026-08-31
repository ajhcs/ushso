import path from 'node:path';

import { PACKAGE_ROOT, readJson, writeAtomic } from './common.mjs';
import { schemaPropertyInventoryDigest } from './claim-manifest.mjs';

const file = path.join(PACKAGE_ROOT, 'contracts', 'claim-manifest.json');
const manifest = await readJson(file);
manifest.schema_property_inventory_digest = await schemaPropertyInventoryDigest(manifest);
await writeAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`wrote claim manifest inventory ${manifest.schema_property_inventory_digest}\n`);
