import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonInput } from './cli-input.js';

describe('CLI JSON input', () => {
  it('reports the input role and path when JSON is malformed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-input-'));
    const file = path.join(root, 'current.json');
    await writeFile(file, '{"token":SECRET_VALUE}', 'utf8');

    const result = readJsonInput(file, 'current TestRun');
    await expect(result).rejects.toThrow(`invalid JSON in current TestRun at ${file}`);
    await expect(result).rejects.not.toThrow(/SECRET_VALUE/u);
  });

  it('distinguishes an unreadable input without exposing the system error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-missing-'));
    const file = path.join(root, 'missing.json');
    await expect(readJsonInput(file, 'CI manifest')).rejects.toEqual(expect.objectContaining({
      message: `cannot read CI manifest from ${file}`,
      cause: expect.any(Error),
    }));
  });

  it('returns parsed JSON without assigning a domain type', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-input-'));
    const file = path.join(root, 'input.json');
    await writeFile(file, '{"value":1}', 'utf8');

    expect(await readJsonInput(file, 'fixture')).toEqual({ value: 1 });
  });
});
