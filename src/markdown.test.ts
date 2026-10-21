import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown, renderMarkdown } from './markdown.js';

describe('markdown', () => {
  it('renders lists, nested lists, inline code, emphasis and links', () => {
    expect(renderMarkdown('- **予定**: `apps/x.ts` を見る\n  - 子の項目\n- [仕様](./spec.md)\n\n1. 一つ目\n2. 二つ目'))
      .toBe('<ul><li><strong>予定</strong>: <code>apps/x.ts</code> を見る<ul><li>子の項目</li></ul></li><li><a href="./spec.md">仕様</a></li></ul><ol><li>一つ目</li><li>二つ目</li></ol>');
  });

  it('keeps line breaks inside a paragraph and renders fenced code, quotes, rules and tables', () => {
    expect(renderMarkdown('一行目\n二行目\n\n```ts\nconst a = 1 < 2;\n```\n> 引用\n\n---\n| A | B |\n|---|---|\n| `x` | y |'))
      .toBe('<p>一行目<br>二行目</p><pre><code>const a = 1 &lt; 2;</code></pre><blockquote><p>引用</p></blockquote><hr><div class="table-scroll"><table><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody><tr><td><code>x</code></td><td>y</td></tr></tbody></table></div>');
  });

  it('drops a leading heading that repeats the page title, and only that one', () => {
    expect(renderMarkdown('# 配置\n\n本文\n\n# 配置', { omitHeading: '配置' })).toBe('<p>本文</p><h1>配置</h1>');
    expect(renderMarkdown('# 別の見出し', { omitHeading: '配置' })).toBe('<h1>別の見出し</h1>');
  });

  it('always makes progress on lines that look like the start of a block but are not one', () => {
    expect(renderMarkdown('| a |\nb')).toBe('<p>| a |<br>b</p>');
    expect(renderMarkdown('a\n# \nb')).toBe('<p>a<br>#<br>b</p>');
    expect(renderMarkdown('```js\nx\n```js\ny\n```')).toBe('<pre><code>x\n```js\ny</code></pre>');
  });

  it('escapes raw HTML and refuses script-capable link targets', () => {
    expect(renderInlineMarkdown('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(renderInlineMarkdown('[x](javascript:alert(1))')).not.toContain('<a');
    expect(renderInlineMarkdown('[x](data:text/html,hi)')).not.toContain('<a');
    expect(renderInlineMarkdown('[x](//evil.example)')).not.toContain('<a');
    expect(renderInlineMarkdown('[x](https://example.com/a?b=1&c=2)')).toBe('<a href="https://example.com/a?b=1&amp;c=2">x</a>');
  });
});
