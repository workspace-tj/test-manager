#!/usr/bin/env node
import { checkProject } from './catalog.js';
import { formatDiagnostic } from './diagnostics.js';
import { writeSite } from './site.js';

const usage = 'Usage: test-manager <check|build> --config <path> [--out <path>]';
const valueAfter = (args: ReadonlyArray<string>, flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const main = async (): Promise<number> => {
  const args = process.argv.slice(2);
  const command = args[0];
  const config = valueAfter(args, '--config');
  if ((command !== 'check' && command !== 'build') || !config) {
    console.error(usage);
    return 2;
  }
  const result = await checkProject(config);
  if (!result.ok) {
    for (const item of result.diagnostics) console.error(formatDiagnostic(item));
    console.error(`check failed with ${result.diagnostics.length} diagnostic(s)`);
    return 1;
  }
  if (command === 'check') {
    console.log(`check passed: ${result.catalog.documents.length} document(s), ${result.catalog.cases.length} case(s)`);
    return 0;
  }
  const out = valueAfter(args, '--out');
  if (!out) {
    console.error('build requires --out <path>');
    return 2;
  }
  await writeSite(result.catalog, out);
  console.log(`build passed: ${out}`);
  return 0;
};

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
