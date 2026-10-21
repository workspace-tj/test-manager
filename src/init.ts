import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const initialConfig = `# test-manager project configuration.
# Structure: \`test-manager schema\` prints the JSON Schema. Run \`test-manager check --config test-manager.yaml\` after each edit.
version: 1
idPattern: "^(?:[a-z][a-z0-9-]*|CASE-[0-9]{3,})$"
discovery:
  documents: ["knowledge/**/*.md"]
  # Group files by layer, then by test kind (manual, vitest, playwright, storybook). A file must match exactly one entry.
  # unit:
  #   description: Runs with the default Vitest config, without a database
  #   vitest: ["src/**/!(*.integration).test.ts"]
  # integration:
  #   vitest: ["src/**/*.integration.test.ts"]
  # e2e:
  #   playwright: ["e2e/**/*.spec.ts"]
  #   manual: ["knowledge/**/*.manual.yaml"]
  sources: {}
documents:
  kinds:
    domain:
      description: 業務領域
      parent: { required: false, targetKinds: [] }
    feature:
      description: domainに属する機能
      parent: { required: true, targetKinds: [domain] }
case:
  fields:
    belongsTo: { required: true, placement: classification, type: reference, targetKinds: [domain, feature] }
`;

export const initialDocument = `---
id: example
kind: domain
title: Example domain
---

# Example domain

Replace this document with a real domain, or delete it once other documents exist.
`;

const exists = async (file: string): Promise<boolean> => access(file).then(() => true, () => false);

export type InitResult = Readonly<
  | { ok: true; configPath: string; written: ReadonlyArray<string> }
  | { ok: false; reason: string }
>;

export const initProject = async (directory: string, force: boolean): Promise<InitResult> => {
  const root = path.resolve(directory);
  const configPath = path.join(root, 'test-manager.yaml');
  if (!force && await exists(configPath)) return { ok: false, reason: `${configPath} already exists; pass --force to overwrite it` };
  const documentPath = path.join(root, 'knowledge', 'example.md');
  for (const directory of [root, path.dirname(documentPath)]) {
    const entry = await stat(directory).catch(() => undefined);
    if (entry && !entry.isDirectory()) return { ok: false, reason: `${directory} exists and is not a directory` };
  }
  const written: string[] = [];
  try {
    // The document is written first so a failed config write leaves nothing that blocks a rerun without --force.
    if (!await exists(documentPath)) {
      await mkdir(path.dirname(documentPath), { recursive: true });
      await writeFile(documentPath, initialDocument, { encoding: 'utf8', flag: 'wx' });
      written.push(documentPath);
    }
    await writeFile(configPath, initialConfig, 'utf8');
    written.push(configPath);
  } catch (error) {
    return { ok: false, reason: `cannot write initial files${written.length > 0 ? ` after writing ${written.join(', ')}` : ''}: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, configPath, written };
};
