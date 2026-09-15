export const cliUsage = `Usage:
  test-manager check --config <path>
  test-manager build --config <path> --out <path>
  test-manager snapshot --config <path> --commit <sha> --out <path>
  test-manager daily --config <path> [--stylesheet <path>] --out <path> --current-run <path> [--previous-run <path>]
  test-manager daily --config <path> [--stylesheet <path>] --out <path> --manifest <path> --completed-at <timestamp> [--unit-artifact <path> ...] [--previous-run <path>]
  test-manager release --production-snapshot <path> --staging-snapshot <path> [--stylesheet <path>] --out <path> [--latest-staging-run <path>]
  test-manager dashboard --config <path> --current-run <path> [--previous-run <path>] --production-snapshot <path> --staging-snapshot <path> [--latest-staging-run <path>] [--stylesheet <path>] --out <path>`;

type CommonSiteOptions = Readonly<{ out: string; stylesheet?: string }>;

export type CliArguments =
  | Readonly<{ command: 'check'; config: string }>
  | Readonly<{ command: 'build'; config: string; out: string }>
  | Readonly<{ command: 'snapshot'; config: string; commit: string; out: string }>
  | (Readonly<{ command: 'daily'; config: string; previousRun?: string; current: Readonly<{ type: 'run'; path: string }> | Readonly<{ type: 'artifacts'; manifest: string; completedAt: string; unitArtifacts: ReadonlyArray<string> }> }> & CommonSiteOptions)
  | (Readonly<{ command: 'release'; productionSnapshot: string; stagingSnapshot: string; latestStagingRun?: string }> & CommonSiteOptions)
  | (Readonly<{ command: 'dashboard'; config: string; currentRun: string; previousRun?: string; productionSnapshot: string; stagingSnapshot: string; latestStagingRun?: string }> & CommonSiteOptions);

type Command = CliArguments['command'];
const allowedFlags: Readonly<Record<Command, ReadonlySet<string>>> = {
  check: new Set(['--config']),
  build: new Set(['--config', '--out']),
  snapshot: new Set(['--config', '--commit', '--out']),
  daily: new Set(['--config', '--out', '--stylesheet', '--current-run', '--previous-run', '--manifest', '--completed-at', '--unit-artifact']),
  release: new Set(['--production-snapshot', '--staging-snapshot', '--latest-staging-run', '--stylesheet', '--out']),
  dashboard: new Set(['--config', '--current-run', '--previous-run', '--production-snapshot', '--staging-snapshot', '--latest-staging-run', '--stylesheet', '--out']),
};

const collectFlags = (command: Command, args: ReadonlyArray<string>): ReadonlyMap<string, ReadonlyArray<string>> | undefined => {
  const result = new Map<string, string[]>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !value || !flag.startsWith('--') || value.startsWith('--') || !allowedFlags[command].has(flag)) return undefined;
    const previous = result.get(flag) ?? [];
    if (previous.length > 0 && flag !== '--unit-artifact') return undefined;
    result.set(flag, [...previous, value]);
  }
  return result;
};

export const parseCliArguments = (args: ReadonlyArray<string>): CliArguments | undefined => {
  const command = args[0];
  if (command !== 'check' && command !== 'build' && command !== 'snapshot' && command !== 'daily' && command !== 'release' && command !== 'dashboard') return undefined;
  const flags = collectFlags(command, args);
  if (!flags) return undefined;
  const value = (flag: string): string | undefined => flags.get(flag)?.[0];
  const config = value('--config');
  const out = value('--out');
  if (command === 'check') return config ? { command, config } : undefined;
  if (command === 'build') return config && out ? { command, config, out } : undefined;
  if (command === 'snapshot') {
    const commit = value('--commit');
    return config && commit && out ? { command, config, commit, out } : undefined;
  }
  if (command === 'release') {
    const productionSnapshot = value('--production-snapshot');
    const stagingSnapshot = value('--staging-snapshot');
    const latestStagingRun = value('--latest-staging-run');
    const stylesheet = value('--stylesheet');
    return productionSnapshot && stagingSnapshot && out ? { command, productionSnapshot, stagingSnapshot, out, ...(latestStagingRun ? { latestStagingRun } : {}), ...(stylesheet ? { stylesheet } : {}) } : undefined;
  }
  if (command === 'dashboard') {
    const currentRun = value('--current-run');
    const productionSnapshot = value('--production-snapshot');
    const stagingSnapshot = value('--staging-snapshot');
    const previousRun = value('--previous-run');
    const latestStagingRun = value('--latest-staging-run');
    const stylesheet = value('--stylesheet');
    return config && currentRun && productionSnapshot && stagingSnapshot && out ? { command, config, currentRun, productionSnapshot, stagingSnapshot, out, ...(previousRun ? { previousRun } : {}), ...(latestStagingRun ? { latestStagingRun } : {}), ...(stylesheet ? { stylesheet } : {}) } : undefined;
  }
  const currentRun = value('--current-run');
  const manifest = value('--manifest');
  const completedAt = value('--completed-at');
  const unitArtifacts = flags.get('--unit-artifact') ?? [];
  if (!config || !out || Boolean(currentRun) === Boolean(manifest || completedAt || unitArtifacts.length > 0)) return undefined;
  const current = currentRun
    ? { type: 'run' as const, path: currentRun }
    : manifest && completedAt ? { type: 'artifacts' as const, manifest, completedAt, unitArtifacts } : undefined;
  const previousRun = value('--previous-run');
  const stylesheet = value('--stylesheet');
  return current ? { command, config, out, current, ...(previousRun ? { previousRun } : {}), ...(stylesheet ? { stylesheet } : {}) } : undefined;
};
