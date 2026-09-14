import type { CaseSource } from './model.js';
import type { TestRun } from './test-run.js';

type CatalogCaseSource = Readonly<{ id: string; source: CaseSource }>;

export type TestRunCatalogProblem = Readonly<
  | { kind: 'unknownCase'; caseId: string }
  | { kind: 'runnerMismatch'; caseId: string; runner: TestRun['units'][number]['runner']; source: CaseSource }
>;

export const validateTestRunCatalog = (
  cases: ReadonlyArray<CatalogCaseSource>,
  run: TestRun,
): ReadonlyArray<TestRunCatalogProblem> => {
  const casesById = new Map(cases.map((managedCase) => [managedCase.id, managedCase]));
  const problems: TestRunCatalogProblem[] = [];
  for (const unit of run.units) for (const caseId of unit.plannedCaseIds) {
    const managedCase = casesById.get(caseId);
    if (!managedCase) problems.push({ kind: 'unknownCase', caseId });
    else if (managedCase.source !== unit.runner) {
      problems.push({ kind: 'runnerMismatch', caseId, runner: unit.runner, source: managedCase.source });
    }
  }
  return problems;
};
