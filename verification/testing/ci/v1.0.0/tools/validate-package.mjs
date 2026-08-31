import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCiIntegrationReceipt, receiptPath } from './ci-inventory.mjs'

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export async function validateCiIntegrationReceipt() {
  const expected = await buildCiIntegrationReceipt()
  const stored = JSON.parse(await readFile(receiptPath, 'utf8'))
  if (stable(stored) !== stable(expected)) throw new Error('CI_INTEGRATION_RECEIPT_STALE')
  return expected
}

async function writeReceipt(receipt) {
  await mkdir(dirname(receiptPath), { recursive: true })
  const temporary = `${receiptPath}.partial-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, receiptPath)
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const receipt = await buildCiIntegrationReceipt()
  if (process.argv.includes('--write-receipt')) await writeReceipt(receipt)
  else await validateCiIntegrationReceipt()
  console.log(JSON.stringify({ status: receipt.status, contract_package_count: receipt.contract_package_count, verification_suite_count: receipt.verification_suite_count, discovered_node_test_file_count: receipt.discovered_node_test_file_count }))
}
