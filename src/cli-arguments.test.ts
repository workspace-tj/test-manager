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

  it('accepts repeated manual result sets and snapshots for release comparisons', () => {
    expect(parseCliArguments([
      'release', '--production-snapshot', 'production.json', '--staging-snapshot', 'staging.json', '--out', 'site',
      '--manual-results', 'qa-a.json', '--manual-results', 'qa-b.json', '--manual-snapshot', 'older.json',
    ])).toEqual({
      command: 'release', productionSnapshot: 'production.json', stagingSnapshot: 'staging.json', out: 'site',
      manualResults: ['qa-a.json', 'qa-b.json'], manualSnapshots: ['older.json'],
    });
  });

  it('parses init and schema commands with their optional flags', () => {
    expect(parseCliArguments(['init'])).toEqual({ command: 'init', dir: '.', force: false });
    expect(parseCliArguments(['init', '--dir', 'consumer', '--force'])).toEqual({ command: 'init', dir: 'consumer', force: true });
    expect(parseCliArguments(['init', '--force', '--force'])).toBeUndefined();
    expect(parseCliArguments(['init', '--dir', '.', '--dir', 'x'])).toBeUndefined();
    expect(parseCliArguments(['init', '--dir'])).toBeUndefined();
    expect(parseCliArguments(['schema'])).toEqual({ command: 'schema' });
    expect(parseCliArguments(['schema', '--out', 'x'])).toBeUndefined();
  });

  it('parses the pull request comment command with an optional output file', () => {
    expect(parseCliArguments(['pr-comment', '--base-snapshot', 'base.json', '--head-snapshot', 'head.json'])).toEqual({ command: 'pr-comment', baseSnapshot: 'base.json', headSnapshot: 'head.json' });
    expect(parseCliArguments(['pr-comment', '--base-snapshot', 'base.json', '--head-snapshot', 'head.json', '--out', 'comment.md'])).toEqual({ command: 'pr-comment', baseSnapshot: 'base.json', headSnapshot: 'head.json', out: 'comment.md' });
    expect(parseCliArguments(['pr-comment', '--base-snapshot', 'base.json'])).toBeUndefined();
  });

  it('accepts a history directory and window for daily pages only with the directory', () => {
    expect(parseCliArguments(['daily', '--config', 'c.yaml', '--out', 'site', '--current-run', 'run.json', '--history-dir', 'runs', '--history-window', '30'])).toEqual({
      command: 'daily', config: 'c.yaml', out: 'site', current: { type: 'run', path: 'run.json' }, historyDir: 'runs', historyWindow: 30,
    });
    expect(parseCliArguments(['daily', '--config', 'c.yaml', '--out', 'site', '--current-run', 'run.json', '--history-window', '30'])).toBeUndefined();
    expect(parseCliArguments(['daily', '--config', 'c.yaml', '--out', 'site', '--current-run', 'run.json', '--history-dir', 'runs', '--history-window', '0'])).toBeUndefined();
  });

  it.each([
    ['unknown command', ['unknown']],
    ['missing flag value', ['check', '--config']],
    ['empty flag value', ['build', '--config', 'x', '--out', '']],
    ['unknown flag', ['check', '--config', 'x', '--out', 'site']],
    ['duplicate scalar flag', ['build', '--config', 'x', '--config', 'y', '--out', 'site']],
    ['mixed daily current sources', ['daily', '--config', 'x', '--out', 'site', '--current-run', 'run.json', '--manifest', 'manifest.json', '--completed-at', 'now']],
  ])('rejects %s', (_name, args) => {
    expect(parseCliArguments(args)).toBeUndefined();
  });
});
