// Regenerates the screenshots in docs/assets from the example project in examples/showcase.
// Usage: pnpm build && node scripts/guide-screenshots.mjs
// The daily runs, the production catalog and the manual results are made up here, so the screens show
// every state they can show (a new failure, a flaky case, a failing streak, added/changed/removed cases).
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { assembleTestRun } from '../dist/test-run-assembly.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(repo, 'examples/showcase');
const config = path.join(project, 'test-manager.yaml');
const assets = path.join(repo, 'docs/assets');
const cli = (...args) => execFileSync(process.execPath, [path.join(repo, 'dist/cli-entry.js'), ...args], { encoding: 'utf8' });
const work = await mkdtemp(path.join(os.tmpdir(), 'test-manager-guide-'));
const file = (name) => path.join(work, name);
const writeJson = (name, value) => writeFile(file(name), `${JSON.stringify(value, null, 2)}\n`);
const readJson = async (name) => JSON.parse(await readFile(file(name), 'utf8'));

try {
  // Release: staging is the example project as it is; production is an older catalog derived from it.
  const stagingCommit = '7f3a12c9d4e5b6a7c8d9e0f1a2b3c4d5e6f7a8b9';
  cli('snapshot', '--config', config, '--commit', stagingCommit, '--out', file('staging'));
  const staging = await readJson('staging/release-catalog.json');
  const production = structuredClone(staging);
  production.commit = '6e2b11a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6';
  production.cases = production.cases
    .filter((managedCase) => !['CASE-007', 'CASE-032'].includes(managedCase.id))
    .map((managedCase) => managedCase.id === 'CASE-011' ? { ...managedCase, fields: { ...managedCase.fields, rank: 'B' } }
      : managedCase.id === 'CASE-021' ? { ...managedCase, title: '発行済みの請求書は編集できない' } : managedCase);
  production.cases.push({ ...staging.cases.find((managedCase) => managedCase.id === 'CASE-023'), id: 'CASE-034', title: '請求書を CSV で出力できる' });
  await writeJson('production.json', production);
  await writeFile(file('pr-comment.md'), cli('pr-comment', '--base-snapshot', file('production.json'), '--head-snapshot', file('staging/release-catalog.json')));

  const manualResults = (caseId, outcome, executedAt, note) => ({ caseId, executedAt, outcome, ...(note ? { note } : {}) });
  await writeJson('manual-results.json', {
    schemaVersion: 1, environment: 'staging', commit: stagingCommit, executedBy: 'qa-team',
    results: [
      manualResults('CASE-009', 'passed', '2026-10-21T14:00:00+09:00'),
      manualResults('CASE-018', 'failed', '2026-10-21T15:30:00+09:00', '返金額が送料を含まずに表示された'),
      manualResults('CASE-025', 'blocked', '2026-10-21T16:00:00+09:00', 'メールの送信元の設定待ち'),
      manualResults('CASE-033', 'passed', '2026-10-21T16:20:00+09:00'),
    ],
  });

  // Daily runs: eight days on staging, the last one is the current run.
  const automated = staging.cases.filter((managedCase) => managedCase.source === 'vitest' || managedCase.source === 'playwright');
  const outcome = (caseId, day) => {
    if (caseId === 'CASE-013') return { expected: 'failed', attempts: ['failed'] };
    if (caseId === 'CASE-022') return { expected: 'skipped', attempts: ['skipped'] };
    if (caseId === 'CASE-016' && [2, 5, 7].includes(day)) return { expected: 'passed', attempts: ['failed', 'passed'] };
    if (caseId === 'CASE-024' && day >= 5) return { expected: 'passed', attempts: [day === 7 ? 'timedOut' : 'failed'] };
    if (caseId === 'CASE-020' && day === 7) return { expected: 'passed', attempts: ['failed'] };
    if (caseId === 'CASE-006' && day === 6) return { expected: 'passed', attempts: ['failed'] };
    return { expected: 'passed', attempts: ['passed'] };
  };
  const idPattern = new RegExp(staging.idPattern, 'u');
  const runs = [];
  for (let day = 0; day < 8; day += 1) {
    const date = `2026-10-${String(15 + day).padStart(2, '0')}`;
    const commit = day === 7 ? stagingCommit : `${String(day + 1).repeat(7)}${'0'.repeat(33)}`;
    const units = [
      { unitId: 'vitest-unit', runner: 'vitest', layer: 'unit', target: 'node' },
      { unitId: 'playwright-e2e', runner: 'playwright', layer: 'e2e', target: 'chromium' },
    ].map((unit) => ({ ...unit, plannedCaseIds: automated.filter((managedCase) => managedCase.source === unit.runner && managedCase.status !== 'todo').map((managedCase) => managedCase.id) }));
    const artifact = (unit) => ({
      state: 'completed',
      unitId: unit.unitId,
      observations: unit.plannedCaseIds.map((caseId, index) => {
        const { expected, attempts } = outcome(caseId, day);
        return {
          caseId, expected,
          attemptCoverage: { kind: 'finalOnly', retryCount: attempts.length - 1, flaky: attempts.length > 1 && attempts.at(-1) === 'passed' },
          attempts: attempts.map((attemptOutcome, attempt) => ({
            outcome: attemptOutcome, durationMs: unit.runner === 'vitest' ? 12 + index : 2400 + index * 90,
            startedAt: `${date}T00:${String(index).padStart(2, '0')}:${String(attempt * 30).padStart(2, '0')}Z`, artifactRefs: [],
          })),
        };
      }),
    });
    const run = assembleTestRun({
      manifest: { schemaVersion: 1, runId: `daily-${date}`, attempt: 1, environment: 'staging', commit, scopeId: 'daily-all', startedAt: `${date}T00:00:00Z`, ciUrl: `https://example.com/actions/runs/daily-${date}`, units },
      completedAt: `${date}T00:40:00Z`,
      unitArtifacts: units.map(artifact),
    }, idPattern);
    if (!run.success) throw new Error(`invalid run ${date}: ${run.error.message}`);
    runs.push(run.data);
  }
  await mkdir(file('history'));
  for (const run of runs.slice(0, -1)) await writeFile(path.join(file('history'), `${run.runId}.json`), JSON.stringify(run));
  await writeJson('current.json', runs.at(-1));

  cli('dashboard', '--config', config,
    '--current-run', file('current.json'), '--previous-run', path.join(file('history'), `${runs.at(-2).runId}.json`), '--history-dir', file('history'),
    '--production-snapshot', file('production.json'), '--staging-snapshot', file('staging/release-catalog.json'), '--latest-staging-run', file('current.json'),
    '--manual-results', file('manual-results.json'), '--out', file('site'));

  const shots = {
    'guide-daily.png': 'index.html',
    'guide-release.png': 'release.html',
    'guide-catalog-top.png': 'catalog/index.html',
    'guide-case-search.png': 'catalog/cases/index.html',
    'guide-document.png': 'catalog/documents/checkout.html',
    'guide-case.png': 'catalog/cases/CASE-003.html',
    'guide-manual-case.png': 'catalog/cases/CASE-009.html',
  };
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  for (const [name, target] of Object.entries(shots)) {
    await page.goto(`file://${path.join(file('site'), target)}`);
    await page.screenshot({ path: path.join(assets, name), fullPage: true });
  }
  await browser.close();
  process.stdout.write(await readFile(file('pr-comment.md'), 'utf8'));
} finally {
  await rm(work, { recursive: true, force: true });
}
