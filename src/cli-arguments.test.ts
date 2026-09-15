import { describe, expect, it } from 'vitest';
import { parseCliArguments } from './cli-arguments.js';

describe('CLI argument grammar', () => {
  it('returns a command-specific value after validating required flags', () => {
    expect(parseCliArguments(['build', '--config', 'test-manager.yaml', '--out', 'site'])).toEqual({
      command: 'build',
      config: 'test-manager.yaml',
      out: 'site',
    });
  });

  it('keeps repeated unit artifacts only for manifest assembly', () => {
    expect(parseCliArguments([
      'daily', '--config', 'test-manager.yaml', '--out', 'site', '--manifest', 'manifest.json',
      '--completed-at', '2026-09-15T00:00:00Z', '--unit-artifact', 'vitest.json', '--unit-artifact', 'playwright.json',
    ])).toEqual({
      command: 'daily',
      config: 'test-manager.yaml',
      out: 'site',
      current: {
        type: 'artifacts',
        manifest: 'manifest.json',
        completedAt: '2026-09-15T00:00:00Z',
        unitArtifacts: ['vitest.json', 'playwright.json'],
      },
    });
  });

  it.each([
    ['unknown command', ['unknown']],
    ['unknown flag', ['check', '--config', 'x', '--out', 'site']],
    ['duplicate scalar flag', ['build', '--config', 'x', '--config', 'y', '--out', 'site']],
    ['mixed daily current sources', ['daily', '--config', 'x', '--out', 'site', '--current-run', 'run.json', '--manifest', 'manifest.json', '--completed-at', 'now']],
  ])('rejects %s', (_name, args) => {
    expect(parseCliArguments(args)).toBeUndefined();
  });
});
