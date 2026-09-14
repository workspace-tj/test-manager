import type { CaseObservation } from './test-run.js';

export type ObservedCaseStatus = 'passed' | 'failed' | 'expectedFailure' | 'unexpectedPass' | 'skipped';

export const observedCaseStatus = (observation: CaseObservation): ObservedCaseStatus => {
  const [first, ...rest] = observation.attempts;
  const outcome = rest.at(-1)?.outcome ?? first.outcome;
  if (observation.expected === 'failed') {
    if (outcome === 'failed' || outcome === 'timedOut') return 'expectedFailure';
    if (outcome === 'passed') return 'unexpectedPass';
    return outcome === 'skipped' ? 'skipped' : 'failed';
  }
  if (observation.expected === 'skipped') return outcome === 'skipped' ? 'skipped' : 'failed';
  if (outcome === 'passed') return 'passed';
  if (outcome === 'skipped') return 'skipped';
  return 'failed';
};
