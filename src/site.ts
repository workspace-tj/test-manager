import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortDocumentsForDisplay } from './documents.js';
import { writeManagedFiles } from './managed-output.js';
import type { Catalog } from './model.js';

const astroRoot = fileURLToPath(new URL('../ui/catalog/', import.meta.url));
let buildQueue: Promise<void> = Promise.resolve();
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const readTextTree = async (root: string, directory = root): Promise<ReadonlyMap<string, string>> => {
  const files = new Map<string, string>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, content] of await readTextTree(root, absolute)) files.set(name, content);
    } else {
      files.set(path.relative(root, absolute), await readFile(absolute, 'utf8'));
    }
  }
  return files;
};

const serializableCatalog = (catalog: Catalog): Catalog => ({
  ...catalog,
  documents: sortDocumentsForDisplay(catalog.documents, catalog.rules),
  cases: [...catalog.cases].sort((left, right) => compareText(left.id, right.id)),
});

const buildAstroSite = async (catalog: Catalog): Promise<ReadonlyMap<string, string>> => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'test-manager-astro-'));
  const output = path.join(temporary, 'site');
  const previousTelemetrySetting = process.env.ASTRO_TELEMETRY_DISABLED;
  try {
    process.env.ASTRO_TELEMETRY_DISABLED = '1';
    const { build } = await import('astro');
    await build({
      root: astroRoot,
      outDir: output,
      cacheDir: path.join(temporary, 'cache'),
      logLevel: 'silent',
      vite: { define: { __TEST_MANAGER_CATALOG__: JSON.stringify(catalog) } },
    });
    const files = new Map(await readTextTree(output));
    for (const section of ['cases', 'documents'] as const) {
      const index = files.get(`${section}.html`);
      if (index === undefined) throw new Error(`Astro did not generate ${section}.html`);
      files.delete(`${section}.html`);
      files.set(`${section}/index.html`, index);
    }
    const publicDocuments = catalog.documents.map(({ fieldLocations: _fieldLocations, ...document }) => document);
    files.set('catalog.json', `${JSON.stringify({ documents: publicDocuments, cases: catalog.cases }, null, 2)}\n`);
    files.set('.test-manager-output', 'v1\n');
    return files;
  } finally {
    if (previousTelemetrySetting === undefined) delete process.env.ASTRO_TELEMETRY_DISABLED;
    else process.env.ASTRO_TELEMETRY_DISABLED = previousTelemetrySetting;
    await rm(temporary, { recursive: true, force: true });
  }
};

export const renderSite = async (catalog: Catalog): Promise<ReadonlyMap<string, string>> => {
  const preparedCatalog = serializableCatalog(catalog);
  const pending = buildQueue.then(() => buildAstroSite(preparedCatalog));
  buildQueue = pending.then(() => undefined, () => undefined);
  return new Map(await pending);
};

export const writeSite = async (catalog: Catalog, outPath: string): Promise<void> => {
  await writeManagedFiles(await renderSite(catalog), outPath, catalog.projectRoot, 'v1\n');
};
