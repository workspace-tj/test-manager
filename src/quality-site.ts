import { renderCatalogSite } from './catalog-renderer.js';
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
  const add = (prefix: string, generated: ReadonlyMap<string, string>): void => {
    for (const [file, content] of generated) {
      const target = `${prefix}${file}`;
      const projected = content;
      const existing = files.get(target);
      if (existing !== undefined && existing !== projected) throw new Error(`quality site output collision: ${target}`);
      files.set(target, projected);
    }
  };
  const releaseFiles = new Map(renderReleaseSite(release, stylesheet, true));
  releaseFiles.delete('assets/dashboard.css');
  add('', releaseFiles);
  add('', renderDailySite(daily, stylesheet, true));
  const catalogFiles = new Map(renderCatalogSite(catalog, true));
  catalogFiles.delete('.test-manager-output');
  add('catalog/', catalogFiles);
  return files;
};
