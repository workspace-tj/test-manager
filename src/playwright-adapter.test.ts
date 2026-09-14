import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestManagerPlaywrightReporter, toPlaywrightUnitArtifact } from './playwright-adapter.js';

const testCase = {
  id: 'pw-1',
  expectedStatus: 'passed',
  annotations: [{ type: 'case-id', description: 'CASE-001' }],
} as const;

const result = {
  status: 'passed', retry: 1, duration: 34, startTime: new Date('2026-09-13T00:00:01Z'),
  attachments: [{ name: 'trace', path: 'artifacts/trace.zip' }, { name: 'stdout' }],
} as const;

describe('Playwright result adapter', () => {
  it('normalizes expected/actual status, retries, timing, and attachment references', () => {
    const parsed = toPlaywrightUnitArtifact({
      unitId: 'playwright-e2e-chromium',
      completion: { state: 'completed' },
      tests: [{ testCase, results: [{ ...result, status: 'failed', retry: 0 }, result] }],
    }, /^(?:CASE-[0-9]{3})$/u);

    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.state !== 'completed') return;
    expect(parsed.data.observations).toEqual([{
      caseId: 'CASE-001', expected: 'passed', attemptCoverage: { kind: 'complete' },
      attempts: [
        { outcome: 'failed', durationMs: 34, startedAt: '2026-09-13T00:00:01.000Z', artifactRefs: ['artifacts/trace.zip'] },
        { outcome: 'passed', durationMs: 34, startedAt: '2026-09-13T00:00:01.000Z', artifactRefs: ['artifacts/trace.zip'] },
      ],
    }]);
  });

  it('maps timeout, skipped, and interrupted outcomes without leaking Playwright status names', () => {
    for (const [status, outcome] of [['timedOut', 'timedOut'], ['skipped', 'skipped'], ['interrupted', 'interrupted']] as const) {
      const parsed = toPlaywrightUnitArtifact({
        unitId: 'playwright', completion: { state: 'completed' },
        tests: [{ testCase, results: [{ ...result, status }] }],
      }, /^(?:CASE-[0-9]{3})$/u);
      expect(parsed.success && parsed.data.observations[0]?.attempts[0]?.outcome).toBe(outcome);
    }
  });

  it('takes the ID only from one valid case-id annotation', () => {
    for (const annotations of [
      [],
      [{ type: 'case-id' }],
      [{ type: 'case-id', description: 'CASE-001' }, { type: 'case-id', description: 'CASE-002' }],
      [{ type: 'case-id', description: 'not-a-case' }],
    ]) {
      expect(toPlaywrightUnitArtifact({
        unitId: 'playwright', completion: { state: 'completed' },
        tests: [{ testCase: { ...testCase, annotations }, results: [result] }],
      }, /^(?:CASE-[0-9]{3})$/u).success).toBe(false);
    }
  });

  it('retains collected observations when the unit ends early', () => {
    const parsed = toPlaywrightUnitArtifact({
      unitId: 'playwright', completion: { state: 'incomplete', reason: 'cancelled' },
      tests: [{ testCase, results: [result] }],
    }, /^(?:CASE-[0-9]{3})$/u);
    expect(parsed.success && parsed.data).toMatchObject({
      state: 'incomplete', reason: 'cancelled', observations: [{ caseId: 'CASE-001' }],
    });
  });

  it('collects Reporter events and writes the common unit artifact contract', async () => {
    const unitId = `playwright-e2e-${process.pid}`;
    const outputFile = path.resolve('/tmp', `${unitId}.test-manager-unit.json`);
    const reporter = new TestManagerPlaywrightReporter({
      outputDirectory: '/tmp', artifactRoot: '/tmp', unitId, idPattern: /^(?:CASE-[0-9]{3})$/u,
    });
    reporter.onBegin(undefined, { allTests: () => [testCase] });
    reporter.onTestEnd(testCase, { ...result, attachments: [{ name: 'trace', path: '/tmp/artifacts/trace.zip' }] });
    await reporter.onEnd({ status: 'passed' });

    const artifact: unknown = JSON.parse(await readFile(outputFile, 'utf8'));
    expect(artifact).toMatchObject({
      state: 'completed', unitId,
      observations: [{ caseId: 'CASE-001', attempts: [{ outcome: 'passed' }] }],
    });
    expect(artifact).not.toHaveProperty('runner');
  });

  it('marks interrupted and runner-error endings incomplete while keeping prior results', async () => {
    for (const [endStatus, error, reason] of [
      ['interrupted', undefined, 'cancelled'],
      ['timedout', undefined, 'timedOut'],
      ['failed', new Error('worker crashed'), 'runnerError'],
    ] as const) {
      const unitId = `playwright-${reason}-${process.pid}`;
      const outputFile = path.resolve('/tmp', `${unitId}.test-manager-unit.json`);
      const reporter = new TestManagerPlaywrightReporter({ outputDirectory: '/tmp', artifactRoot: '/tmp', unitId, idPattern: /^(?:CASE-[0-9]{3})$/u });
      reporter.onBegin(undefined, { allTests: () => [testCase] });
      reporter.onTestEnd(testCase, { ...result, attachments: [{ name: 'trace', path: '/tmp/artifacts/trace.zip' }] });
      if (error) reporter.onError(error);
      await reporter.onEnd({ status: endStatus });
      const artifact: unknown = JSON.parse(await readFile(outputFile, 'utf8'));
      expect(artifact).toMatchObject({ state: 'incomplete', reason, observations: [{ caseId: 'CASE-001' }] });
    }
  });

  it('projects richer Reporter objects and persists an atomic incomplete snapshot before onEnd', async () => {
    const unitId = `playwright-snapshot-${process.pid}`;
    const outputFile = path.resolve('/tmp', `${unitId}.test-manager-unit.json`);
    const reporter = new TestManagerPlaywrightReporter({ outputDirectory: '/tmp', artifactRoot: '/tmp', unitId, idPattern: /^(?:CASE-[0-9]{3})$/u });
    const richerCase = { ...testCase, title: 'checkout works', location: { file: '/repo/e2e.spec.ts', line: 1, column: 1 } };
    const richerResult = {
      ...result,
      attachments: [{ name: 'trace', path: '/tmp/artifacts/trace.zip', contentType: 'application/zip' }],
      errors: [], stdout: [], stderr: [], steps: [], workerIndex: 0,
    };
    reporter.onBegin(undefined, { allTests: () => [richerCase] });
    reporter.onTestEnd(richerCase, richerResult);

    const snapshot: unknown = JSON.parse(await readFile(outputFile, 'utf8'));
    expect(snapshot).toMatchObject({ state: 'incomplete', reason: 'runnerError', observations: [{ caseId: 'CASE-001' }] });
    expect(JSON.stringify(snapshot)).not.toContain('checkout works');
    expect(JSON.stringify(snapshot)).not.toContain('/repo/e2e.spec.ts');
  });

  it('rejects attachment paths outside the configured artifact root', () => {
    const reporter = new TestManagerPlaywrightReporter({
      outputDirectory: '/tmp', artifactRoot: '/tmp/test-manager-artifacts', unitId: `playwright-safe-${process.pid}`, idPattern: /^(?:CASE-[0-9]{3})$/u,
    });
    reporter.onBegin(undefined, { allTests: () => [testCase] });
    expect(() => reporter.onTestEnd(testCase, { ...result, attachments: [{ name: 'trace', path: '/tmp/outside.zip' }] })).toThrow('outside artifactRoot');
  });
});
