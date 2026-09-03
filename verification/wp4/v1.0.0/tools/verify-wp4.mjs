#!/usr/bin/env node
import { verifyWp4 } from './wp4-verification.mjs';

process.stdout.write(`${JSON.stringify(await verifyWp4(), null, 2)}\n`);
