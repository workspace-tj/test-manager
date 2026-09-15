import { renderCatalogSite } from './catalog-renderer.js';
import { writeManagedFiles } from './managed-output.js';
import type { Catalog } from './model.js';

export const renderSite = async (catalog: Catalog): Promise<ReadonlyMap<string, string>> => renderCatalogSite(catalog);

export const writeSite = async (catalog: Catalog, outPath: string): Promise<void> => {
  await writeManagedFiles(renderCatalogSite(catalog), outPath, catalog.projectRoot, 'v1\n');
};
