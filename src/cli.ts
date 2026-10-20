#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; version: string };
const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--version') {
  console.log(`${manifest.name} ${manifest.version}`);
} else if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
  console.log(`${manifest.name} — compatibility research

Usage: opencode-claude --help | --version

The approved setup, models, model set, and run commands are not available yet.
The native OpenCode tool interface is being tested before these commands ship.`);
} else {
  console.error('This command is not available yet. Run opencode-claude --help for the current status.');
  process.exitCode = 2;
}
