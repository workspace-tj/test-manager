import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const prototypeRoot = path.resolve('prototypes/quality-dashboard');
const page = async (name: string): Promise<string> => readFile(path.join(prototypeRoot, name), 'utf8');

describe('quality dashboard prototype', () => {
  it('keeps daily, release, and catalog decisions on separate pages', async () => {
    const [daily, release, catalog] = await Promise.all([page('index.html'), page('release.html'), page('catalog.html')]);

    expect(daily).toContain('devの日次実行');
    expect(daily).toContain('前回からの変化');
    expect(daily).toContain('domainごとの現在地');
    expect(daily).not.toContain('production E2Eの結果が揃っていません');
    expect(release).toContain('前回productionからの変更');
    expect(release).toContain('未分類のPR');
    expect(release).toContain('削除されたケース');
    expect(catalog).toContain('ケースを探す');
    expect(catalog).toContain('domain全体');
    expect(catalog).toContain('手動確認項目');
  });

  it('uses domain and feature as business membership without presenting source as coverage', async () => {
    const [daily, release, catalog] = await Promise.all([page('index.html'), page('release.html'), page('catalog.html')]);
    const combined = `${daily}${release}${catalog}`;

    expect(combined).toContain('billing');
    expect(combined).toContain('cancellation-and-refund');
    expect(combined).toContain('planned');
    expect(combined).not.toContain('owner別の状態');
    expect(combined).not.toContain('網羅的にテスト済み');
    expect(combined).not.toContain('リリース可能');
  });

  it('keeps optional issue creation separate from the core evidence views', async () => {
    const release = await page('release.html');

    expect(release).toContain('不足ケースをIssueにする');
    expect(release).toContain('GitHubで入力内容を確認して作成します');
    expect(release).not.toContain('AIで調査');
  });

  it('uses one quiet, consistent application shell across every decision view', async () => {
    const pages = await Promise.all(['index.html', 'release.html', 'catalog.html'].map(page));

    for (const html of pages) {
      expect(html).toContain('class="app-header"');
      expect(html).toContain('class="segmented-nav"');
      expect(html).toContain('class="page-intro"');
      expect(html).toContain('aria-current="page"');
    }
  });

  it('gives each page a purpose-specific primary surface', async () => {
    const [daily, release, catalog] = await Promise.all([page('index.html'), page('release.html'), page('catalog.html')]);

    expect(daily).toContain('class="summary-surface"');
    expect(daily).toContain('class="grouped-list change-list"');
    expect(release).toContain('class="comparison-surface"');
    expect(release).toContain('class="grouped-list case-list"');
    expect(catalog).toContain('class="catalog-sidebar"');
    expect(catalog).toContain('class="grouped-list feature-list"');
  });

  it('uses different visual structures for conclusions, events, and comparisons', async () => {
    const daily = await page('index.html');

    expect(daily).toContain('class="summary-surface"');
    expect(daily).toContain('class="grouped-list change-list"');
    expect(daily).toContain('class="domain-table"');
    expect(daily).toContain('class="domain-table-head"');
  });

  it('keeps domains in a stable configured order and exposes comparable counts', async () => {
    const daily = await page('index.html');

    expect(daily).toContain('data-order="configured"');
    expect(daily).toContain('設定順');
    expect(daily).toContain('role="columnheader">成功');
    expect(daily).toContain('role="columnheader">失敗');
    expect(daily).toContain('role="columnheader">新規');
    expect(daily).toContain('role="columnheader">未管理');
  });

  it('ships every local page asset', async () => {
    const names = ['index.html', 'release.html', 'catalog.html'];
    const pages = await Promise.all(names.map(page));
    const assets = pages.flatMap((html) => [...html.matchAll(/(?:href|src)="([^"]+)"/gu)]
      .map((match) => match[1])
      .filter((asset): asset is string => asset !== undefined && !asset.startsWith('#') && !asset.startsWith('https://')));

    await Promise.all(assets.map((asset) => expect(access(path.resolve(prototypeRoot, asset.split('#')[0] ?? asset))).resolves.toBeUndefined()));
  });
});
