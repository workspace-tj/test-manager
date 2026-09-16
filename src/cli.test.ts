import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseReleaseCatalogSnapshot } from './release-catalog.js';

const execute = promisify(execFile);
const cli = path.resolve('src/cli-entry.ts');

const run = async (args: ReadonlyArray<string>): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> => {
  try {
    const result = await execute(process.execPath, ['--import', 'tsx', cli, ...args]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && 'stdout' in error && 'stderr' in error) {
      return { code: typeof error.code === 'number' ? error.code : -1, stdout: String(error.stdout), stderr: String(error.stderr) };
    }
    throw error;
  }
};

describe('CLI process boundary', () => {
  it('returns 0 for a valid project and 2 for invalid usage', async () => {
    expect((await run(['check', '--config', 'fixtures/valid/test-manager.yaml'])).code).toBe(0);
    expect((await run([])).code).toBe(2);
  });

  it('returns 1 and does not publish output when validation fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-'));
    const out = path.join(root, 'site');
    const result = await run(['build', '--config', 'fixtures/invalid/test-manager.yaml', '--out', out]);
    expect(result.code).toBe(1);
    await expect(access(out)).rejects.toThrow();
  });

  it('builds a valid project at the process boundary', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-build-'));
    const out = path.join(root, 'site');
    const result = await run(['build', '--config', 'fixtures/valid/test-manager.yaml', '--out', out]);
    expect(result.code).toBe(0);
    expect(await readFile(path.join(out, '.test-manager-output'), 'utf8')).toBe('v1\n');
    expect(await readFile(path.join(out, 'index.html'), 'utf8')).toContain('ドメインから確認内容をたどる');
  });

  it('reads current and previous TestRuns and generates the daily HTML and CSS', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-daily-'));
    const out = path.join(root, 'dashboard');
    const run = (runId: string, environment: string) => ({
      schemaVersion: 1, runId, attempt: 1, environment, commit: runId === 'current' ? '7f3a12c' : '6e2b11a', scopeId: 'daily-all',
      startedAt: '2026-09-13T00:00:00Z', completedAt: '2026-09-13T00:01:00Z', ciUrl: `https://example.com/${runId}`,
      units: [{
        state: 'completed', unitId: 'vitest-unit', runner: 'vitest', layer: 'unit', target: 'node', plannedCaseIds: ['CASE-001', 'CASE-002'],
        observations: ['CASE-001', 'CASE-002'].map((caseId) => ({ caseId, expected: 'passed', attemptCoverage: { kind: 'complete' }, attempts: [{ outcome: 'passed', durationMs: 10, startedAt: '2026-09-13T00:00:01Z', artifactRefs: [] }] })),
      }],
    });
    const current = path.join(root, 'current.json');
    const previous = path.join(root, 'previous.json');
    await writeFile(current, JSON.stringify(run('current', 'dev')));
    await writeFile(previous, JSON.stringify(run('previous', 'staging')));
    const result = await runCliDaily(['--current-run', current, '--previous-run', previous, '--out', out]);
    expect(result.code).toBe(0);
    expect(await readFile(path.join(out, '.test-manager-output'), 'utf8')).toBe('daily-v1\n');
    expect(await readFile(path.join(out, 'index.html'), 'utf8')).toContain('同じ環境の前回実行がないため比較できません');
    expect(await readFile(path.join(out, 'assets/dashboard.css'), 'utf8')).toContain('.domain-table-head');
  });

  it('assembles a current TestRun from manifest and unit artifacts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-assembly-'));
    const out = path.join(root, 'dashboard');
    const manifestPath = path.join(root, 'manifest.json');
    const artifactPath = path.join(root, 'vitest.test-manager-unit.json');
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1, runId: 'current', attempt: 1, environment: 'dev', commit: '7f3a12c', scopeId: 'daily-all',
      startedAt: '2026-09-13T00:00:00Z', ciUrl: 'https://example.com/current',
      units: [{ unitId: 'vitest-unit', runner: 'vitest', layer: 'unit', target: 'node', plannedCaseIds: ['CASE-001', 'CASE-002'] }],
    }));
    await writeFile(artifactPath, JSON.stringify({
      state: 'incomplete', reason: 'runnerError', unitId: 'vitest-unit', observations: [{
        caseId: 'CASE-001', expected: 'passed', attemptCoverage: { kind: 'complete' },
        attempts: [{ outcome: 'passed', durationMs: 10, startedAt: '2026-09-13T00:00:01Z', artifactRefs: [] }],
      }],
    }));
    const result = await runCliDaily([
      '--manifest', manifestPath, '--completed-at', '2026-09-13T00:01:00Z', '--unit-artifact', artifactPath, '--out', out,
    ]);
    expect(result.code).toBe(0);
    expect(await readFile(path.join(out, 'index.html'), 'utf8')).toContain('1件の結果が欠損しています');
  });

  it('refuses unsafe CI URLs and an output directory not owned by test-manager', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-safe-'));
    const current = path.join(root, 'current.json');
    const out = path.join(root, 'existing');
    await mkdir(out);
    await writeFile(path.join(out, 'keep.txt'), 'do not replace');
    await writeFile(current, JSON.stringify({ schemaVersion: 1, runId: 'x', attempt: 1, environment: 'dev', commit: '7f3a12c', scopeId: 'daily-all', startedAt: '2026-09-13T00:00:00Z', completedAt: '2026-09-13T00:01:00Z', ciUrl: 'file:///etc/passwd', units: [] }));
    expect((await runCliDaily(['--current-run', current, '--out', path.join(root, 'new')])).code).toBe(1);
    const valid = JSON.parse(await readFile(current, 'utf8'));
    await writeFile(current, JSON.stringify({ ...valid, ciUrl: 'https://example.com/run', units: [{ state: 'incomplete', reason: 'artifactMissing', unitId: 'u', runner: 'vitest', layer: 'unit', target: 'node', plannedCaseIds: ['CASE-001'], observations: [] }] }));
    expect((await runCliDaily(['--current-run', current, '--out', out])).code).toBe(1);
    expect(await readFile(path.join(out, 'keep.txt'), 'utf8')).toBe('do not replace');
  });

  it('builds a release catalog difference screen from production and staging inputs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-release-'));
    const out = path.join(root, 'release');
    const productionDirectory = path.join(root, 'production-snapshot');
    const stagingDirectory = path.join(root, 'staging-snapshot');
    expect((await run(['snapshot', '--config', 'fixtures/quality-dashboard/test-manager.yaml', '--commit', '6e2b11a', '--out', productionDirectory])).code).toBe(0);
    expect((await run(['snapshot', '--config', 'fixtures/quality-dashboard/test-manager.yaml', '--commit', '7f3a12c', '--out', stagingDirectory])).code).toBe(0);
    const productionSnapshot = path.join(productionDirectory, 'release-catalog.json');
    const stagingSnapshot = path.join(stagingDirectory, 'release-catalog.json');
    const previous: unknown = JSON.parse(await readFile(productionSnapshot, 'utf8'));
    const parsedPrevious = parseReleaseCatalogSnapshot(previous);
    if (!parsedPrevious.success) throw new Error('generated release snapshot must parse');
    await writeFile(productionSnapshot, JSON.stringify({ ...parsedPrevious.data, cases: parsedPrevious.data.cases.filter((item) => item.id !== 'CASE-101' && item.id !== 'CASE-110') }));
    const result = await run([
      'release',
      '--production-snapshot', productionSnapshot,
      '--staging-snapshot', stagingSnapshot,
      '--out', out,
    ]);
    expect(result.code).toBe(0);
    const html = await readFile(path.join(out, 'release.html'), 'utf8');
    expect(html).toContain('前回productionからの変更');
    expect(html).toContain('CASE-101');
    expect(html).toContain('CASE-110');
    expect(html).not.toContain('リリース可能');
  });

  it('publishes daily, release, and catalog as one navigable site', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-dashboard-'));
    const out = path.join(root, 'site');
    const productionDirectory = path.join(root, 'production');
    const stagingDirectory = path.join(root, 'staging');
    await run(['snapshot', '--config', 'fixtures/quality-dashboard/test-manager.yaml', '--commit', '6e2b11a', '--out', productionDirectory]);
    await run(['snapshot', '--config', 'fixtures/quality-dashboard/test-manager.yaml', '--commit', '7f3a12c', '--out', stagingDirectory]);
    const currentRun = path.join(root, 'current.json');
    await writeFile(currentRun, JSON.stringify({
      schemaVersion: 1, runId: 'current', attempt: 1, environment: 'dev', commit: '7f3a12c', scopeId: 'daily-all',
      startedAt: '2026-09-13T00:00:00Z', completedAt: '2026-09-13T00:01:00Z', ciUrl: 'https://example.com/current',
      units: [{
        state: 'completed', unitId: 'vitest-unit', runner: 'vitest', layer: 'unit', target: 'node', plannedCaseIds: ['CASE-101'],
        observations: [{ caseId: 'CASE-101', expected: 'passed', attemptCoverage: { kind: 'complete' }, attempts: [{ outcome: 'passed', durationMs: 10, startedAt: '2026-09-13T00:00:01Z', artifactRefs: [] }] }],
      }],
    }));

    const result = await run([
      'dashboard', '--config', 'fixtures/quality-dashboard/test-manager.yaml', '--current-run', currentRun,
      '--production-snapshot', path.join(productionDirectory, 'release-catalog.json'),
      '--staging-snapshot', path.join(stagingDirectory, 'release-catalog.json'),
      '--out', out,
    ]);

    expect(result.code).toBe(0);
    expect(await readFile(path.join(out, '.test-manager-output'), 'utf8')).toBe('quality-site-v1\n');
    expect(await readFile(path.join(out, 'index.html'), 'utf8')).toContain('href="catalog/cases/index.html"');
    expect(await readFile(path.join(out, 'release.html'), 'utf8')).toContain('前回productionからの変更');
    expect(await readFile(path.join(out, 'catalog/index.html'), 'utf8')).toContain('ドメインから確認内容をたどる');
  });

  it('rejects a dashboard whose live catalog differs from its staging snapshot', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-dashboard-mismatch-'));
    const productionDirectory = path.join(root, 'production');
    const stagingDirectory = path.join(root, 'staging');
    await run(['snapshot', '--config', 'fixtures/quality-dashboard/test-manager.yaml', '--commit', '6e2b11a', '--out', productionDirectory]);
    await run(['snapshot', '--config', 'fixtures/quality-dashboard/test-manager.yaml', '--commit', '7f3a12c', '--out', stagingDirectory]);
    const stagingPath = path.join(stagingDirectory, 'release-catalog.json');
    const staging: unknown = JSON.parse(await readFile(stagingPath, 'utf8'));
    const parsed = parseReleaseCatalogSnapshot(staging);
    if (!parsed.success) throw new Error('staging fixture must parse');
    await writeFile(stagingPath, JSON.stringify({
      ...parsed.data,
      cases: parsed.data.cases.map((managedCase, index) => index === 0 ? { ...managedCase, title: 'different title' } : managedCase),
    }));
    const currentRun = path.join(root, 'current.json');
    await writeFile(currentRun, JSON.stringify({
      schemaVersion: 1, runId: 'current', attempt: 1, environment: 'dev', commit: '7f3a12c', scopeId: 'daily-all',
      startedAt: '2026-09-13T00:00:00Z', completedAt: '2026-09-13T00:01:00Z', ciUrl: 'https://example.com/current',
      units: [{ state: 'incomplete', reason: 'artifactMissing', unitId: 'u', runner: 'vitest', layer: 'unit', target: 'node', plannedCaseIds: ['CASE-101'], observations: [] }],
    }));

    const result = await run([
      'dashboard', '--config', 'fixtures/quality-dashboard/test-manager.yaml', '--current-run', currentRun,
      '--production-snapshot', path.join(productionDirectory, 'release-catalog.json'), '--staging-snapshot', stagingPath,
      '--out', path.join(root, 'site'),
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('staging catalog snapshot does not match the configured catalog');
  });
});

const runCliDaily = (args: ReadonlyArray<string>) => run([
  'daily', '--config', 'fixtures/valid/test-manager.yaml',
  ...args,
]);
