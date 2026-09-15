#!/usr/bin/env node
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
import { loadDashboardStyles } from './dashboard-styles.js';
import { cliUsage, parseCliArguments } from './cli-arguments.js';
import { readJsonInput } from './cli-input.js';

const main = async (): Promise<number> => {
  const args = process.argv.slice(2);
  const parsed = parseCliArguments(args);
  if (!parsed) {
    console.error(cliUsage);
    return 2;
  }
  if (parsed.command === 'release') {
    const productionSnapshotPath = parsed.productionSnapshot;
    const stagingSnapshotPath = parsed.stagingSnapshot;
    const [production, staging] = await Promise.all([
      readJsonInput(productionSnapshotPath, 'production catalog snapshot').then(parseReleaseCatalogSnapshot),
      readJsonInput(stagingSnapshotPath, 'staging catalog snapshot').then(parseReleaseCatalogSnapshot),
    ]);
    if (!production.success) throw new Error(`invalid production catalog snapshot: ${production.error.message}`);
    if (!staging.success) throw new Error(`invalid staging catalog snapshot: ${staging.error.message}`);
    const stagingRunPath = parsed.latestStagingRun;
    const stagingRun = stagingRunPath
      ? parseTestRun(await readJsonInput(stagingRunPath, 'latest staging TestRun'), new RegExp(staging.data.idPattern, 'u'))
      : undefined;
    if (stagingRun && !stagingRun.success) throw new Error(`invalid staging TestRun: ${stagingRun.error.message}`);
    const diff = buildReleaseDiff({
      production: production.data,
      staging: { snapshot: staging.data, ...(stagingRun?.data ? { latestRun: stagingRun.data } : {}) },
    });
    if (!diff.ok) throw new Error(`invalid release comparison: ${diff.problems.join('; ')}`);
    const stylesheet = await loadDashboardStyles(parsed.stylesheet);
    await writeManagedFiles(renderReleaseSite(diff.view, stylesheet), parsed.out, path.resolve(stagingSnapshotPath), 'release-v1\n');
    console.log(`release build passed: ${parsed.out}`);
    return 0;
  }
  const config = parsed.config;
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
    const snapshot = createReleaseCatalogSnapshot(result.catalog, parsed.commit);
    await writeManagedFiles(new Map([['release-catalog.json', `${JSON.stringify(snapshot, null, 2)}\n`]]), parsed.out, result.catalog.projectRoot, 'release-catalog-v1\n');
    console.log(`snapshot build passed: ${parsed.out}`);
    return 0;
  }
  if (command === 'dashboard') {
    const currentPath = parsed.currentRun;
    const previousPath = parsed.previousRun;
    const productionPath = parsed.productionSnapshot;
    const stagingPath = parsed.stagingSnapshot;
    const latestStagingRunPath = parsed.latestStagingRun;
    const idPattern = new RegExp(result.catalog.rules.idPattern, 'u');
    const [currentRun, previousRun, production, staging, latestStagingRun, stylesheet] = await Promise.all([
      readJsonInput(currentPath, 'current TestRun').then((input) => parseTestRun(input, idPattern)),
      previousPath ? readJsonInput(previousPath, 'previous TestRun').then((input) => parseTestRun(input, idPattern)) : undefined,
      readJsonInput(productionPath, 'production catalog snapshot').then(parseReleaseCatalogSnapshot),
      readJsonInput(stagingPath, 'staging catalog snapshot').then(parseReleaseCatalogSnapshot),
      latestStagingRunPath ? readJsonInput(latestStagingRunPath, 'latest staging TestRun').then((input) => parseTestRun(input, idPattern)) : undefined,
      loadDashboardStyles(parsed.stylesheet),
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
    await writeManagedFiles(renderQualitySite(result.catalog, daily.view, release.view, stylesheet), parsed.out, result.catalog.projectRoot, 'quality-site-v1\n');
    console.log(`dashboard build passed: ${parsed.out}`);
    return 0;
  }
  if (command === 'daily') {
    const idPattern = new RegExp(result.catalog.rules.idPattern, 'u');
    const currentResult = parsed.current.type === 'run'
      ? parseTestRun(await readJsonInput(parsed.current.path, 'current TestRun'), idPattern)
      : assembleTestRun({
        manifest: await readJsonInput(parsed.current.manifest, 'CI manifest'),
        completedAt: parsed.current.completedAt,
        unitArtifacts: await Promise.all(parsed.current.unitArtifacts.map((file) => readJsonInput(file, 'unit artifact'))),
      }, idPattern);
    if (!currentResult.success) throw new Error(`invalid current TestRun: ${currentResult.error.message}`);
    const previousResult = parsed.previousRun ? parseTestRun(await readJsonInput(parsed.previousRun, 'previous TestRun'), idPattern) : undefined;
    if (previousResult && !previousResult.success) throw new Error(`invalid previous TestRun: ${previousResult.error.message}`);
    const view = buildDailyView(result.catalog, currentResult.data, previousResult?.data);
    if (!view.ok) throw new Error(`daily view contains unknown case IDs: ${view.problems.map((problem) => problem.caseId).join(', ')}`);
    const stylesheet = await loadDashboardStyles(parsed.stylesheet);
    await writeManagedFiles(renderDailySite(view.view, stylesheet), parsed.out, result.catalog.projectRoot, 'daily-v1\n');
    console.log(`daily build passed: ${parsed.out}`);
    return 0;
  }
  await writeSite(result.catalog, parsed.out);
  console.log(`build passed: ${parsed.out}`);
  return 0;
};

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
