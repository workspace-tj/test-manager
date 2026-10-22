import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { FieldRule } from './model.js';
import { memberName, objectProperty, stringValue } from './source-ast.js';

// `levels` lists the tags of the test first, then of each enclosing describe from the innermost outwards.
type CollectedTags = Readonly<{ levels: ReadonlyArray<ReadonlyArray<string>>; dynamic: boolean }>;

const isCallback = (node: t.Node | null | undefined): boolean => t.isArrowFunctionExpression(node) || t.isFunctionExpression(node);

// Options that are not an inline object, or that may hide a tag behind a spread or computed key, cannot be read statically.
const optionTags = (options: t.Node | null | undefined): Readonly<{ tags: ReadonlyArray<string>; dynamic: boolean }> => {
  if (options === undefined || options === null || isCallback(options)) return { tags: [], dynamic: false };
  if (!t.isObjectExpression(options)) return { tags: [], dynamic: true };
  if (options.properties.some((property) => t.isSpreadElement(property) || (t.isObjectProperty(property) && property.computed))) return { tags: [], dynamic: true };
  const tag = objectProperty(options, 'tag')?.value;
  if (tag === undefined) return { tags: [], dynamic: false };
  const single = stringValue(tag);
  if (single !== undefined) return { tags: [single], dynamic: false };
  if (!t.isArrayExpression(tag)) return { tags: [], dynamic: true };
  const tags: string[] = [];
  for (const item of tag.elements) {
    const value = stringValue(item);
    if (value === undefined) return { tags, dynamic: true };
    tags.push(value);
  }
  return { tags, dynamic: false };
};

// Tags declared on the test and on every lexically enclosing `<test>.describe(...)`. A test defined in a helper
// function called from a describe does not see that describe's tags here, although Playwright applies them at run time.
export const collectPlaywrightTags = (callPath: NodePath<t.CallExpression>, declaration: string): CollectedTags => {
  const root = declaration.split('.')[0];
  const own = optionTags(callPath.node.arguments[1]);
  const levels: Array<ReadonlyArray<string>> = [own.tags];
  let dynamic = own.dynamic;
  for (let current: NodePath | null = callPath.parentPath; current; current = current.parentPath) {
    if (!current.isCallExpression()) continue;
    const name = memberName(current.node.callee);
    if (!name || name.split('.')[0] !== root || name.split('.')[1] !== 'describe') continue;
    const describe = optionTags(current.node.arguments.length > 2 ? current.node.arguments[1] : undefined);
    levels.push(describe.tags);
    dynamic ||= describe.dynamic;
  }
  return { levels, dynamic };
};

type TagFields = Readonly<{
  values: Readonly<Record<string, string>>;
  conflicts: ReadonlyArray<Readonly<{ field: string; values: ReadonlyArray<string> }>>;
}>;

export const tagFieldNames = (rules: Readonly<Record<string, FieldRule>>): ReadonlyArray<string> =>
  Object.entries(rules).filter(([, rule]) => rule.type === 'enum' && rule.playwrightTag !== undefined).map(([name]) => name);

// A tag sets a field only when it fits the template and names one of the field's values; other tags are left to Playwright.
// The innermost level that sets a field wins, so a test can override its describe's default (e.g. @rank-A in a @rank-B describe);
// two values on the same level are a conflict.
export const fieldsFromTags = (levels: ReadonlyArray<ReadonlyArray<string>>, rules: Readonly<Record<string, FieldRule>>): TagFields => {
  const values: Record<string, string> = {};
  const conflicts: Array<Readonly<{ field: string; values: ReadonlyArray<string> }>> = [];
  for (const [name, rule] of Object.entries(rules)) {
    if (rule.type !== 'enum' || rule.playwrightTag === undefined) continue;
    const [prefix = '', suffix = ''] = rule.playwrightTag.split('{value}');
    const matchedOn = (tags: ReadonlyArray<string>): string[] => [...new Set(tags.flatMap((tag) => {
      if (!tag.startsWith(prefix) || !tag.endsWith(suffix) || tag.length < prefix.length + suffix.length) return [];
      const value = tag.slice(prefix.length, tag.length - suffix.length);
      return value in rule.values ? [value] : [];
    }))];
    const matched = levels.map(matchedOn).find((found) => found.length > 0) ?? [];
    if (matched.length > 1) conflicts.push({ field: name, values: matched });
    else if (matched[0] !== undefined) values[name] = matched[0];
  }
  return { values, conflicts };
};
