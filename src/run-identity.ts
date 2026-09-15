import { z } from 'zod';

const ExternalIdentifierSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u);

export const RunIdSchema = z.string().min(1).brand<'RunId'>();
export const CommitSchema = z.string().regex(/^[0-9a-f]{7,64}$/u).brand<'CommitSha'>();
export const ScopeIdSchema = ExternalIdentifierSchema.brand<'ScopeId'>();
export const EnvironmentSchema = ExternalIdentifierSchema.brand<'TestEnvironment'>();
export const TimestampSchema = z.iso.datetime({ offset: true });
