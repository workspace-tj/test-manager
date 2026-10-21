import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { ManagedCase, SourceKind } from './model.js';
import { ambiguousObject, memberName, objectProperty, staticValue, stringValue, unwrapTypeAssertions } from './source-ast.js';

type ExtractedCaseId = Readonly<{
  id?: string;
  invalidMultiplicity: boolean;
  unsupportedShape?: boolean;
}>;

type RunnerKind = Exclude<SourceKind, 'storybook'>;
type CaseStatus = ManagedCase['status'];
// An each table that cannot be read as values keeps the position of its source text instead.
type Declaration = Readonly<{ name?: string; parameters?: ReadonlyArray<unknown>; dynamicEach?: boolean; tableRange?: Readonly<{ start: number; end: number }> }>;

const rangeOf = (node: t.Node | null | undefined): Readonly<{ tableRange?: Readonly<{ start: number; end: number }> }> =>
  node && typeof node.start === 'number' && typeof node.end === 'number' ? { tableRange: { start: node.start, end: node.end } } : {};

// Whether an import specifier names a module that provides the runner's `test` / `it`.
export type RunnerModuleMatcher = (specifier: string) => boolean;

type RunnerSourceAdapter<Status extends CaseStatus = CaseStatus> = Readonly<{
  defaultModule: string;
  declaration: (callPath: NodePath<t.CallExpression>, isRunnerModule: RunnerModuleMatcher) => Declaration;
  extractCaseId: (call: t.CallExpression) => ExtractedCaseId;
  idRequirement: string;
  status: (declaration: string) => Status;
}>;

const extractVitestCaseId = (call: t.CallExpression): ExtractedCaseId => {
  const options = call.arguments[1];
  if (!t.isObjectExpression(options)) return { invalidMultiplicity: false };
  const meta = objectProperty(options, 'meta')?.value;
  if (!t.isObjectExpression(meta)) return { invalidMultiplicity: false };
  const unsupportedShape = ambiguousObject(options) || ambiguousObject(meta);
  const current = meta.properties.filter((property) => t.isObjectProperty(property) && !property.computed && ((t.isIdentifier(property.key) && property.key.name === 'caseId') || (t.isStringLiteral(property.key) && property.key.value === 'caseId')));
  const legacy = meta.properties.some((property) => t.isObjectProperty(property) && !property.computed && ((t.isIdentifier(property.key) && property.key.name === 'caseIds') || (t.isStringLiteral(property.key) && property.key.value === 'caseIds')));
  const id = current.length === 1 && t.isObjectProperty(current[0]) ? stringValue(current[0].value) : undefined;
  return { ...(id !== undefined ? { id } : {}), invalidMultiplicity: legacy || current.length > 1, ...(unsupportedShape ? { unsupportedShape: true } : {}) };
};

const extractPlaywrightCaseId = (call: t.CallExpression): ExtractedCaseId => {
  const options = call.arguments[1];
  if (!t.isObjectExpression(options)) return { invalidMultiplicity: false };
  const annotationProperties = options.properties.filter((property) => t.isObjectProperty(property) && !property.computed && ((t.isIdentifier(property.key) && property.key.name === 'annotation') || (t.isStringLiteral(property.key) && property.key.value === 'annotation')));
  const annotation = annotationProperties.length === 1 && t.isObjectProperty(annotationProperties[0]) ? annotationProperties[0].value : undefined;
  let unsupportedShape = ambiguousObject(options) || (t.isArrayExpression(annotation) && annotation.elements.some((item) => t.isSpreadElement(item)));
  const ids: string[] = [];
  let occurrences = 0;
  for (const item of t.isArrayExpression(annotation) ? annotation.elements : [annotation]) {
    if (!t.isObjectExpression(item)) continue;
    if (ambiguousObject(item)) unsupportedShape = true;
    if (stringValue(objectProperty(item, 'type')?.value) !== 'case-id') continue;
    occurrences += 1;
    const description = stringValue(objectProperty(item, 'description')?.value);
    if (description !== undefined) ids.push(description);
  }
  const id = ids.length === 1 ? ids[0] : undefined;
  return { ...(id !== undefined ? { id } : {}), invalidMultiplicity: annotationProperties.length > 1 || occurrences > 1, ...(unsupportedShape ? { unsupportedShape: true } : {}) };
};

