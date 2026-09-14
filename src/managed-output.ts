import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const exists = async (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

const physicalPath = async (candidate: string): Promise<string> => {
  const missingSegments: string[] = [];
  let existing = path.resolve(candidate);
  while (!await exists(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(await realpath(existing), ...missingSegments);
};

const isAtOrWithin = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

export const writeManagedFiles = async (
  files: ReadonlyMap<string, string>,
  outPath: string,
  protectedRoot: string,
  markerValue: string,
): Promise<void> => {
  const lexicalOut = path.resolve(outPath);
  const outputEntry = await lstat(lexicalOut).catch(() => undefined);
  if (outputEntry?.isSymbolicLink()) throw new Error('refusing to replace a symbolic-link output directory');
  const out = await physicalPath(lexicalOut);
  const protectedDirectory = await physicalPath(protectedRoot);
  if (isAtOrWithin(protectedDirectory, out) || isAtOrWithin(out, protectedDirectory)) {
    throw new Error('output directory must not be the protected project root or its ancestor');
  }
  if (await exists(out)) {
    const marker = path.join(out, '.test-manager-output');
    if (!await exists(marker) || await readFile(marker, 'utf8') !== markerValue) {
      throw new Error('refusing to replace a directory not created by test-manager with this command marker');
    }
  }
  await mkdir(path.dirname(out), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(out), `.${path.basename(out)}.test-manager-`));
  const backup = `${temporary}-previous`;
  let moved = false;
  let backedUp = false;
  try {
    for (const [relative, content] of files) {
      const target = path.resolve(temporary, relative);
      if (!isAtOrWithin(temporary, target) || target === temporary) throw new Error(`unsafe generated path: ${relative}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
    await writeFile(path.join(temporary, '.test-manager-output'), markerValue, 'utf8');
    if (await exists(out)) {
      await rename(out, backup);
      backedUp = true;
    }
    await rename(temporary, out);
    moved = true;
    if (backedUp) await rm(backup, { recursive: true });
  } catch (error) {
    if (backedUp && !await exists(out) && await exists(backup)) await rename(backup, out);
    throw error;
  } finally {
    if (!moved && await exists(temporary)) await rm(temporary, { recursive: true });
    if (moved && await exists(backup)) await rm(backup, { recursive: true });
  }
};
