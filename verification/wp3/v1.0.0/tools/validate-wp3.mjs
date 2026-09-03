#!/usr/bin/env node
import { validateWp3Aggregate } from './wp3-validation.mjs';

process.stdout.write(`${JSON.stringify(validateWp3Aggregate(), null, 2)}\n`);
