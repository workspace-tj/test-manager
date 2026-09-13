import { z } from 'zod';
import { caseIdSchema } from './ids.js';

const RunIdSchema = z.string().min(1).brand<'RunId'>();
const ScopeIdSchema = z.string().min(1).brand<'ScopeId'>();
const EnvironmentSchema = z.string().min(1).brand<'TestEnvironment'>();
const CommitSchema = z.string().regex(/^[0-9a-f]{7,64}$/u).brand<'CommitSha'>();
const TimestampSchema = z.iso.datetime({ offset: true });

const AttemptSchema = z.strictObject({
  outcome: z.enum(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']),
  durationMs: z.number().int().nonnegative(),
  startedAt: TimestampSchema,
  artifactRefs: z.array(z.string().min(1)),
});

const observationSchema = (idPattern: RegExp) => z.strictObject({
  caseId: caseIdSchema(idPattern),
  expected: z.enum(['passed', 'failed', 'skipped']),
  attemptCoverage: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('complete') }),
    z.strictObject({ kind: z.literal('finalOnly'), retryCount: z.number().int().nonnegative(), flaky: z.boolean() }),
  ]),
  attempts: z.tuple([AttemptSchema]).rest(AttemptSchema),
});

const completedUnitSchema = (idPattern: RegExp) => z.strictObject({
  state: z.literal('completed'),
  unitId: z.string().min(1),
  runner: z.enum(['vitest', 'playwright']),
  layer: z.string().min(1),
  target: z.string().min(1),
  plannedCaseIds: z.array(caseIdSchema(idPattern)),
  observations: z.array(observationSchema(idPattern)),
}).superRefine((unit, context) => {
  if (new Set(unit.plannedCaseIds).size !== unit.plannedCaseIds.length) {
    context.addIssue({ code: 'custom', path: ['plannedCaseIds'], message: 'plannedCaseIds must be unique' });
  }
  const observedIds = unit.observations.map((observation) => observation.caseId);
  if (new Set(observedIds).size !== observedIds.length) {
    context.addIssue({ code: 'custom', path: ['observations'], message: 'observations must contain unique case IDs' });
  }
  const plannedIds = new Set(unit.plannedCaseIds);
  for (const [index, observation] of unit.observations.entries()) if (!plannedIds.has(observation.caseId)) {
    context.addIssue({ code: 'custom', path: ['observations', index, 'caseId'], message: `observation ${observation.caseId} is not in plannedCaseIds` });
  }
  if (observedIds.length !== unit.plannedCaseIds.length) {
    context.addIssue({ code: 'custom', path: ['observations'], message: 'completed units must observe every planned case' });
  }
});

const incompleteUnitSchema = (idPattern: RegExp) => z.strictObject({
  state: z.literal('incomplete'),
  unitId: z.string().min(1),
  runner: z.enum(['vitest', 'playwright']),
  layer: z.string().min(1),
  target: z.string().min(1),
  reason: z.enum(['cancelled', 'timedOut', 'runnerError', 'artifactMissing']),
  plannedCaseIds: z.array(caseIdSchema(idPattern)).refine((ids) => new Set(ids).size === ids.length, 'plannedCaseIds must be unique'),
  observations: z.array(observationSchema(idPattern)),
}).superRefine((unit, context) => {
  const observedIds = unit.observations.map((observation) => observation.caseId);
  if (new Set(observedIds).size !== observedIds.length) {
    context.addIssue({ code: 'custom', path: ['observations'], message: 'observations must contain unique case IDs' });
  }
  const plannedIds = new Set(unit.plannedCaseIds);
  for (const [index, observation] of unit.observations.entries()) if (!plannedIds.has(observation.caseId)) {
    context.addIssue({ code: 'custom', path: ['observations', index, 'caseId'], message: `observation ${observation.caseId} is not in plannedCaseIds` });
  }
});

export const testRunUnitSchema = (idPattern: RegExp) => z.discriminatedUnion('state', [
  completedUnitSchema(idPattern),
  incompleteUnitSchema(idPattern),
]);

export const testRunSchema = (idPattern: RegExp) => z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  attempt: z.number().int().positive(),
  environment: EnvironmentSchema,
  commit: CommitSchema,
  scopeId: ScopeIdSchema,
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  ciUrl: z.url(),
  units: z.array(testRunUnitSchema(idPattern)).min(1),
}).superRefine((run, context) => {
  const unitIds = run.units.map((unit) => unit.unitId);
  if (new Set(unitIds).size !== unitIds.length) context.addIssue({ code: 'custom', path: ['units'], message: 'unitId must be unique within a run' });
  const plannedCaseIds = run.units.flatMap((unit) => unit.plannedCaseIds);
  if (new Set(plannedCaseIds).size !== plannedCaseIds.length) context.addIssue({ code: 'custom', path: ['units'], message: 'planned case IDs must be unique within a run' });
});

export const parseTestRun = (input: unknown, idPattern: RegExp) => testRunSchema(idPattern).safeParse(input);

export type TestRun = z.infer<ReturnType<typeof testRunSchema>>;
export type TestRunUnit = TestRun['units'][number];
export type CaseObservation = Extract<TestRunUnit, { state: 'completed' }>['observations'][number];
export type CaseAttempt = CaseObservation['attempts'][number];
