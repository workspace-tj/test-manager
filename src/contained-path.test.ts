import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { relativeContainedPath, relativeExistingContainedPath } from './contained-path.js';

describe('contained path projection', () => {
  const root = path.resolve('/tmp/test-manager-artifacts');

  it('returns a portable relative reference for a descendant', () => {
    expect(relativeContainedPath(root, path.join(root, 'screenshots', 'failure.png'))).toBe('screenshots/failure.png');
  });

  it.each([
    ['the root itself', root],
    ['a sibling with the same prefix', path.resolve('/tmp/test-manager-artifacts-private/file.txt')],
    ['a parent traversal', path.resolve(root, '..', 'outside.txt')],
    ['a backslash filename', path.join(root, 'screenshots\\failure.png')],
  ])('rejects %s', (_name, candidate) => {
    expect(relativeContainedPath(root, candidate)).toBeUndefined();
  });

  it('rejects an existing symlink whose target escapes the root', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'test-manager-contained-'));
    const artifactRoot = path.join(parent, 'artifacts');
    const outside = path.join(parent, 'secret.txt');
    await mkdir(artifactRoot);
    await writeFile(outside, 'secret', 'utf8');
    const link = path.join(artifactRoot, 'secret-link');
    await symlink(outside, link);

    expect(relativeExistingContainedPath(artifactRoot, link)).toBeUndefined();
  });
});
