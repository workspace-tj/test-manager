import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const readJsonInput = async (file: string, role: string): Promise<unknown> => {
  const resolved = path.resolve(file);
  let source: string;
  try {
    source = await readFile(resolved, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${role} from ${resolved}`, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`invalid JSON in ${role} at ${resolved}`, { cause: error });
  }
};
