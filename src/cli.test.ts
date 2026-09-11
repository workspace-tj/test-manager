import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const cli = path.resolve('src/cli.ts');

const run = async (args: ReadonlyArray<string>): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> => {
  try {
    const result = await execute(process.execPath, ['--import', 'tsx', cli, ...args]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && 'stdout' in error && 'stderr' in error) {
      return { code: typeof error.code === 'number' ? error.code : -1, stdout: String(error.stdout), stderr: String(error.stderr) };
    }
    throw error;
  }
};

describe('CLI process boundary', () => {
  it('returns 0 for a valid project and 2 for invalid usage', async () => {
    expect((await run(['check', '--config', 'fixtures/valid/test-manager.yaml'])).code).toBe(0);
    expect((await run([])).code).toBe(2);
  });

  it('returns 1 and does not publish output when validation fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-'));
    const out = path.join(root, 'site');
    const result = await run(['build', '--config', 'fixtures/invalid/test-manager.yaml', '--out', out]);
    expect(result.code).toBe(1);
    await expect(access(out)).rejects.toThrow();
  });

  it('builds a valid project at the process boundary', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'test-manager-cli-build-'));
    const out = path.join(root, 'site');
    const result = await run(['build', '--config', 'fixtures/valid/test-manager.yaml', '--out', out]);
    expect(result.code).toBe(0);
    expect(await readFile(path.join(out, '.test-manager-output'), 'utf8')).toBe('v1\n');
    expect(await readFile(path.join(out, 'index.html'), 'utf8')).toContain('テスト知識カタログ');
  });
});
