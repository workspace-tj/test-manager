import type { CaseSource } from './model.js';
import type { TestRun } from './test-run.js';

type CatalogCaseSource = Readonly<{ id: string; source: CaseSource; layer: string }>;

export type TestRunCatalogProblem = Readonly<
  | { kind: 'unknownCase'; caseId: string }
  | { kind: 'runnerMismatch'; caseId: string; runner: TestRun['units'][number]['runner']; source: CaseSource }
  | { kind: 'layerMismatch'; caseId: string; unitLayer: string; caseLayer: string }
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
    } else if (managedCase.layer !== unit.layer) {
      problems.push({ kind: 'layerMismatch', caseId, unitLayer: unit.layer, caseLayer: managedCase.layer });
    }
  }
  return problems;
};

export const describeTestRunCatalogProblem = (problem: TestRunCatalogProblem): string => {
  switch (problem.kind) {
    case 'unknownCase': return `unknown case ${problem.caseId}`;
    case 'runnerMismatch': return `runner ${problem.runner} does not match case ${problem.caseId} source ${problem.source}`;
    case 'layerMismatch': return `unit layer ${problem.unitLayer} does not match case ${problem.caseId} layer ${problem.caseLayer}`;
  }
};
