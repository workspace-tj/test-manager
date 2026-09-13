import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult, WorkerInfo } from '@playwright/test/reporter';
import { testRunUnitArtifactSchema } from './test-run-assembly.js';

const annotationSchema = z.strictObject({
  type: z.string(),
  description: z.string().optional(),
});

const playwrightCaseSchema = z.strictObject({
  id: z.string().min(1),
  expectedStatus: z.enum(['passed', 'failed', 'skipped']),
  annotations: z.array(annotationSchema),
}).superRefine((testCase, context) => {
  const caseIds = testCase.annotations.filter((annotation) => annotation.type === 'case-id');
  if (caseIds.length !== 1 || !caseIds[0]?.description) {
    context.addIssue({ code: 'custom', path: ['annotations'], message: 'Playwright cases require exactly one case-id annotation with a description' });
  }
});

const playwrightResultSchema = z.strictObject({
  status: z.enum(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']),
  retry: z.number().int().nonnegative(),
  duration: z.number().int().nonnegative(),
  startTime: z.date(),
  attachments: z.array(z.strictObject({
    name: z.string().min(1),
    path: z.string().min(1).optional(),
  })),
});

const playwrightUnitInputSchema = z.strictObject({
  unitId: z.string().min(1),
  completion: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('completed') }),
    z.strictObject({ state: z.literal('incomplete'), reason: z.enum(['cancelled', 'timedOut', 'runnerError']) }),
  ]),
  tests: z.array(z.strictObject({
    testCase: playwrightCaseSchema,
    results: z.array(playwrightResultSchema),
  })),
}).superRefine((unit, context) => {
  if (unit.completion.state === 'completed') {
    for (const [index, test] of unit.tests.entries()) {
      if (test.results.length === 0) context.addIssue({ code: 'custom', path: ['tests', index, 'results'], message: 'completed Playwright units require a result for every case' });
    }
  }
});

type PlaywrightCaseSource = Readonly<{
  id: string;
  expectedStatus: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  annotations: ReadonlyArray<Readonly<{ type: string; description?: string }>>;
}>;
type PlaywrightResultSource = Readonly<{
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  retry: number;
  duration: number;
  startTime: Date;
  attachments: ReadonlyArray<Readonly<{ name: string; path?: string }>>;
}>;

const caseIdFrom = (testCase: z.output<typeof playwrightCaseSchema>): string => {
  const annotation = testCase.annotations.find((candidate) => candidate.type === 'case-id');
  if (!annotation?.description) throw new Error('Validated Playwright case has no case-id annotation');
  return annotation.description;
};

export const toPlaywrightUnitArtifact = (input: unknown, idPattern: RegExp) => {
  const parsed = playwrightUnitInputSchema.safeParse(input);
  if (!parsed.success) return parsed;
  const observations = parsed.data.tests.flatMap(({ testCase, results }) => results.length === 0 ? [] : [{
    caseId: caseIdFrom(testCase),
    expected: testCase.expectedStatus,
    attemptCoverage: { kind: 'complete' as const },
    attempts: results
      .toSorted((left, right) => left.retry - right.retry)
      .map((result) => ({
        outcome: result.status,
        durationMs: result.duration,
        startedAt: result.startTime.toISOString(),
        artifactRefs: result.attachments.flatMap((attachment) => attachment.path === undefined ? [] : [attachment.path]),
      })),
  }]);
  return testRunUnitArtifactSchema(idPattern).safeParse({
    ...parsed.data.completion,
    unitId: parsed.data.unitId,
    observations,
  });
};

type PlaywrightSuiteSource = Readonly<{ allTests: () => ReadonlyArray<PlaywrightCaseSource> }>;
type PlaywrightFullResultSource = Readonly<{ status: 'passed' | 'failed' | 'timedout' | 'interrupted' }>;

export type TestManagerPlaywrightReporterOptions = Readonly<{
  outputDirectory: string;
  artifactRoot: string;
  unitId: string;
  idPattern: RegExp;
}>;

