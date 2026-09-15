#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkProject } from './catalog.js';
import { renderDailySite } from './daily-site.js';
import { buildDailyView } from './daily-view.js';
import { formatDiagnostic } from './diagnostics.js';
import { writeManagedFiles } from './managed-output.js';
import { buildReleaseDiff } from './release-diff.js';
import { renderReleaseSite } from './release-site.js';
import { createReleaseCatalogSnapshot, parseReleaseCatalogSnapshot, sameReleaseCatalogContent } from './release-catalog.js';
import { writeSite } from './site.js';
import { assembleTestRun } from './test-run-assembly.js';
import { parseTestRun } from './test-run.js';
import { renderQualitySite } from './quality-site.js';

const usage = `Usage:
  test-manager check --config <path>
  test-manager build --config <path> --out <path>
  test-manager snapshot --config <path> --commit <sha> --out <path>
  test-manager daily --config <path> --stylesheet <path> --out <path> --current-run <path> [--previous-run <path>]
  test-manager daily --config <path> --stylesheet <path> --out <path> --manifest <path> --completed-at <timestamp> [--unit-artifact <path> ...] [--previous-run <path>]
  test-manager release --production-snapshot <path> --staging-snapshot <path> --stylesheet <path> --out <path> [--latest-staging-run <path>]
  test-manager dashboard --config <path> --current-run <path> [--previous-run <path>] --production-snapshot <path> --staging-snapshot <path> [--latest-staging-run <path>] --stylesheet <path> --out <path>`;

type Command = 'check' | 'build' | 'snapshot' | 'daily' | 'release' | 'dashboard';
type ParsedArguments = Readonly<{ command: Command; flags: ReadonlyMap<string, ReadonlyArray<string>> }>;

const allowedFlags: Readonly<Record<Command, ReadonlySet<string>>> = {
  check: new Set(['--config']),
  build: new Set(['--config', '--out']),
  snapshot: new Set(['--config', '--commit', '--out']),
  daily: new Set(['--config', '--out', '--stylesheet', '--current-run', '--previous-run', '--manifest', '--completed-at', '--unit-artifact']),
  release: new Set(['--production-snapshot', '--staging-snapshot', '--latest-staging-run', '--stylesheet', '--out']),
  dashboard: new Set(['--config', '--current-run', '--previous-run', '--production-snapshot', '--staging-snapshot', '--latest-staging-run', '--stylesheet', '--out']),
};