const importedFrom = (isRunnerModule: RunnerModuleMatcher) => (callPath: NodePath<t.CallExpression>, declaration: string): boolean => {
  const root = declaration.split('.')[0];
  if (!root) return false;
  const binding = callPath.scope.getBinding(root);
  if (!binding?.path.isImportSpecifier()) return false;
  const imported = binding.path.node.imported;
  const importedName = t.isIdentifier(imported) ? imported.name : imported.value;
  const parent = binding.path.parentPath;
  return (importedName === 'test' || importedName === 'it') && parent?.isImportDeclaration() === true && isRunnerModule(parent.node.source.value);
};

// The each table written inline, or held by a `const` in the same file whose initializer is an array literal.
const eachTable = (callPath: NodePath<t.CallExpression>, argument: t.Node | undefined): t.Node | null | undefined => {
  const table = unwrapTypeAssertions(argument);
  if (!t.isIdentifier(table)) return table;
  const binding = callPath.scope.getBinding(table.name);
  if (binding?.kind !== 'const' || !binding.path.isVariableDeclarator()) return table;
  return unwrapTypeAssertions(binding.path.node.init);
};

const declarationFor = (modifiers: ReadonlySet<string>, todoWithoutCallback: boolean) =>
  (callPath: NodePath<t.CallExpression>, isRunnerModule: RunnerModuleMatcher): Declaration => {
    const allowed = (name: string, each: boolean): boolean => {
      const [root, ...parts] = name.split('.');
      const expectedModifiers = each ? parts.slice(0, -1) : parts;
      return Boolean(root) && (!each || parts[parts.length - 1] === 'each') && expectedModifiers.every((modifier) => modifiers.has(modifier));
    };
    const call = callPath.node;
    const direct = memberName(call.callee);
    if (direct && !direct.endsWith('.each') && allowed(direct, false) && importedFrom(isRunnerModule)(callPath, direct)) {
      const hasCallback = call.arguments.some((argument) => t.isArrowFunctionExpression(argument) || t.isFunctionExpression(argument));
      if (!hasCallback && !(todoWithoutCallback && direct.split('.').includes('todo'))) return {};
      return { name: direct };
    }
    if (t.isTaggedTemplateExpression(call.callee)) {
      const name = memberName(call.callee.tag);
      return name && allowed(name, true) && importedFrom(isRunnerModule)(callPath, name) ? { name, dynamicEach: true, ...rangeOf(call.callee.quasi) } : {};
    }
    if (!t.isCallExpression(call.callee)) return {};
    const name = memberName(call.callee.callee);
    if (!name || !allowed(name, true) || !importedFrom(isRunnerModule)(callPath, name)) return {};
    const argument = call.callee.arguments[0];
    const table = eachTable(callPath, argument);
    if (!t.isArrayExpression(table)) return { name, dynamicEach: true, ...rangeOf(argument) };
    const parameters: unknown[] = [];
    for (const entry of table.elements) {
      const parsed = staticValue(entry);
      if (!parsed.ok) return { name, dynamicEach: true, ...rangeOf(argument) };
      parameters.push(parsed.value);
    }
    return { name, parameters };
  };

const adapters: Readonly<{
  vitest: RunnerSourceAdapter<'active' | 'skip' | 'todo'>;
  playwright: RunnerSourceAdapter<'active' | 'skip'>;
}> = {
  vitest: {
    defaultModule: 'vitest',
    declaration: declarationFor(new Set(['skip', 'todo', 'only', 'concurrent', 'fails']), true),
    extractCaseId: extractVitestCaseId,
    idRequirement: 'meta.caseId is required in the declaration options',
    status: (declaration) => declaration.includes('.todo') ? 'todo' : declaration.includes('.skip') ? 'skip' : 'active',
  },
  playwright: {
    defaultModule: '@playwright/test',
    declaration: declarationFor(new Set(['skip', 'fixme', 'only', 'fail']), false),
    extractCaseId: extractPlaywrightCaseId,
    idRequirement: 'annotation { type: case-id, description: ID } is required in declaration options',
    status: (declaration) => declaration.includes('.skip') || declaration.includes('.fixme') ? 'skip' : 'active',
  },
};

export function runnerSourceAdapter(kind: 'vitest'): RunnerSourceAdapter<'active' | 'skip' | 'todo'>;
export function runnerSourceAdapter(kind: 'playwright'): RunnerSourceAdapter<'active' | 'skip'>;
export function runnerSourceAdapter(kind: RunnerKind): RunnerSourceAdapter;
export function runnerSourceAdapter(kind: RunnerKind): RunnerSourceAdapter {
  return adapters[kind];
}
