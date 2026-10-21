import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const allowed = new Set(['--catalog', '--id-pattern', '--out']);
const option = (name) => {
  const index = args.indexOf(name);
  if (!allowed.has(name) || index < 0 || args.lastIndexOf(name) !== index || index + 1 >= args.length || args[index + 1].startsWith('--')) throw new Error(`missing or duplicate ${name}`);
  return args[index + 1];
};
if (args.length !== allowed.size * 2 || args.some((value, index) => index % 2 === 0 && !allowed.has(value))) throw new Error('usage: create-manifest.mjs --catalog <path> --id-pattern <regexp> --out <path>');

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
};

const toolDirectory = path.resolve(required('TM_TOOL_DIR'));
const { parseTestRunManifest } = await import(pathToFileURL(path.join(toolDirectory, 'dist/test-run-assembly.js')).href);

// One unit per runner and layer; the unit ID is derived the same way as reporters.mjs so both sides agree without listing IDs.
const unitsFor = (runner, cases) => {
  const runnerCases = cases.filter((item) => item.source === runner);
  if (runnerCases.length === 0) return [];
  const target = required(`TM_${runner.toUpperCase()}_TARGET`);
  const layers = [...new Set(runnerCases.map((item) => item.layer))].sort();
  return layers.map((layer) => ({
    unitId: `${runner}-${layer}-${target}`,
    runner,
    layer,
    target,
    plannedCaseIds: runnerCases.filter((item) => item.layer === layer).map((item) => item.id),
  }));
};

const catalogFile = path.resolve(option('--catalog'));
const outputFile = path.resolve(option('--out'));
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
if (!catalog || !Array.isArray(catalog.cases) || catalog.cases.some((item) => !item || typeof item.id !== 'string' || typeof item.source !== 'string' || typeof item.layer !== 'string')) {
  throw new Error('catalog must contain cases with string id, source, and layer');
}

const attempt = Number(required('TM_RUN_ATTEMPT'));
if (!Number.isInteger(attempt) || attempt < 1) throw new Error('TM_RUN_ATTEMPT must be a positive integer');
const startedAt = required('TM_STARTED_AT');
if (Number.isNaN(Date.parse(startedAt))) throw new Error('TM_STARTED_AT must be a timestamp');
const ciUrl = new URL(required('TM_CI_URL'));
if (ciUrl.protocol !== 'http:' && ciUrl.protocol !== 'https:') throw new Error('TM_CI_URL must use HTTP or HTTPS');

const manifest = {
  schemaVersion: 1,
  runId: required('TM_RUN_ID'),
  attempt,
  environment: required('TM_ENVIRONMENT'),
  commit: required('TM_COMMIT'),
  scopeId: required('TM_SCOPE_ID'),
  startedAt,
  ciUrl: ciUrl.toString(),
  units: [
    ...unitsFor('vitest', catalog.cases),
    ...unitsFor('playwright', catalog.cases),
  ],
};
if (manifest.units.length === 0) throw new Error('catalog contains no Vitest or Playwright cases');
const unitIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u;
const invalidUnit = manifest.units.find((unit) => !unitIdPattern.test(unit.unitId));
if (invalidUnit) throw new Error(`invalid manifest: unitId ${JSON.stringify(invalidUnit.unitId)} contains unsupported characters; use only A-Z, a-z, 0-9, '.', '_' and '-' in layer and target`);
const parsed = parseTestRunManifest(manifest, new RegExp(option('--id-pattern'), 'u'));
if (!parsed.success) throw new Error(`invalid manifest: ${parsed.error.message}`);

await mkdir(path.dirname(outputFile), { recursive: true });
const temporaryFile = `${outputFile}.${process.pid}.tmp`;
try {
  await writeFile(temporaryFile, `${JSON.stringify(parsed.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, outputFile);
} finally {
  await rm(temporaryFile, { force: true });
}
