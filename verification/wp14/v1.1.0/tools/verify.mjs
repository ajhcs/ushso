#!/usr/bin/env node
import { verifySuccessorAttestation } from "../src/successor-attestation.mjs";

try {
  const result = verifySuccessorAttestation();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failed > 0) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`WP14 successor attestation failed closed: ${error.message}\n`);
  process.exitCode = 1;
}
