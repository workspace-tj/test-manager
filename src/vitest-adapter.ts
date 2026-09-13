import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Reporter, SerializedError, TestCase, TestModule, TestRunEndReason } from 'vitest/node';
import { testRunUnitSchema } from './test-run.js';

const completedVitestCaseSchema = z.strictObject({
  caseId: z.string().min(1),
  state: z.enum(['passed', 'failed', 'skipped']),
  mode: z.enum(['run', 'only', 'skip', 'todo']),
  fails: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().refine((value) => !Number.isNaN(new Date(value).getTime()), 'startedAt must be a valid Unix timestamp in milliseconds'),
  retryCount: z.number().int().nonnegative(),
  flaky: z.boolean(),
  syntaxError: z.boolean(),
  artifactRefs: z.array(z.string().min(1)),
});

const pendingVitestCaseSchema = z.strictObject({
  caseId: z.string().min(1),
  state: z.literal('pending'),
  mode: z.enum(['run', 'only', 'skip', 'todo']),
  fails: z.boolean(),
  artifactRefs: z.array(z.string().min(1)),
});

const vitestCaseSchema = z.discriminatedUnion('state', [completedVitestCaseSchema, pendingVitestCaseSchema]);

const vitestUnitInputSchema = z.strictObject({
  unitId: z.string().min(1),
  layer: z.string().min(1),
  target: z.string().min(1),
  completion: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('completed') }),
    z.strictObject({ state: z.literal('incomplete'), reason: z.enum(['cancelled', 'timedOut', 'runnerError', 'artifactMissing']) }),
  ]),
  tests: z.array(vitestCaseSchema).min(1),
}).superRefine((unit, context) => {
  if (unit.completion.state === 'completed' && unit.tests.some((testCase) => testCase.state === 'pending')) {
    context.addIssue({ code: 'custom', path: ['tests'], message: 'completed Vitest units cannot contain pending cases' });
  }
});

export type VitestUnitInput = z.input<typeof vitestUnitInputSchema>;

type VitestCaseSource = Readonly<{
  id: string;
  options: Readonly<{ mode: 'run' | 'only' | 'skip' | 'todo'; fails: boolean | undefined }>;
  meta: () => unknown;
  result: () => Readonly<
    | { state: 'pending' }
    | { state: 'passed' | 'failed'; errors: ReadonlyArray<Readonly<Record<string, unknown>>> | undefined }
    | { state: 'skipped' }
  >;
  diagnostic: () => Readonly<{ duration: number; startTime: number; retryCount: number; flaky: boolean }> | undefined;
  artifacts: () => ReadonlyArray<Readonly<{ attachments?: ReadonlyArray<Readonly<{ path?: string }>> }>>;
}>;

const metadataSchema = z.looseObject({ caseId: z.string().min(1) });

const hasSyntaxError = (errors: ReadonlyArray<Readonly<Record<string, unknown>>> | undefined): boolean =>
  errors?.some((error) => error.__vitest_test_syntax_error__ === true || error.name === 'TestSyntaxError') ?? false;

const artifactRefs = (testCase: VitestCaseSource): ReadonlyArray<string> => testCase.artifacts()
  .flatMap((artifact) => artifact.attachments ?? [])
  .flatMap((attachment) => attachment.path === undefined ? [] : [attachment.path]);

const pendingCase = (testCase: VitestCaseSource): unknown => ({
  caseId: metadataSchema.safeParse(testCase.meta()).data?.caseId,
  state: 'pending',
  mode: testCase.options.mode,
  fails: testCase.options.fails ?? false,
  artifactRefs: artifactRefs(testCase),
});

const observedCase = (testCase: VitestCaseSource): unknown => {
  const result = testCase.result();
  if (result.state === 'pending') return pendingCase(testCase);
  const diagnostic = testCase.diagnostic();
  if (!diagnostic) throw new Error(`Vitest test ${testCase.id} finished without diagnostic data`);
  return {
    caseId: metadataSchema.safeParse(testCase.meta()).data?.caseId,
    state: result.state,
    mode: testCase.options.mode,
    fails: testCase.options.fails ?? false,
    durationMs: diagnostic.duration,
    startedAt: diagnostic.startTime,
    retryCount: diagnostic.retryCount,
    flaky: diagnostic.flaky,
    syntaxError: result.state === 'failed' && hasSyntaxError(result.errors),
    artifactRefs: artifactRefs(testCase),
  };
};