const parseArguments = (args: ReadonlyArray<string>): ParsedArguments | undefined => {
  const command = args[0];
  if (command !== 'check' && command !== 'build' && command !== 'snapshot' && command !== 'daily' && command !== 'release' && command !== 'dashboard') return undefined;
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
  if (parsed.command === 'release') return ['--production-snapshot', '--staging-snapshot', '--stylesheet', '--out']
    .every((flag) => valueOf(parsed, flag) !== undefined);
  if (parsed.command === 'dashboard') return ['--config', '--current-run', '--production-snapshot', '--staging-snapshot', '--stylesheet', '--out']
    .every((flag) => valueOf(parsed, flag) !== undefined);
  if (!valueOf(parsed, '--config')) return false;
  if (parsed.command === 'check') return true;
  if (parsed.command === 'build') return valueOf(parsed, '--out') !== undefined;
  if (parsed.command === 'snapshot') return valueOf(parsed, '--out') !== undefined && valueOf(parsed, '--commit') !== undefined;
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
  if (parsed.command === 'release') {
    const productionSnapshotPath = valueOf(parsed, '--production-snapshot');
    const stagingSnapshotPath = valueOf(parsed, '--staging-snapshot');
    const stylesheetPath = valueOf(parsed, '--stylesheet');
    const out = valueOf(parsed, '--out');
    if (!productionSnapshotPath || !stagingSnapshotPath || !stylesheetPath || !out) return 2;
    const [production, staging] = await Promise.all([
      readJson(productionSnapshotPath).then(parseReleaseCatalogSnapshot),
      readJson(stagingSnapshotPath).then(parseReleaseCatalogSnapshot),
    ]);
    if (!production.success) throw new Error(`invalid production catalog snapshot: ${production.error.message}`);
    if (!staging.success) throw new Error(`invalid staging catalog snapshot: ${staging.error.message}`);
    const stagingRunPath = valueOf(parsed, '--latest-staging-run');
    const stagingRun = stagingRunPath
      ? parseTestRun(await readJson(stagingRunPath), new RegExp(staging.data.idPattern, 'u'))
      : undefined;
    if (stagingRun && !stagingRun.success) throw new Error(`invalid staging TestRun: ${stagingRun.error.message}`);
    const diff = buildReleaseDiff({
      production: production.data,
      staging: { snapshot: staging.data, ...(stagingRun?.data ? { latestRun: stagingRun.data } : {}) },
    });
    if (!diff.ok) throw new Error(`invalid release comparison: ${diff.problems.join('; ')}`);
    const stylesheet = await readFile(path.resolve(stylesheetPath), 'utf8');
    await writeManagedFiles(renderReleaseSite(diff.view, stylesheet), out, path.resolve(stagingSnapshotPath), 'release-v1\n');
    console.log(`release build passed: ${out}`);
    return 0;
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
  if (command === 'snapshot') {
    const out = valueOf(parsed, '--out');
    const commit = valueOf(parsed, '--commit');
    if (!out || !commit) return 2;
    const snapshot = createReleaseCatalogSnapshot(result.catalog, commit);
    await writeManagedFiles(new Map([['release-catalog.json', `${JSON.stringify(snapshot, null, 2)}\n`]]), out, result.catalog.projectRoot, 'release-catalog-v1\n');
    console.log(`snapshot build passed: ${out}`);
    return 0;
  }
  if (command === 'dashboard') {
    const out = valueOf(parsed, '--out');
    const currentPath = valueOf(parsed, '--current-run');
    const previousPath = valueOf(parsed, '--previous-run');
    const productionPath = valueOf(parsed, '--production-snapshot');
    const stagingPath = valueOf(parsed, '--staging-snapshot');
    const latestStagingRunPath = valueOf(parsed, '--latest-staging-run');
    const stylesheetPath = valueOf(parsed, '--stylesheet');
    if (!out || !currentPath || !productionPath || !stagingPath || !stylesheetPath) return 2;
    const idPattern = new RegExp(result.catalog.rules.idPattern, 'u');
    const [currentRun, previousRun, production, staging, latestStagingRun, stylesheet] = await Promise.all([
      readJson(currentPath).then((input) => parseTestRun(input, idPattern)),
      previousPath ? readJson(previousPath).then((input) => parseTestRun(input, idPattern)) : undefined,
      readJson(productionPath).then(parseReleaseCatalogSnapshot),
      readJson(stagingPath).then(parseReleaseCatalogSnapshot),
      latestStagingRunPath ? readJson(latestStagingRunPath).then((input) => parseTestRun(input, idPattern)) : undefined,
      readFile(path.resolve(stylesheetPath), 'utf8'),
    ]);
    if (!currentRun.success) throw new Error(`invalid current TestRun: ${currentRun.error.message}`);
    if (previousRun && !previousRun.success) throw new Error(`invalid previous TestRun: ${previousRun.error.message}`);
    if (!production.success) throw new Error(`invalid production catalog snapshot: ${production.error.message}`);
    if (!staging.success) throw new Error(`invalid staging catalog snapshot: ${staging.error.message}`);
    if (latestStagingRun && !latestStagingRun.success) throw new Error(`invalid latest staging TestRun: ${latestStagingRun.error.message}`);
    const configuredSnapshot = createReleaseCatalogSnapshot(result.catalog, staging.data.commit);
    if (!sameReleaseCatalogContent(configuredSnapshot, staging.data)) throw new Error('staging catalog snapshot does not match the configured catalog');
    const daily = buildDailyView(result.catalog, currentRun.data, previousRun?.data);
    if (!daily.ok) throw new Error(`daily view contains invalid run cases: ${daily.problems.map((problem) => problem.caseId).join(', ')}`);
    const release = buildReleaseDiff({ production: production.data, staging: { snapshot: staging.data, ...(latestStagingRun?.data ? { latestRun: latestStagingRun.data } : {}) } });
    if (!release.ok) throw new Error(`invalid release comparison: ${release.problems.join('; ')}`);
    await writeManagedFiles(renderQualitySite(result.catalog, daily.view, release.view, stylesheet), out, result.catalog.projectRoot, 'quality-site-v1\n');
    console.log(`dashboard build passed: ${out}`);
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
