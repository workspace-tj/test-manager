import { describe, expect, it } from 'vitest';
import { assembleTestRun, parseTestRunManifest } from './test-run-assembly.js';

const manifest = {
  schemaVersion: 1,
  runId: 'run-1842',
  attempt: 1,
  environment: 'staging',
  commit: '7f3a12c',
  scopeId: 'daily-all',
  startedAt: '2026-09-13T00:00:00Z',
  ciUrl: 'https://github.com/example/project/actions/runs/1842',
  units: [{
    unitId: 'vitest-unit-node',
    runner: 'vitest',
    layer: 'unit',
    target: 'node',
    plannedCaseIds: ['CASE-001'],
  }, {
    unitId: 'playwright-e2e-chromium',
    runner: 'playwright',
    layer: 'E2E',
    target: 'chromium',
    plannedCaseIds: ['CASE-002'],
  }],
} as const;

const vitestArtifact = {
  state: 'completed',
  unitId: manifest.units[0].unitId,
  observations: [{
    caseId: 'CASE-001', expected: 'passed', attemptCoverage: { kind: 'complete' },
    attempts: [{ outcome: 'passed', durationMs: 12, startedAt: '2026-09-13T00:00:01Z', artifactRefs: [] }],
  }],
} as const;

describe('TestRun assembly boundary', () => {
  it('parses only the allowlisted pre-run manifest fields', () => {
    expect(parseTestRunManifest(manifest, /^(?:CASE-[0-9]{3})$/u).success).toBe(true);
    expect(parseTestRunManifest({ ...manifest, github: { token: 'secret' } }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
  });

  it('assembles available artifacts and marks an absent artifact as artifactMissing', () => {
    const result = assembleTestRun({
      manifest,
      completedAt: '2026-09-13T00:01:00Z',
      unitArtifacts: [vitestArtifact],
    }, /^(?:CASE-[0-9]{3})$/u);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.units).toEqual([
      { ...manifest.units[0], ...vitestArtifact },
      {
        state: 'incomplete',
        ...manifest.units[1],
        reason: 'artifactMissing',
        observations: [],
      },
    ]);
  });

  it('retains an artifact-reported runnerError instead of relabeling it as missing', () => {
    const runnerErrorArtifact = {
      state: 'incomplete', reason: 'runnerError', unitId: manifest.units[1].unitId, observations: [],
    } as const;
    const result = assembleTestRun({
      manifest,
      completedAt: '2026-09-13T00:01:00Z',
      unitArtifacts: [vitestArtifact, runnerErrorArtifact],
    }, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success && result.data.units[1]).toMatchObject({ state: 'incomplete', reason: 'runnerError' });
  });

  it('rejects duplicate units, duplicate cross-unit cases, and artifacts outside the manifest', () => {
    expect(assembleTestRun({ manifest, completedAt: '2026-09-13T00:01:00Z', unitArtifacts: [vitestArtifact, vitestArtifact] }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
    expect(parseTestRunManifest({ ...manifest, units: [manifest.units[0], { ...manifest.units[1], plannedCaseIds: ['CASE-001'] }] }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
    expect(assembleTestRun({ manifest, completedAt: '2026-09-13T00:01:00Z', unitArtifacts: [{ ...vitestArtifact, unitId: 'unknown' }] }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
  });

  it('keeps partial observations from an incomplete artifact and takes its plan from the manifest', () => {
    const partialArtifact = { state: 'incomplete', reason: 'cancelled', unitId: manifest.units[0].unitId, observations: vitestArtifact.observations } as const;
    const result = assembleTestRun({ manifest, completedAt: '2026-09-13T00:01:00Z', unitArtifacts: [partialArtifact] }, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success && result.data.units[0]).toMatchObject({
      state: 'incomplete', reason: 'cancelled', plannedCaseIds: ['CASE-001'], observations: [{ caseId: 'CASE-001' }],
    });
  });

  it('rejects artifactMissing self-reports, undeclared observations, and reversed timestamps', () => {
    expect(assembleTestRun({ manifest, completedAt: '2026-09-13T00:01:00Z', unitArtifacts: [{ ...vitestArtifact, state: 'incomplete', reason: 'artifactMissing' }] }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
    expect(assembleTestRun({ manifest, completedAt: '2026-09-13T00:01:00Z', unitArtifacts: [{ ...vitestArtifact, observations: [{ ...vitestArtifact.observations[0], caseId: 'CASE-999' }] }] }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
    expect(assembleTestRun({ manifest, completedAt: '2026-09-12T23:59:59Z', unitArtifacts: [] }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
  });

  it('rejects malformed environment and scope identifiers at both manifest and TestRun boundaries', () => {
    for (const invalid of ['', '../production', 'prod environment', 'staging<script>']) {
      expect(parseTestRunManifest({ ...manifest, environment: invalid }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
      expect(parseTestRunManifest({ ...manifest, scopeId: invalid }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
    }
  });
});
