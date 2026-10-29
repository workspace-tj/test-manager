import { describe, expect, it } from 'vitest';
import { parseStrictYaml } from './yaml.js';

describe('parsed YAML source locations', () => {
  it('locates nested values and falls back to the nearest existing parent with offsets', () => {
    const parsed = parseStrictYaml('name: test\r\nitems:\r\n  - label: first\r\n    value: 42\r\n  - label: second\r\nempty:\r\n', 'case.yaml');
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.lineAt(['items', 0, 'value'])).toBe(4);
    expect(parsed.lineAt(['items', 1, 'missing'])).toBe(5);
    expect(parsed.lineAt(['absent'], 10)).toBe(11);
    expect(parsed.lineAt(['empty'])).toBe(6);
    expect(parsed.lineAt([], 2)).toBe(3);
  });

  it('keeps location lookups local to each parse, even after another parse or a failed parse', () => {
    const first = parseStrictYaml('title: first', 'same.yaml');
    const second = parseStrictYaml('\n\ntitle: second', 'same.yaml');
    const invalid = parseStrictYaml('title: [', 'same.yaml');
    expect(second.lineAt(['title'])).toBe(3);
    expect(invalid.diagnostics[0]?.code).toBe('TM001');
    expect(first.lineAt(['title'])).toBe(1);
  });
});
