import { describe, expect, it } from 'vitest';
import { CommitSchema, EnvironmentSchema, RunIdSchema, ScopeIdSchema } from './run-identity.js';

describe('run identity schemas', () => {
  it('shares strict external identifiers without accepting paths or markup', () => {
    expect(RunIdSchema.safeParse('run-1842').success).toBe(true);
    expect(CommitSchema.safeParse('7f3a12c').success).toBe(true);
    for (const schema of [EnvironmentSchema, ScopeIdSchema]) {
      expect(schema.safeParse('daily-all').success).toBe(true);
      expect(schema.safeParse('../production').success).toBe(false);
      expect(schema.safeParse('staging<script>').success).toBe(false);
    }
  });
});
