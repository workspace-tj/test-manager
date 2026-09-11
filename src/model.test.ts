import { describe, expectTypeOf, it } from 'vitest';
import type { CaseId, DocumentId } from './ids.js';
import type { ManagedCase } from './model.js';

describe('internal model invariants', () => {
  it('keeps document IDs and case IDs distinct', () => {
    expectTypeOf<CaseId>().not.toEqualTypeOf<DocumentId>();
  });

  it('excludes impossible source and status combinations', () => {
    expectTypeOf<Extract<ManagedCase, { source: 'manual' }>['status']>().toEqualTypeOf<'active'>();
    expectTypeOf<Extract<ManagedCase, { source: 'playwright' }>['status']>().toEqualTypeOf<'active' | 'skip'>();
    expectTypeOf<Extract<ManagedCase, { source: 'vitest' }>['status']>().toEqualTypeOf<'active' | 'skip' | 'todo'>();
    expectTypeOf<Extract<ManagedCase, { source: 'manual' }>['procedure']>().toEqualTypeOf<ReadonlyArray<Readonly<{ action: string; expected: string }>>>();
    expectTypeOf<Extract<ManagedCase, { source: 'vitest' }>['procedure']>().toEqualTypeOf<undefined>();
  });
});
