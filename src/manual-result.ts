import { z } from 'zod';
import { caseIdSchema } from './ids.js';
import { CommitSchema, EnvironmentSchema, TimestampSchema } from './run-identity.js';

export const manualOutcomes = ['passed', 'failed', 'blocked'] as const;
export type ManualOutcome = typeof manualOutcomes[number];

const HttpUrlSchema = z.url().refine((value) => /^https?:\/\//u.test(value), 'must use HTTP or HTTPS');

const manualResultSetSchema = (idPattern: RegExp) => z.strictObject({
  schemaVersion: z.literal(1),
  environment: EnvironmentSchema,
  commit: CommitSchema,
  executedBy: z.string().min(1).optional(),
  results: z.array(z.strictObject({
    caseId: caseIdSchema(idPattern),
    executedAt: TimestampSchema,
    outcome: z.enum(manualOutcomes),
    note: z.string().min(1).optional(),
    evidenceUrl: HttpUrlSchema.optional(),
  })).min(1).refine((results) => new Set(results.map((result) => result.caseId)).size === results.length, 'caseId must be unique within a result set'),
});

export type ManualResultSet = z.infer<ReturnType<typeof manualResultSetSchema>>;

export const parseManualResultSet = (input: unknown, idPattern: RegExp) => manualResultSetSchema(idPattern).safeParse(input);
