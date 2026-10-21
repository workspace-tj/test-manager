import { observedCaseStatus } from './case-result.js';
import type { CaseId } from './ids.js';
import type { Catalog } from './model.js';
import type { CaseObservation, TestRun } from './test-run.js';

export const defaultHistoryWindow = 14;

export type RunTrendPoint = Readonly<{
  runId: string;
  completedAt: string;
  commit: string;
  passed: number;
  failed: number;
  missing: number;
  other: number;
}>;

export type FlakyCase = Readonly<{
  caseId: CaseId;
  title: string;
  observedRuns: number;
  flakyRuns: number;
  passRate: number;
}>;

export type FailingStreak = Readonly<{
  caseId: CaseId;
  title: string;
  streak: number;
  since: string;
}>;

export type RunHistoryView = Readonly<{
  window: number;
  runs: ReadonlyArray<RunTrendPoint>;
  flaky: ReadonlyArray<FlakyCase>;
  failingStreaks: ReadonlyArray<FailingStreak>;
}>;

export type RunHistoryResult = Readonly<
  | { ok: true; view: RunHistoryView }
  | { ok: false; problems: ReadonlyArray<string> }
>;

const runKey = (run: TestRun): string => `${run.runId}\u0000${run.attempt}`;

const passedAfterRetry = (observation: CaseObservation): boolean => {
  if (observation.attemptCoverage.kind === 'finalOnly') return observation.attemptCoverage.flaky;
  const final = observation.attempts.at(-1);
  return observation.attempts.length > 1 && final?.outcome === 'passed' && observation.attempts.some((attempt) => attempt.outcome === 'failed' || attempt.outcome === 'timedOut');
};

export const buildRunHistory = (catalog: Catalog, current: TestRun, history: ReadonlyArray<TestRun>, window = defaultHistoryWindow): RunHistoryResult => {
  const problems = history
    .filter((run) => run.environment !== current.environment || run.scopeId !== current.scopeId)
    .map((run) => `history run ${run.runId} attempt ${run.attempt} uses ${run.environment}/${run.scopeId}, not ${current.environment}/${current.scopeId}`);
  if (problems.length > 0) return { ok: false, problems };

  const unique = new Map<string, TestRun>();
  for (const run of history) {
    const known = unique.get(runKey(run));
    if (known && JSON.stringify(known) !== JSON.stringify(run)) problems.push(`history runs for ${run.runId} attempt ${run.attempt} have different content`);
    unique.set(runKey(run), run);
  }
  if (problems.length > 0) return { ok: false, problems };
  unique.set(runKey(current), current);
  const runs = [...unique.values()]
    .filter((run) => Date.parse(run.completedAt) <= Date.parse(current.completedAt))
    .sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt) || left.runId.localeCompare(right.runId) || left.attempt - right.attempt)
    .slice(-window);

  const titles = new Map(catalog.cases.map((managedCase) => [managedCase.id, managedCase.title]));
  type Status = ReturnType<typeof observedCaseStatus> | 'missing';
  type Entry = Readonly<{ run: TestRun; status: Status; retried: boolean }>;
  const entries = new Map<CaseId, Entry[]>();
  const trend = runs.map((run): RunTrendPoint => {
    const statuses = new Map<CaseId, Entry>();
    for (const unit of run.units) {
      const observations = new Map(unit.observations.map((observation) => [observation.caseId, observation]));
      for (const caseId of unit.plannedCaseIds) {
        if (!titles.has(caseId) || statuses.has(caseId)) continue;
        const observation = observations.get(caseId);
        statuses.set(caseId, observation ? { run, status: observedCaseStatus(observation), retried: passedAfterRetry(observation) } : { run, status: 'missing', retried: false });
      }
    }
    let passed = 0;
    let failed = 0;
    let missing = 0;
    let other = 0;
    for (const [caseId, entry] of statuses) {
      if (entry.status === 'passed') passed += 1;
      else if (entry.status === 'failed' || entry.status === 'unexpectedPass') failed += 1;
      else if (entry.status === 'missing') missing += 1;
      else other += 1;
      entries.set(caseId, [...(entries.get(caseId) ?? []), entry]);
    }
    return { runId: run.runId, completedAt: run.completedAt, commit: run.commit, passed, failed, missing, other };
  });

  const flaky: FlakyCase[] = [];
  const failingStreaks: FailingStreak[] = [];
  for (const [caseId, caseEntries] of entries) {
    const title = titles.get(caseId) ?? caseId;
    const judged = caseEntries.filter((entry) => entry.status === 'passed' || entry.status === 'failed');
    const outcomesByCommit = new Map<string, Set<string>>();
    for (const entry of judged) outcomesByCommit.set(entry.run.commit, (outcomesByCommit.get(entry.run.commit) ?? new Set()).add(entry.status));
    // A run signals flakiness when the runner reports a retried pass, or it failed on a commit that also passed elsewhere.
    const flakyRuns = judged.filter((entry) => entry.retried || (entry.status === 'failed' && (outcomesByCommit.get(entry.run.commit)?.size ?? 0) > 1)).length;
    if (flakyRuns > 0) {
      flaky.push({ caseId, title, observedRuns: judged.length, flakyRuns, passRate: judged.filter((entry) => entry.status === 'passed').length / judged.length });
    }
    // Any non-failure result for the case, including a missing or skipped one, ends the streak.
    let streak = 0;
    for (let index = caseEntries.length - 1; index >= 0 && caseEntries[index]?.status === 'failed'; index -= 1) streak += 1;
    const since = caseEntries[caseEntries.length - streak]?.run.completedAt;
    if (streak >= 2 && since) failingStreaks.push({ caseId, title, streak, since });
  }
  flaky.sort((left, right) => right.flakyRuns / right.observedRuns - left.flakyRuns / left.observedRuns || right.flakyRuns - left.flakyRuns || left.caseId.localeCompare(right.caseId));
  failingStreaks.sort((left, right) => right.streak - left.streak || left.caseId.localeCompare(right.caseId));
  return { ok: true, view: { window, runs: trend, flaky, failingStreaks } };
};
