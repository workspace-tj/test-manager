#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkProject } from './catalog.js';
import { renderDailySite } from './daily-site.js';
import { buildDailyView } from './daily-view.js';
import { formatDiagnostic } from './diagnostics.js';
import { writeManagedFiles } from './managed-output.js';
import { writeSite } from './site.js';
import { assembleTestRun } from './test-run-assembly.js';
import { parseTestRun } from './test-run.js';

const usage = `Usage:
  test-manager check --config <path>
  test-manager build --config <path> --out <path>
  test-manager daily --config <path> --stylesheet <path> --out <path> --current-run <path> [--previous-run <path>]
  test-manager daily --config <path> --stylesheet <path> --out <path> --manifest <path> --completed-at <timestamp> [--unit-artifact <path> ...] [--previous-run <path>]`;

type Command = 'check' | 'build' | 'daily';
type ParsedArguments = Readonly<{ command: Command; flags: ReadonlyMap<string, ReadonlyArray<string>> }>;

const allowedFlags: Readonly<Record<Command, ReadonlySet<string>>> = {
  check: new Set(['--config']),
  build: new Set(['--config', '--out']),
  daily: new Set(['--config', '--out', '--stylesheet', '--current-run', '--previous-run', '--manifest', '--completed-at', '--unit-artifact']),
};

const parseArguments = (args: ReadonlyArray<string>): ParsedArguments | undefined => {
  const command = args[0];
  if (command !== 'check' && command !== 'build' && command !== 'daily') return undefined;
  const collected = new Map<string, string[]>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || value === undefined || value.length === 0 || !flag.startsWith('--') || value.startsWith('--') || !allowedFlags[command].has(flag)) return undefined;
    const previous = collected.get(flag) ?? [];
    if (previous.length > 0 && flag !== '--unit-artifact') return undefined;
    collected.set(flag, [...previous, value]);
  }
  return { command, flags: collected };
};
const valueOf = (parsed: ParsedArguments, flag: string): string | undefined => parsed.flags.get(flag)?.[0];
const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(path.resolve(file), 'utf8'));

const hasValidUsage = (parsed: ParsedArguments): boolean => {
  if (!valueOf(parsed, '--config')) return false;
  if (parsed.command === 'check') return true;
  if (parsed.command === 'build') return valueOf(parsed, '--out') !== undefined;
  const currentPath = valueOf(parsed, '--current-run');
  const manifestPath = valueOf(parsed, '--manifest');
  const completedAt = valueOf(parsed, '--completed-at');
  const artifactPaths = parsed.flags.get('--unit-artifact') ?? [];
  const usesCurrent = currentPath !== undefined;
  const usesAssembly = manifestPath !== undefined || completedAt !== undefined || artifactPaths.length > 0;
  return valueOf(parsed, '--out') !== undefined
    && valueOf(parsed, '--stylesheet') !== undefined
    && usesCurrent !== usesAssembly
    && (!usesAssembly || (manifestPath !== undefined && completedAt !== undefined));
};

const main = async (): Promise<number> => {
  const args = process.argv.slice(2);
  const parsed = parseArguments(args);
  if (!parsed || !hasValidUsage(parsed)) {
    console.error(usage);
    return 2;
  }
  const config = valueOf(parsed, '--config');
  if (!config) return 2;
  const command = parsed.command;
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
  if (command === 'daily') {
    const out = valueOf(parsed, '--out');
    const stylesheetPath = valueOf(parsed, '--stylesheet');
    const currentPath = valueOf(parsed, '--current-run');
    const previousPath = valueOf(parsed, '--previous-run');
    const manifestPath = valueOf(parsed, '--manifest');
    const completedAt = valueOf(parsed, '--completed-at');
    const artifactPaths = parsed.flags.get('--unit-artifact') ?? [];
    if (!out || !stylesheetPath) return 2;
    const idPattern = new RegExp(result.catalog.rules.idPattern, 'u');
    const currentResult = currentPath
      ? parseTestRun(await readJson(currentPath), idPattern)
      : assembleTestRun({
        manifest: await readJson(manifestPath ?? ''),
        completedAt,
        unitArtifacts: await Promise.all(artifactPaths.map(readJson)),
      }, idPattern);
    if (!currentResult.success) throw new Error(`invalid current TestRun: ${currentResult.error.message}`);
    const previousResult = previousPath ? parseTestRun(await readJson(previousPath), idPattern) : undefined;
    if (previousResult && !previousResult.success) throw new Error(`invalid previous TestRun: ${previousResult.error.message}`);
    const view = buildDailyView(result.catalog, currentResult.data, previousResult?.data);
    if (!view.ok) throw new Error(`daily view contains unknown case IDs: ${view.problems.map((problem) => problem.caseId).join(', ')}`);
    const stylesheet = await readFile(path.resolve(stylesheetPath), 'utf8');
    await writeManagedFiles(renderDailySite(view.view, stylesheet), out, result.catalog.projectRoot, 'daily-v1\n');
    console.log(`daily build passed: ${out}`);
    return 0;
  }
  const out = valueOf(parsed, '--out');
  if (!out) return 2;
  await writeSite(result.catalog, out);
  console.log(`build passed: ${out}`);
  return 0;
};

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
