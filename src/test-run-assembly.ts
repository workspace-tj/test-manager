import { z } from 'zod';
import { caseIdSchema } from './ids.js';
import {
  caseObservationSchema,
  testRunSchema,
} from './test-run.js';
import { CommitSchema, EnvironmentSchema, RunIdSchema, ScopeIdSchema, TimestampSchema } from './run-identity.js';

const plannedUnitSchema = (idPattern: RegExp) => z.strictObject({
  unitId: z.string().min(1),
  runner: z.enum(['vitest', 'playwright']),
  layer: z.string().min(1),
  target: z.string().min(1),
  plannedCaseIds: z.array(caseIdSchema(idPattern)).refine(
    (caseIds) => new Set(caseIds).size === caseIds.length,
    'plannedCaseIds must be unique',
  ),
});

export const testRunManifestSchema = (idPattern: RegExp) => z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  attempt: z.number().int().positive(),
  environment: EnvironmentSchema,
  commit: CommitSchema,
  scopeId: ScopeIdSchema,
  startedAt: TimestampSchema,
  ciUrl: z.url({ protocol: /^https?$/u }),
  units: z.array(plannedUnitSchema(idPattern)).min(1),
}).superRefine((manifest, context) => {
  const unitIds = manifest.units.map((unit) => unit.unitId);
  if (new Set(unitIds).size !== unitIds.length) {
    context.addIssue({ code: 'custom', path: ['units'], message: 'unitId must be unique within a manifest' });
  }
  const plannedCaseIds = manifest.units.flatMap((unit) => unit.plannedCaseIds);
  if (new Set(plannedCaseIds).size !== plannedCaseIds.length) {
    context.addIssue({ code: 'custom', path: ['units'], message: 'planned case IDs must be unique within a manifest' });
  }
});

export const parseTestRunManifest = (input: unknown, idPattern: RegExp) =>
  testRunManifestSchema(idPattern).safeParse(input);

export const testRunUnitArtifactSchema = (idPattern: RegExp) => z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('completed'),
    unitId: z.string().min(1),
    observations: z.array(caseObservationSchema(idPattern)),
  }),
  z.strictObject({
    state: z.literal('incomplete'),
    unitId: z.string().min(1),
    reason: z.enum(['cancelled', 'timedOut', 'runnerError']),
    observations: z.array(caseObservationSchema(idPattern)),
  }),
]);

const assemblyInputSchema = (idPattern: RegExp) => z.strictObject({
  manifest: testRunManifestSchema(idPattern),
  completedAt: TimestampSchema,
  unitArtifacts: z.array(testRunUnitArtifactSchema(idPattern)),
}).superRefine((input, context) => {
  if (Date.parse(input.completedAt) < Date.parse(input.manifest.startedAt)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'completedAt must not precede startedAt' });
  }
  const artifactIds = input.unitArtifacts.map((artifact) => artifact.unitId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    context.addIssue({ code: 'custom', path: ['unitArtifacts'], message: 'unit artifact IDs must be unique' });
  }

  const plans = new Map(input.manifest.units.map((unit) => [unit.unitId, unit]));
  for (const [index, artifact] of input.unitArtifacts.entries()) {
    const plan = plans.get(artifact.unitId);
    if (!plan) {
      context.addIssue({ code: 'custom', path: ['unitArtifacts', index, 'unitId'], message: `unit artifact ${artifact.unitId} is not declared by the manifest` });
      continue;
    }
    const plannedCaseIds = new Set(plan.plannedCaseIds);
    const invalidObservation = artifact.observations.find((observation) => !plannedCaseIds.has(observation.caseId));
    if (invalidObservation) {
      context.addIssue({ code: 'custom', path: ['unitArtifacts', index, 'observations'], message: `observation ${invalidObservation.caseId} is not declared by unit ${artifact.unitId}` });
    }
  }
});

export const assembleTestRun = (input: unknown, idPattern: RegExp) => {
  const parsed = assemblyInputSchema(idPattern).safeParse(input);
  if (!parsed.success) return parsed;
  const { manifest, completedAt, unitArtifacts } = parsed.data;
  const artifacts = new Map(unitArtifacts.map((artifact) => [artifact.unitId, artifact]));
  return testRunSchema(idPattern).safeParse({
    ...manifest,
    completedAt,
    units: manifest.units.map((plan) => {
      const artifact = artifacts.get(plan.unitId);
      return artifact === undefined
        ? { state: 'incomplete' as const, ...plan, reason: 'artifactMissing' as const, observations: [] }
        : { ...plan, ...artifact };
    }),
  });
};

export type TestRunManifest = z.infer<ReturnType<typeof testRunManifestSchema>>;
