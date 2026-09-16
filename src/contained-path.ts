import path from 'node:path';
import { realpathSync } from 'node:fs';

export const relativeContainedPath = (root: string, candidate: string): string | undefined => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.includes('\\')) return undefined;
  return relative.split(path.sep).join('/');
};

export const relativeExistingContainedPath = (root: string, candidate: string): string | undefined => {
  const lexical = relativeContainedPath(root, candidate);
  if (!lexical) return undefined;
  try {
    return relativeContainedPath(realpathSync(root), realpathSync(candidate)) ? lexical : undefined;
  } catch {
    return undefined;
  }
};
