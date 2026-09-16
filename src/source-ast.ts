import * as t from '@babel/types';

export const stringValue = (node: t.Node | null | undefined): string | undefined =>
  t.isStringLiteral(node) ? node.value : t.isTemplateLiteral(node) && node.expressions.length === 0 ? node.quasis[0]?.value.cooked ?? undefined : undefined;

export const memberName = (node: t.Node | null | undefined): string | undefined => {
  if (t.isIdentifier(node)) return node.name;
  if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) {
    const base = memberName(node.object);
    return base ? `${base}.${node.property.name}` : undefined;
  }
  return undefined;
};

export const objectProperty = (object: t.ObjectExpression, name: string): t.ObjectProperty | undefined =>
  object.properties.find((property): property is t.ObjectProperty =>
    t.isObjectProperty(property) && !property.computed &&
    ((t.isIdentifier(property.key) && property.key.name === name) || (t.isStringLiteral(property.key) && property.key.value === name)));

export const ambiguousObject = (object: t.ObjectExpression): boolean => {
  const keys = new Set<string>();
  for (const property of object.properties) {
    if (!t.isObjectProperty(property) || property.computed) return true;
    const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) || t.isNumericLiteral(property.key) ? String(property.key.value) : undefined;
    if (key === undefined || keys.has(key)) return true;
    keys.add(key);
  }
  return false;
};

export const staticValue = (node: t.Node | null | undefined): Readonly<{ ok: true; value: unknown } | { ok: false }> => {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) return { ok: true, value: node.value };
  if (t.isNullLiteral(node)) return { ok: true, value: null };
  if (t.isUnaryExpression(node) && (node.operator === '-' || node.operator === '+') && t.isNumericLiteral(node.argument)) return { ok: true, value: node.operator === '-' ? -node.argument.value : node.argument.value };
  if (t.isArrayExpression(node)) {
    const values: unknown[] = [];
    for (const item of node.elements) {
      if (!item || t.isSpreadElement(item)) return { ok: false };
      const parsed = staticValue(item);
      if (!parsed.ok) return parsed;
      values.push(parsed.value);
    }
    return { ok: true, value: values };
  }
  if (t.isObjectExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed) return { ok: false };
      const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) || t.isNumericLiteral(property.key) ? String(property.key.value) : undefined;
      const parsed = staticValue(property.value);
      if (key === undefined || !parsed.ok) return { ok: false };
      value[key] = parsed.value;
    }
    return { ok: true, value };
  }
  return { ok: false };
};
