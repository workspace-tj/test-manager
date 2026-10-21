import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from './catalog.js';
import { initialConfig, initProject } from './init.js';
import { rulesJsonSchema } from './rules.js';

describe('project initialization', () => {
  it('writes a configuration and an example document that pass check', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-init-'));
    const result = await initProject(root, false);
    expect(result).toEqual({ ok: true, configPath: path.join(root, 'test-manager.yaml'), written: [path.join(root, 'knowledge/example.md'), path.join(root, 'test-manager.yaml')] });
    expect((await checkProject(path.join(root, 'test-manager.yaml'))).ok).toBe(true);
  });

  it('refuses to replace an existing configuration unless forced and never replaces documents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-init-existing-'));
    await initProject(root, false);
    await writeFile(path.join(root, 'test-manager.yaml'), 'custom', 'utf8');
    await writeFile(path.join(root, 'knowledge/example.md'), 'user document', 'utf8');
    expect(await initProject(root, false)).toEqual({ ok: false, reason: expect.stringContaining('--force') });
    expect(await readFile(path.join(root, 'test-manager.yaml'), 'utf8')).toBe('custom');
    expect(await initProject(root, true)).toEqual({ ok: true, configPath: path.join(root, 'test-manager.yaml'), written: [path.join(root, 'test-manager.yaml')] });
    expect(await readFile(path.join(root, 'test-manager.yaml'), 'utf8')).toBe(initialConfig);
    expect(await readFile(path.join(root, 'knowledge/example.md'), 'utf8')).toBe('user document');
  });

  it('creates a missing target directory and reports unusable targets without writing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-init-target-'));
    const nested = path.join(root, 'new/project');
    expect((await initProject(nested, false)).ok).toBe(true);
    expect((await checkProject(path.join(nested, 'test-manager.yaml'))).ok).toBe(true);
    const file = path.join(root, 'file');
    await writeFile(file, 'not a directory', 'utf8');
    expect(await initProject(file, false)).toEqual({ ok: false, reason: `${file} exists and is not a directory` });
    const conflicting = path.join(root, 'conflicting');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(conflicting));
    await writeFile(path.join(conflicting, 'knowledge'), 'file', 'utf8');
    expect(await initProject(conflicting, false)).toEqual({ ok: false, reason: `${path.join(conflicting, 'knowledge')} exists and is not a directory` });
    await expect(readFile(path.join(conflicting, 'test-manager.yaml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the published JSON Schema in sync with the configuration parser', async () => {
    const published: unknown = JSON.parse(await readFile(path.resolve('schema/test-manager.schema.json'), 'utf8'));
    expect(published, 'run `pnpm schema` to regenerate schema/test-manager.schema.json').toEqual(rulesJsonSchema());
    expect(JSON.stringify(published)).toContain('"playwright"');
  });
});
