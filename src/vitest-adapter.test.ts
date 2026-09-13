import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestManagerVitestReporter, toVitestUnit } from './vitest-adapter.js';

describe('Vitest result adapter', () => {
  it('converts public Vitest result data without inventing retry attempts', () => {
    const result = toVitestUnit({
      unitId: 'vitest-unit-node',
      layer: 'unit',
      target: 'node',
      completion: { state: 'completed' },
      tests: [{
        caseId: 'CASE-001',
        state: 'passed',
        mode: 'run',
        fails: false,
        durationMs: 18,
        startedAt: 1_789_257_601_000,
        retryCount: 2,
        flaky: true,
        syntaxError: false,
        artifactRefs: [],
      }],
    }, /^(?:CASE-[0-9]{3})$/u);

    expect(result.success).toBe(true);
    if (!result.success || result.data.state !== 'completed') return;
    expect(result.data.observations[0]).toMatchObject({
      caseId: 'CASE-001',
      expected: 'passed',
      attemptCoverage: { kind: 'finalOnly', retryCount: 2, flaky: true },
      attempts: [{ outcome: 'passed', durationMs: 18 }],
    });
  });

  it('preserves the distinction between expected failure and unexpected pass', () => {
    const expectedFailure = toVitestUnit({
      unitId: 'vitest-unit-node', layer: 'unit', target: 'node',
      completion: { state: 'completed' },
      tests: [{ caseId: 'CASE-001', state: 'passed', mode: 'run', fails: true, durationMs: 10, startedAt: 1_789_257_601_000, retryCount: 0, flaky: false, syntaxError: false, artifactRefs: [] }],
    }, /^(?:CASE-[0-9]{3})$/u);
    const unexpectedPass = toVitestUnit({
      unitId: 'vitest-unit-node', layer: 'unit', target: 'node',
      completion: { state: 'completed' },
      tests: [{ caseId: 'CASE-001', state: 'failed', mode: 'run', fails: true, durationMs: 10, startedAt: 1_789_257_601_000, retryCount: 0, flaky: false, syntaxError: false, artifactRefs: [] }],
    }, /^(?:CASE-[0-9]{3})$/u);

    expect(expectedFailure.success && expectedFailure.data.state === 'completed' && expectedFailure.data.observations[0]?.attempts[0]?.outcome).toBe('failed');
    expect(unexpectedPass.success && unexpectedPass.data.state === 'completed' && unexpectedPass.data.observations[0]?.attempts[0]?.outcome).toBe('passed');
  });

  it('rejects missing and duplicate case IDs at the adapter boundary', () => {
    const test = { caseId: 'CASE-001', state: 'passed' as const, mode: 'run' as const, fails: false, durationMs: 10, startedAt: 1_789_257_601_000, retryCount: 0, flaky: false, syntaxError: false, artifactRefs: [] };
    expect(toVitestUnit({ unitId: 'vitest', layer: 'unit', target: 'node', completion: { state: 'completed' }, tests: [{ ...test, caseId: undefined }] }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
    expect(toVitestUnit({ unitId: 'vitest', layer: 'unit', target: 'node', completion: { state: 'completed' }, tests: [test, test] }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
    expect(toVitestUnit({ unitId: 'vitest', layer: 'unit', target: 'node', completion: { state: 'completed' }, tests: [{ ...test, startedAt: Number.MAX_SAFE_INTEGER }] }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
  });

  it('keeps observed results when a run ends before every planned case finishes', () => {
    const result = toVitestUnit({
      unitId: 'vitest', layer: 'unit', target: 'node',
      completion: { state: 'incomplete', reason: 'cancelled' },
      tests: [
        { caseId: 'CASE-001', state: 'passed', mode: 'run', fails: false, durationMs: 10, startedAt: 1_789_257_601_000, retryCount: 0, flaky: false, syntaxError: false, artifactRefs: [] },
        { caseId: 'CASE-002', state: 'pending', mode: 'run', fails: false, artifactRefs: [] },
      ],
    }, /^(?:CASE-[0-9]{3})$/u);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      state: 'incomplete',
      plannedCaseIds: ['CASE-001', 'CASE-002'],
      observations: [{ caseId: 'CASE-001' }],
    });
  });

  it('does not turn a test.fails syntax error into an unexpected pass', () => {
    const result = toVitestUnit({
      unitId: 'vitest', layer: 'unit', target: 'node', completion: { state: 'completed' },
      tests: [{ caseId: 'CASE-001', state: 'failed', mode: 'run', fails: true, durationMs: 10, startedAt: 1_789_257_601_000, retryCount: 0, flaky: false, syntaxError: true, artifactRefs: [] }],
    }, /^(?:CASE-[0-9]{3})$/u);
    expect(result.success && result.data.state === 'completed' && result.data.observations[0]?.attempts[0]?.outcome).toBe('failed');
  });

  it('collects Vitest reporter events and writes a normalized unit artifact', async () => {
    const outputFile = path.resolve('/tmp', `test-manager-vitest-${process.pid}.json`);
    const reporter = new TestManagerVitestReporter({
      outputFile, unitId: 'vitest-unit-node', layer: 'unit', target: 'node', idPattern: /^(?:CASE-[0-9]{3})$/u,
    });
    const pending = {
      id: 'test-1', options: { mode: 'run' as const, fails: false },
      meta: () => ({ caseId: 'CASE-001' }), result: () => ({ state: 'pending' as const }),
      diagnostic: () => undefined, artifacts: () => [],
    };
    reporter.onTestCaseReady(pending);
    reporter.onTestCaseResult({
      ...pending,
      result: () => ({ state: 'passed' as const, errors: undefined }),
      diagnostic: () => ({ duration: 18, startTime: 1_789_257_601_000, retryCount: 1, flaky: true }),
    });
    await reporter.onTestRunEnd([], [], 'passed');

    const artifact: unknown = JSON.parse(await readFile(outputFile, 'utf8'));
    expect(artifact).toMatchObject({
      state: 'completed', unitId: 'vitest-unit-node',
      observations: [{ caseId: 'CASE-001', attemptCoverage: { kind: 'finalOnly', retryCount: 1, flaky: true } }],
    });
    expect(artifact).not.toHaveProperty('runner');
    expect(artifact).not.toHaveProperty('plannedCaseIds');
  });
});
