#!/usr/bin/env node
import { cliUsage, parseCliArguments } from './cli-arguments.js';
import { executeCliCommand } from './cli-command.js';

const parsed = parseCliArguments(process.argv.slice(2));

if (!parsed) {
  console.error(cliUsage);
  process.exitCode = 2;
} else {
  executeCliCommand(parsed, console).then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
