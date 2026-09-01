#!/usr/bin/env node
import { buildWp4Receipt } from './wp4-verification.mjs';

process.stdout.write(`${JSON.stringify(await buildWp4Receipt(), null, 2)}\n`);