const expectedFor = (testCase: z.output<typeof completedVitestCaseSchema>): 'passed' | 'failed' | 'skipped' => {
  if (testCase.mode === 'skip' || testCase.mode === 'todo') return 'skipped';
  return testCase.fails ? 'failed' : 'passed';
};

const outcomeFor = (testCase: z.output<typeof completedVitestCaseSchema>): 'passed' | 'failed' | 'skipped' => {
  if (testCase.state === 'skipped') return 'skipped';
  if (testCase.syntaxError) return 'failed';
  if (!testCase.fails) return testCase.state;
  return testCase.state === 'passed' ? 'failed' : 'passed';
};

export const toVitestUnit = (input: unknown, idPattern: RegExp) => {
  const parsed = vitestUnitInputSchema.safeParse(input);
  if (!parsed.success) return parsed;
  const completedCases = parsed.data.tests.filter((testCase) => testCase.state !== 'pending');
  const observations = completedCases.map((testCase) => ({
    caseId: testCase.caseId,
    expected: expectedFor(testCase),
    attemptCoverage: { kind: 'finalOnly', retryCount: testCase.retryCount, flaky: testCase.flaky },
    attempts: [{
      outcome: outcomeFor(testCase),
      durationMs: testCase.durationMs,
      startedAt: new Date(testCase.startedAt).toISOString(),
      artifactRefs: testCase.artifactRefs,
    }],
  }));
  const unit = {
    ...parsed.data.completion,
    unitId: parsed.data.unitId,
    runner: 'vitest',
    layer: parsed.data.layer,
    target: parsed.data.target,
    plannedCaseIds: parsed.data.tests.map((testCase) => testCase.caseId),
    observations,
  } as const;
  return testRunUnitSchema(idPattern).safeParse(unit);
};

export type TestManagerVitestReporterOptions = Readonly<{
  outputFile: string;
  unitId: string;
  layer: string;
  target: string;
  idPattern: RegExp;
}>;

export class TestManagerVitestReporter implements Reporter {
  readonly #options: TestManagerVitestReporterOptions;
  readonly #tests = new Map<string, unknown>();

  constructor(options: TestManagerVitestReporterOptions) {
    this.#options = options;
  }

  onTestRunStart(): void {
    this.#tests.clear();
  }

  onTestModuleCollected(testModule: TestModule): void {
    for (const testCase of testModule.children.allTests()) this.#tests.set(testCase.id, pendingCase(testCase));
  }

  onTestCaseReady(testCase: TestCase | VitestCaseSource): void {
    this.#tests.set(testCase.id, pendingCase(testCase));
  }

  onTestCaseResult(testCase: TestCase | VitestCaseSource): void {
    this.#tests.set(testCase.id, observedCase(testCase));
  }

  async onTestRunEnd(
    _testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
    reason: TestRunEndReason,
  ): Promise<void> {
    const tests = [...this.#tests.values()];
    const hasPending = tests.some((testCase) => z.looseObject({ state: z.unknown() }).safeParse(testCase).data?.state === 'pending');
    const completion = reason === 'interrupted'
      ? { state: 'incomplete' as const, reason: 'cancelled' as const }
      : unhandledErrors.length > 0 || hasPending
        ? { state: 'incomplete' as const, reason: 'runnerError' as const }
        : { state: 'completed' as const };
    const parsed = toVitestUnit({
      unitId: this.#options.unitId,
      layer: this.#options.layer,
      target: this.#options.target,
      completion,
      tests,
    }, this.#options.idPattern);
    if (!parsed.success) throw new Error(`Cannot create Vitest unit artifact: ${parsed.error.message}`);
    await mkdir(path.dirname(this.#options.outputFile), { recursive: true });
    await writeFile(this.#options.outputFile, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf8');
  }
}

export default TestManagerVitestReporter;
