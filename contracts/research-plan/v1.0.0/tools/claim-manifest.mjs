import path from 'node:path';

import { canonicalDigest, PACKAGE_ROOT, readJson } from './common.mjs';

function escapePointer(value) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function collectProperties(node, pointer = '$', output = []) {
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectProperties(value, `${pointer}/${index}`, output));
    return output;
  }
  if (!node || typeof node !== 'object') return output;
  if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
    for (const [property, definition] of Object.entries(node.properties)) {
      const propertyPointer = `${pointer}/properties/${escapePointer(property)}`;
      output.push(propertyPointer);
      collectProperties(definition, propertyPointer, output);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'properties') collectProperties(value, `${pointer}/${escapePointer(key)}`, output);
  }
  return output;
}

export async function schemaPropertyInventory(manifest) {
  const inventory = [];
  for (const relative of [...manifest.truth_bearing_schema_files].sort()) {
    const schema = await readJson(path.join(PACKAGE_ROOT, relative));
    const properties = collectProperties(schema).sort();
    inventory.push({ schema_path: relative, property_pointers: properties });
  }
  return inventory;
}

export async function schemaPropertyInventoryDigest(manifest) {
  return canonicalDigest(await schemaPropertyInventory(manifest));
}
