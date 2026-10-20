import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseTestRunManifest } from './test-run-assembly.js';

const executeFile = promisify(execFile);
const generator = path.resolve('examples/github-actions/create-manifest.mjs');
const assembler = path.resolve('examples/github-actions/assemble-run.mjs');
const reporterHelpers = path.resolve('examples/github-actions/reporters.mjs');

describe('GitHub Actions consumer template', () => {
  it('creates a validated manifest from catalog cases and explicit non-secret CI values', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-ci-template-'));
    const catalogFile = path.join(root, 'catalog.json');
    const outputFile = path.join(root, 'manifest.json');
    await writeFile(catalogFile, JSON.stringify({
      cases: [
        { id: 'CASE-001', source: 'vitest', layer: 'unit' },
        { id: 'CASE-002', source: 'playwright', layer: 'e2e' },
        { id: 'CASE-003', source: 'manual', layer: 'e2e' },
      ],
    }), 'utf8');

    await executeFile(process.execPath, [generator, '--catalog', catalogFile, '--id-pattern', '^CASE-[0-9]{3}$', '--out', outputFile], {
      env: {
        PATH: process.env.PATH,
        TM_TOOL_DIR: path.resolve('.'),
        TM_RUN_ID: '1842',
        TM_RUN_ATTEMPT: '2',
        TM_ENVIRONMENT: 'staging',
        TM_COMMIT: '7f3a12c',
        TM_SCOPE_ID: 'daily-all',
        TM_STARTED_AT: '2026-09-16T00:00:00Z',
        TM_CI_URL: 'https://github.com/example/project/actions/runs/1842',
        TM_VITEST_UNIT_ID: 'vitest-unit-node',
        TM_VITEST_LAYER: 'unit',
        TM_VITEST_TARGET: 'node',
        TM_PLAYWRIGHT_UNIT_ID: 'playwright-e2e-chromium',
        TM_PLAYWRIGHT_TARGET: 'chromium',
        GITHUB_TOKEN: 'must-not-be-saved',
      },
    });

    const source = await readFile(outputFile, 'utf8');
    const parsed = parseTestRunManifest(JSON.parse(source), /^CASE-[0-9]{3}$/u);
    expect(parsed.success).toBe(true);
    expect(source).not.toContain('must-not-be-saved');
    if (!parsed.success) return;
    expect(parsed.data.units).toEqual([
      { unitId: 'vitest-unit-node', runner: 'vitest', layer: 'unit', target: 'node', plannedCaseIds: ['CASE-001'] },
      { unitId: 'playwright-e2e-chromium', runner: 'playwright', layer: 'e2e', target: 'chromium', plannedCaseIds: ['CASE-002'] },
    ]);
  });

  it('refuses to merge one runner across several catalog layers into a single unit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-ci-template-layers-'));
    const catalogFile = path.join(root, 'catalog.json');
    const outputFile = path.join(root, 'manifest.json');
    await writeFile(catalogFile, JSON.stringify({ cases: [{ id: 'CASE-001', source: 'vitest', layer: 'unit' }, { id: 'CASE-002', source: 'vitest', layer: 'integration' }] }), 'utf8');
    await expect(executeFile(process.execPath, [generator, '--catalog', catalogFile, '--id-pattern', '^CASE-[0-9]{3}$', '--out', outputFile], {
      env: {
        PATH: process.env.PATH, TM_TOOL_DIR: path.resolve('.'), TM_RUN_ID: '1842', TM_RUN_ATTEMPT: '1', TM_ENVIRONMENT: 'staging', TM_COMMIT: '7f3a12c',
        TM_SCOPE_ID: 'daily-all', TM_STARTED_AT: '2026-09-16T00:00:00Z', TM_CI_URL: 'https://github.com/example/project/actions/runs/1842',
        TM_VITEST_UNIT_ID: 'vitest-unit-node', TM_VITEST_TARGET: 'node',
      },
    })).rejects.toThrow(/span layers unit, integration/u);
    await expect(readFile(outputFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails before writing when required explicit CI values are missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-ci-template-invalid-'));
    const catalogFile = path.join(root, 'catalog.json');
    const outputFile = path.join(root, 'manifest.json');
    await writeFile(catalogFile, JSON.stringify({ cases: [{ id: 'CASE-001', source: 'vitest', layer: 'unit' }] }), 'utf8');

    await expect(executeFile(process.execPath, [generator, '--catalog', catalogFile, '--id-pattern', '^CASE-[0-9]{3}$', '--out', outputFile], {
      env: { PATH: process.env.PATH, TM_TOOL_DIR: path.resolve('.') },
    })).rejects.toThrow();
  });

  it('rejects an invalid manifest before writing it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-ci-template-invalid-manifest-'));
    const catalogFile = path.join(root, 'catalog.json');
    const outputFile = path.join(root, 'manifest.json');
    await writeFile(catalogFile, JSON.stringify({ cases: [{ id: 'CASE-001', source: 'vitest', layer: 'unit' }] }), 'utf8');

    await expect(executeFile(process.execPath, [generator, '--catalog', catalogFile, '--id-pattern', '^CASE-[0-9]{3}$', '--out', outputFile], {
      env: {
        PATH: process.env.PATH,
        TM_TOOL_DIR: path.resolve('.'),
        TM_RUN_ID: '1842',
        TM_RUN_ATTEMPT: '1',
        TM_ENVIRONMENT: 'not valid',
        TM_COMMIT: '7f3a12c',
        TM_SCOPE_ID: '../scope',
        TM_STARTED_AT: '2026-09-16T00:00:00Z',
        TM_CI_URL: 'https://github.com/example/project/actions/runs/1842',
        TM_VITEST_UNIT_ID: '../unit',
        TM_VITEST_LAYER: 'unit',
        TM_VITEST_TARGET: 'node',
      },
    })).rejects.toThrow(/invalid manifest/u);
    await expect(readFile(outputFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('assembles existing unit artifacts and preserves a missing unit as artifactMissing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-ci-assembly-'));
    const manifestFile = path.join(root, 'manifest.json');
    const artifactDirectory = path.join(root, 'unit-artifacts');
    const outputFile = path.join(root, 'test-run.json');
    await writeFile(manifestFile, JSON.stringify({
      schemaVersion: 1,
      runId: '1842',
      attempt: 1,
      environment: 'staging',
      commit: '7f3a12c',
      scopeId: 'daily-all',
      startedAt: '2026-09-16T00:00:00Z',
      ciUrl: 'https://github.com/example/project/actions/runs/1842',
      units: [
        { unitId: 'vitest-unit-node', runner: 'vitest', layer: 'unit', target: 'node', plannedCaseIds: ['CASE-001'] },
        { unitId: 'playwright-e2e-chromium', runner: 'playwright', layer: 'e2e', target: 'chromium', plannedCaseIds: ['CASE-002'] },
      ],
    }), 'utf8');
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(path.join(artifactDirectory, 'vitest-unit-node.test-manager-unit.json'), JSON.stringify({
      state: 'completed',
      unitId: 'vitest-unit-node',
      observations: [{
        caseId: 'CASE-001', expected: 'passed', attemptCoverage: { kind: 'complete' },
        attempts: [{ outcome: 'passed', durationMs: 10, startedAt: '2026-09-16T00:00:01Z', artifactRefs: [] }],
      }],
    }), 'utf8');

    await executeFile(process.execPath, [
      assembler,
      '--manifest', manifestFile,
      '--artifact-directory', artifactDirectory,
      '--completed-at', '2026-09-16T00:01:00Z',
      '--id-pattern', '^CASE-[0-9]{3}$',
      '--out', outputFile,
    ], { env: { PATH: process.env.PATH, TM_TOOL_DIR: path.resolve('.') } });

    const run = JSON.parse(await readFile(outputFile, 'utf8'));
    expect(run.units).toMatchObject([
      { state: 'completed', unitId: 'vitest-unit-node', observations: [{ caseId: 'CASE-001' }] },
      { state: 'incomplete', reason: 'artifactMissing', unitId: 'playwright-e2e-chromium', observations: [] },
    ]);
  });

  it('keeps reporter output and attachment paths inside the explicit CI state directory', async () => {
    const helpers = await import(pathToFileURL(reporterHelpers).href);
    const stateDirectory = path.resolve('/tmp/test-manager-state');
    const toolDirectory = path.resolve('/tmp/test-manager-tool');
    const vitest = helpers.testManagerVitestReporter({
      toolDirectory, stateDirectory, unitId: 'vitest-unit-node', layer: 'unit', target: 'node', idPattern: /^CASE-/u,
    });
    const playwright = helpers.testManagerPlaywrightReporter({
      toolDirectory, stateDirectory, unitId: 'playwright-e2e-chromium', idPattern: /^CASE-/u,
    });

    expect(vitest).toMatchObject([
      path.join(toolDirectory, 'dist/vitest-adapter.js'),
      {
        outputFile: path.join(stateDirectory, 'unit-artifacts/vitest-unit-node.test-manager-unit.json'),
        artifactRoot: path.join(stateDirectory, 'runner-artifacts'),
      },
    ]);
    expect(playwright).toMatchObject([
      path.join(toolDirectory, 'dist/playwright-adapter.js'),
      {
        outputDirectory: path.join(stateDirectory, 'unit-artifacts'),
        artifactRoot: path.join(stateDirectory, 'runner-artifacts'),
      },
    ]);

    expect(() => helpers.testManagerVitestReporter({
      toolDirectory, stateDirectory, unitId: '../outside', layer: 'unit', target: 'node', idPattern: /^CASE-/u,
    })).toThrow(/unitId/u);
  });

  it('pins the tool checkout, publishes the dashboard, and never serializes the GitHub context', async () => {
    const workflow = await readFile(path.resolve('examples/github-actions/test-manager.yml'), 'utf8');
    expect(workflow.match(/\^\[0-9a-f\]\{40\}\$/gu)).toHaveLength(2);
    expect(workflow).toContain('TM_PRODUCTION_DIR: ${{ runner.temp }}/test-manager-production');
    expect(workflow).toContain('git worktree add --detach "$TM_PRODUCTION_DIR" FETCH_HEAD');
    expect(workflow).not.toContain('path: production-source');
    expect(workflow).toContain('create-manifest.mjs');
    expect(workflow).toContain('playwright test --project=chromium');
    expect(workflow).toContain('assemble-run.mjs');
    expect(workflow).toContain('dashboard');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('continue-on-error: true');
    expect(workflow).not.toMatch(/toJson\s*\(\s*github\s*\)|GITHUB_TOKEN.*manifest/iu);
  });
});
