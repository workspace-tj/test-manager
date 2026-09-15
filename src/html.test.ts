import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html.js';

describe('HTML primitives', () => {
  it('escapes text and attribute metacharacters exactly once', () => {
    expect(escapeHtml(`<a title="Tom & Jerry's">`)).toBe('&lt;a title=&quot;Tom &amp; Jerry&#39;s&quot;&gt;');
  });

  it('stringifies non-string domain values before escaping', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});
