import { renderCatalogSite } from './catalog-renderer.js';
import { renderDashboardNavigation } from './dashboard-navigation.js';
import type { DashboardPage } from './dashboard-navigation.js';
import { renderDailySite } from './daily-site.js';
import type { DailyView } from './daily-view.js';
import type { Catalog } from './model.js';
import { renderReleaseSite } from './release-site.js';
import type { ReleaseDiffView } from './release-diff.js';

export const renderQualitySite = (
  catalog: Catalog,
  daily: DailyView,
  release: ReleaseDiffView,
  stylesheet: string,
): ReadonlyMap<string, string> => {
  const files = new Map<string, string>();
  const add = (prefix: string, generated: ReadonlyMap<string, string>, rewrite?: (content: string, file: string) => string): void => {
    for (const [file, content] of generated) {
      const target = `${prefix}${file}`;
      const projected = rewrite ? rewrite(content, file) : content;
      const existing = files.get(target);
      if (existing !== undefined && existing !== projected) throw new Error(`quality site output collision: ${target}`);
      files.set(target, projected);
    }
  };
  const withNavigation = (content: string, active: DashboardPage, rootPrefix: string): string => {
    const pattern = /<nav class="segmented-nav"[^>]*>.*?<\/nav>/gu;
    if ([...content.matchAll(pattern)].length !== 1) throw new Error(`expected exactly one navigation in ${active} HTML`);
    return content.replace(pattern, renderDashboardNavigation({ active, rootPrefix }));
  };
  const releaseFiles = new Map(renderReleaseSite(release, stylesheet, true));
  releaseFiles.delete('assets/dashboard.css');
  add('', releaseFiles, (content, file) => file.endsWith('.html') ? withNavigation(content, 'release', '') : content);
  add('', renderDailySite(daily, stylesheet, true), (content, file) => file.endsWith('.html') ? withNavigation(content, 'daily', '') : content);
  const catalogFiles = new Map(renderCatalogSite(catalog));
  catalogFiles.delete('.test-manager-output');
  add('catalog/', catalogFiles, (content, file) => file.endsWith('.html') ? withNavigation(content, 'catalog', file.includes('/') ? '../../' : '../') : content);
  return files;
};
