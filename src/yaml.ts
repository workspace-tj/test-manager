import { LineCounter, parseDocument } from 'yaml';
import type { Diagnostic } from './model.js';
import { diagnostic } from './diagnostics.js';

export const parseStrictYaml = (
  source: string,
  file: string,
): Readonly<{ value?: unknown; diagnostics: ReadonlyArray<Diagnostic> }> => {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    merge: false,
  });
  const diagnostics = [...document.errors, ...document.warnings].map((error) => {
    const position = error.pos[0] ?? 0;
    const at = lineCounter.linePos(position);
    return diagnostic('TM001', file, 'yaml', error.message, at.line, at.col);
  });
  if (diagnostics.length > 0) return { diagnostics };
  try {
    return { value: document.toJS({ maxAliasCount: 0 }), diagnostics: [] };
  } catch (error) {
    return { diagnostics: [diagnostic('TM001', file, 'yaml', String(error))] };
  }
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const unknownKeys = (value: Record<string, unknown>, allowed: ReadonlyArray<string>): ReadonlyArray<string> =>
  Object.keys(value).filter((key) => !allowed.includes(key));

export const yamlPathLine = (source: string, path: ReadonlyArray<PropertyKey>, lineOffset = 0): number => {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter, prettyErrors: false, strict: true, uniqueKeys: true, merge: false });
  for (let length = path.length; length > 0; length -= 1) {
    const node = document.getIn(path.slice(0, length) as Array<string | number>, true);
    if (typeof node === 'object' && node !== null && 'range' in node && Array.isArray(node.range) && typeof node.range[0] === 'number') return lineCounter.linePos(node.range[0]).line + lineOffset;
  }
  return 1 + lineOffset;
};
