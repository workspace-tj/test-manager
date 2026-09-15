import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import { storybookDeclarations } from './source-storybook-adapter.js';

describe('Storybook source adapter', () => {
  it('recognizes every declarator in an exported variable declaration and preserves its marker node', () => {
    const ast = parse(`
      /* @case */
      export const Primary = { name: '[CASE-101] primary' }, Secondary = { name: '[CASE-102] secondary' };
      const helper = {};
      export { helper };
      export default {};
      export function factory() { return {}; }
      export class StoryFactory {}
    `, { sourceType: 'module', plugins: ['typescript', 'jsx'] });

    const declarations = storybookDeclarations(ast);
    expect(declarations.map((item) => item.variable.id.type === 'Identifier' ? item.variable.id.name : '')).toEqual(['Primary', 'Secondary']);
    expect(declarations[0]?.declaration).toBe(declarations[1]?.declaration);
    expect(declarations.every((item) => item.exportNode.leadingComments?.[0]?.value.includes('@case') === true)).toBe(true);
  });
});
