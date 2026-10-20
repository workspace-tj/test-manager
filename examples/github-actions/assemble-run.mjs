import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const allowed = new Set(['--manifest', '--artifact-directory', '--completed-at', '--id-pattern', '--out']);
if (args.length !== allowed.size * 2) throw new Error('usage: assemble-run.mjs --manifest <path> --artifact-directory <path> --completed-at <timestamp> --id-pattern <regexp> --out <path>');
const option = (name) => {
  const index = args.indexOf(name);
  if (!allowed.has(name) || index < 0 || args.lastIndexOf(name) !== index || index + 1 >= args.length || args[index + 1].startsWith('--')) throw new Error(`missing or duplicate ${name}`);
  return args[index + 1];
};
if (args.some((value, index) => index % 2 === 0 && !allowed.has(value))) throw new Error('unknown option');

const toolDirectory = process.env.TM_TOOL_DIR;
if (!toolDirectory) throw new Error('missing environment variable TM_TOOL_DIR');
const assemblyModule = path.join(path.resolve(toolDirectory), 'dist/test-run-assembly.js');
const { assembleTestRun } = await import(pathToFileURL(assemblyModule).href);
const manifest = JSON.parse(await readFile(path.resolve(option('--manifest')), 'utf8'));
const artifactDirectory = path.resolve(option('--artifact-directory'));
const artifactFiles = await readdir(artifactDirectory).then(
  (files) => files.filter((file) => file.endsWith('.test-manager-unit.json')).sort(),
  (error) => error?.code === 'ENOENT' ? [] : Promise.reject(error),
);
const unitArtifacts = await Promise.all(artifactFiles.map(async (file) =>
  JSON.parse(await readFile(path.join(artifactDirectory, file), 'utf8'))));
const completedAt = option('--completed-at');
if (Number.isNaN(Date.parse(completedAt))) throw new Error('--completed-at must be a timestamp');
const result = assembleTestRun({ manifest, completedAt, unitArtifacts }, new RegExp(option('--id-pattern'), 'u'));
if (!result.success) throw new Error(`cannot assemble TestRun: ${result.error.message}`);

const outputFile = path.resolve(option('--out'));
await mkdir(path.dirname(outputFile), { recursive: true });
const temporaryFile = `${outputFile}.${process.pid}.tmp`;
try {
  await writeFile(temporaryFile, `${JSON.stringify(result.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, outputFile);
} finally {
  await rm(temporaryFile, { force: true });
}