const projectCase = (testCase: TestCase | PlaywrightCaseSource): PlaywrightCaseSource => ({
  id: testCase.id,
  expectedStatus: testCase.expectedStatus,
  annotations: testCase.annotations.map((annotation) => ({
    type: annotation.type,
    ...(annotation.description === undefined ? {} : { description: annotation.description }),
  })),
});

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

const projectResult = (
  result: TestResult | PlaywrightResultSource,
  artifactRoot: string,
): PlaywrightResultSource => ({
  status: result.status,
  retry: result.retry,
  duration: result.duration,
  startTime: result.startTime,
  attachments: result.attachments.flatMap((attachment) => {
    if (attachment.path === undefined) return [];
    const absoluteRoot = path.resolve(artifactRoot);
    const absoluteAttachment = path.resolve(attachment.path);
    if (!isWithin(absoluteRoot, absoluteAttachment)) throw new Error(`Playwright attachment is outside artifactRoot: ${attachment.name}`);
    return [{ name: attachment.name, path: path.relative(absoluteRoot, absoluteAttachment).split(path.sep).join('/') }];
  }),
});

export class TestManagerPlaywrightReporter implements Reporter {
  readonly #options: TestManagerPlaywrightReporterOptions;
  readonly #tests = new Map<string, { testCase: PlaywrightCaseSource; results: Array<PlaywrightResultSource> }>();
  #runnerError = false;

  constructor(options: TestManagerPlaywrightReporterOptions) {
    this.#options = options;
  }

  onBegin(_config: FullConfig | undefined, suite: Suite | PlaywrightSuiteSource): void {
    this.#tests.clear();
    this.#runnerError = false;
    for (const testCase of suite.allTests()) {
      const projected = projectCase(testCase);
      this.#tests.set(projected.id, { testCase: projected, results: [] });
    }
    this.#writeSnapshot({ state: 'incomplete', reason: 'runnerError' });
  }

  onTestEnd(testCase: TestCase | PlaywrightCaseSource, result: TestResult | PlaywrightResultSource): void {
    const projectedCase = projectCase(testCase);
    const collected = this.#tests.get(projectedCase.id) ?? { testCase: projectedCase, results: [] };
    collected.results.push(projectResult(result, this.#options.artifactRoot));
    this.#tests.set(projectedCase.id, collected);
    this.#writeSnapshot({ state: 'incomplete', reason: 'runnerError' });
  }

  onError(_error: TestError | Error, _workerInfo?: WorkerInfo): void {
    this.#runnerError = true;
  }

  onEnd(result: FullResult | PlaywrightFullResultSource): void {
    const completion = this.#runnerError
      ? { state: 'incomplete' as const, reason: 'runnerError' as const }
      : result.status === 'interrupted'
        ? { state: 'incomplete' as const, reason: 'cancelled' as const }
        : result.status === 'timedout'
          ? { state: 'incomplete' as const, reason: 'timedOut' as const }
          : { state: 'completed' as const };
    this.#writeSnapshot(completion);
  }

  printsToStdio(): boolean {
    return false;
  }

  #writeSnapshot(completion: Readonly<{ state: 'completed' } | { state: 'incomplete'; reason: 'cancelled' | 'timedOut' | 'runnerError' }>): void {
    const parsed = toPlaywrightUnitArtifact({
      unitId: this.#options.unitId,
      completion,
      tests: [...this.#tests.values()],
    }, this.#options.idPattern);
    if (!parsed.success) throw new Error(`Cannot create Playwright unit artifact: ${parsed.error.message}`);
    const outputDirectory = path.resolve(this.#options.outputDirectory);
    const unitId = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u).parse(this.#options.unitId);
    const outputFile = path.join(outputDirectory, `${unitId}.test-manager-unit.json`);
    if (!isWithin(outputDirectory, outputFile)) throw new Error('Playwright unit artifact path escapes outputDirectory');
    mkdirSync(outputDirectory, { recursive: true });
    const temporaryFile = path.join(outputDirectory, `.${unitId}.${process.pid}.tmp`);
    writeFileSync(temporaryFile, `${JSON.stringify(parsed.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryFile, outputFile);
  }
}

export default TestManagerPlaywrightReporter;
