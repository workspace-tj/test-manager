import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { describe, expect, it } from 'vitest';
import { runnerSourceAdapter } from './source-runner-adapters.js';

const firstCall = (source: string): NodePath<t.CallExpression> => {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  let result: NodePath<t.CallExpression> | undefined;
  traverseModule(ast, {
    CallExpression(callPath) {
      result ??= callPath;
    },
  });
  if (!result) throw new Error('fixture must contain a call expression');
  return result;
};

describe('runner source adapters', () => {
  it.each([
    {
      kind: 'vitest' as const,
      source: "import { test } from 'vitest'; test('case', { meta: { caseId: 'CASE-101' } }, () => {});",
      expectedId: 'CASE-101',
    },
    {
      kind: 'playwright' as const,
      source: "import { test } from '@playwright/test'; test('case', { annotation: { type: 'case-id', description: 'CASE-101' } }, () => {});",
      expectedId: 'CASE-101',
    },
  ])('isolates $kind metadata behind one runner-neutral contract', ({ kind, source, expectedId }) => {
    const callPath = firstCall(source);
    const adapter = runnerSourceAdapter(kind);

    expect(adapter.declaration(callPath)).toEqual({ name: 'test' });
    expect(adapter.extractCaseId(callPath.node)).toEqual({ id: expectedId, invalidMultiplicity: false });
    expect(adapter.status('test')).toBe('active');
  });
});
