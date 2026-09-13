import { access, mkdtemp, mkdir, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeManagedFiles } from './managed-output.js';

describe('managed output boundary', () => {
  it('rejects an output path that reaches the protected root through an ancestor symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-output-symlink-'));
    const protectedRoot = path.join(root, 'project');
    const link = path.join(root, 'project-link');
    await mkdir(protectedRoot);
    await symlink(protectedRoot, link);

    await expect(writeManagedFiles(new Map([['index.html', 'unsafe']]), path.join(link, 'nested'), protectedRoot, 'daily-v1\n'))
      .rejects.toThrow('project root');
    await expect(access(path.join(protectedRoot, 'nested'))).rejects.toThrow();
  });

  it('rejects generated paths outside the temporary output directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-output-path-'));
    await expect(writeManagedFiles(new Map([['../outside.html', 'unsafe']]), path.join(root, 'out'), path.join(root, 'project'), 'daily-v1\n'))
      .rejects.toThrow('unsafe generated path');
    await expect(access(path.join(root, 'outside.html'))).rejects.toThrow();
  });

  it('rejects an output directory that is itself a symbolic link', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-output-link-'));
    const target = path.join(root, 'owned-target');
    const out = path.join(root, 'out-link');
    await mkdir(target);
    await symlink(target, out);
    await expect(writeManagedFiles(new Map([['index.html', 'unsafe']]), out, path.join(root, 'project'), 'daily-v1\n'))
      .rejects.toThrow('symbolic-link');
  });

  it('writes only files inside a newly owned directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-output-owned-'));
    const out = path.join(root, 'out');
    await writeManagedFiles(new Map([['assets/site.css', 'body{}']]), out, path.join(root, 'project'), 'daily-v1\n');
    expect(await readFile(path.join(out, 'assets/site.css'), 'utf8')).toBe('body{}');
    expect(await readFile(path.join(out, '.test-manager-output'), 'utf8')).toBe('daily-v1\n');
  });
});
