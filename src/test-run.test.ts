import { describe, expect, expectTypeOf, it } from 'vitest';
import { parseTestRun } from './test-run.js';
import type { CaseObservation, TestRun, TestRunUnit } from './test-run.js';

const completedUnit = {
  state: 'completed',
  unitId: 'vitest-unit-node',
  runner: 'vitest',
  layer: 'unit',
  target: 'node',
  plannedCaseIds: ['CASE-001', 'CASE-002'],
  observations: [{
    caseId: 'CASE-001',
    expected: 'passed',
    attemptCoverage: { kind: 'complete' },
    attempts: [{ outcome: 'passed', durationMs: 18, startedAt: '2026-09-13T00:00:01Z', artifactRefs: [] }],
  }, {
    caseId: 'CASE-002',
    expected: 'passed',
    attemptCoverage: { kind: 'complete' },
    attempts: [{ outcome: 'passed', durationMs: 12, startedAt: '2026-09-13T00:00:02Z', artifactRefs: [] }],
  }],
} as const;

const input = {
  schemaVersion: 1,
  runId: '1842',
  attempt: 1,
  environment: 'dev',
  commit: '7f3a12c',
  scopeId: 'daily-all',
  startedAt: '2026-09-13T00:00:00Z',
  completedAt: '2026-09-13T00:01:00Z',
  ciUrl: 'https://github.com/example/project/actions/runs/1842',
  units: [completedUnit],
} as const;

describe('normalized test run', () => {
  it('parses a complete runner-independent run at the boundary', () => {
    const result = parseTestRun(input, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.units[0]?.state).toBe('completed');
    expectTypeOf(result.data).toEqualTypeOf<TestRun>();
  });

  it('models completed and incomplete units as exclusive states', () => {
    expectTypeOf<Extract<TestRunUnit, { state: 'completed' }>>().toHaveProperty('observations');
    expectTypeOf<Extract<TestRunUnit, { state: 'incomplete' }>>().toHaveProperty('reason');
    expectTypeOf<CaseObservation['attempts']>().toMatchTypeOf<readonly [unknown, ...unknown[]]>();
  });

  it('retains summary-only retry evidence without pretending to know every attempt', () => {
    const result = parseTestRun({
      ...input,
      units: [{
        ...completedUnit,
        observations: [{
          ...completedUnit.observations[0],
          attemptCoverage: { kind: 'finalOnly', retryCount: 2, flaky: true },
        }, completedUnit.observations[1]],
      }],
    }, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success).toBe(true);
  });

  it('rejects duplicate plans and observations outside the discovered plan', () => {
    const result = parseTestRun({
      ...input,
      units: [{ ...completedUnit, plannedCaseIds: ['CASE-001', 'CASE-001'], observations: [{ ...completedUnit.observations[0], caseId: 'CASE-999' }] }],
    }, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      'plannedCaseIds must be unique',
      'observation CASE-999 is not in plannedCaseIds',
    ]));
  });

  it('rejects a completed unit when any planned case lacks an observation', () => {
    const result = parseTestRun({
      ...input,
      units: [{ ...completedUnit, observations: [completedUnit.observations[0]] }],
    }, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((item) => item.message === 'completed units must observe every planned case')).toBe(true);
  });

  it('rejects nullable attempts and mixed unit states', () => {
    const result = parseTestRun({
      ...input,
      units: [{ ...completedUnit, attempts: null, reason: 'runnerError' }],
    }, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success).toBe(false);
  });

  it('requires incomplete units to retain their planned cases', () => {
    const result = parseTestRun({
      ...input,
      units: [{
        state: 'incomplete',
        unitId: 'playwright-e2e-chromium',
        runner: 'playwright',
        layer: 'E2E',
        target: 'chromium',
        reason: 'runnerError',
        plannedCaseIds: ['CASE-001', 'CASE-002'],
        observations: [completedUnit.observations[0]],
      }],
    }, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success).toBe(true);
  });

  it('rejects a case planned by more than one unit in the same run', () => {
    const result = parseTestRun({
      ...input,
      units: [completedUnit, { ...completedUnit, unitId: 'duplicate-unit' }],
    }, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.message === 'planned case IDs must be unique within a run')).toBe(true);
  });
});
