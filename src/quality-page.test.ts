import { describe, expect, it } from 'vitest';
import { renderQualityPage } from './quality-page.js';

describe('quality page shell', () => {
  it('renders the shared header with the requested active destination', () => {
    const html = renderQualityPage({ active: 'release', title: 'リリース差分', bodyHtml: '<h1>body</h1>', integrated: true });

    expect(html).toContain('<a href="release.html" aria-current="page">リリース差分</a>');
    expect(html).toContain('<a href="catalog/cases/index.html">ケース探索</a>');
    expect(html).toContain('<main><h1>body</h1></main>');
  });

  it('keeps a standalone page navigation self-contained', () => {
    const html = renderQualityPage({ active: 'release', title: 'リリース差分', bodyHtml: '' });
    expect(html).toContain('<a class="brand" href="release.html">');
    expect(html).not.toContain('catalog/cases/index.html');
  });
});
