import { describe, expect, it } from 'vitest';
import { escapeHtml, renderAppHeader, renderHtmlDocument } from './html.js';

describe('HTML primitives', () => {
  it('escapes text and attribute metacharacters exactly once', () => {
    expect(escapeHtml(`<a title="Tom & Jerry's">`)).toBe('&lt;a title=&quot;Tom &amp; Jerry&#39;s&quot;&gt;');
  });

  it('stringifies non-string domain values before escaping', () => {
    expect(escapeHtml(42)).toBe('42');
  });

  it('renders the shared application header around page-specific navigation', () => {
    expect(renderAppHeader({ homeHref: 'index.html', navigationHtml: '<nav>pages</nav>', spacer: true })).toBe(
      '<header class="app-header"><div class="header-inner"><a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">✓</span><span>Test Manager</span></a><nav>pages</nav><span class="header-spacer" aria-hidden="true"></span></div></header>',
    );
  });

  it('escapes document metadata while preserving trusted rendered fragments', () => {
    const html = renderHtmlDocument({ title: 'A & B', stylesheetHref: 'assets/style.css', headerHtml: '<header>safe</header>', bodyHtml: '<h1>body</h1>' });
    expect(html).toContain('<title>A &amp; B · Test Manager</title>');
    expect(html).toContain('<link rel="stylesheet" href="assets/style.css">');
    expect(html).toContain('<body><header>safe</header><main><h1>body</h1></main></body>');
  });
});
