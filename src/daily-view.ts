import { sortDocumentsForDisplay } from './documents.js';
import type { Catalog, KnowledgeDocument, ManagedCase } from './model.js';
import type { CaseId, DocumentId } from './ids.js';
import type { TestRun } from './test-run.js';
import { observedCaseStatus } from './case-result.js';
import type { ObservedCaseStatus } from './case-result.js';
import { validateTestRunCatalog } from './test-run-catalog.js';
import type { TestRunCatalogProblem } from './test-run-catalog.js';

type CaseStatus = ObservedCaseStatus | 'missing';

export type DailyChange = Readonly<{
  caseId: CaseId;
  title: string;
  domainId: DocumentId;
  kind: 'newFailure' | 'recovered' | 'resultMissing';
}>;

export type DailyDomain = Readonly<{
  id: DocumentId;
  title: string;
  planned: number;
  passed: number;
  failed: number;
  expectedFailure: number;
  unexpectedPass: number;
  skipped: number;
  missing: number;
}>;

export type DailyView = Readonly<{
  run: TestRun;
  comparison: Readonly<
    | { state: 'available'; previousRunId: TestRun['runId'] }
    | { state: 'unavailable'; reason: 'noPrevious' | 'differentEnvironment' | 'differentScope' | 'previousIsNewer' }
  >;
  changes: ReadonlyArray<DailyChange>;
  domains: ReadonlyArray<DailyDomain>;
}>;

export type DailyViewResult = Readonly<
  | { ok: true; view: DailyView }
  | { ok: false; problems: ReadonlyArray<TestRunCatalogProblem> }
>;

const observedStatuses = (run: TestRun): ReadonlyMap<CaseId, ObservedCaseStatus> => new Map(
  run.units.flatMap((unit) => unit.observations.map((observation) => [observation.caseId, observedCaseStatus(observation)] as const)),
);

const plannedCaseIds = (run: TestRun): ReadonlyArray<CaseId> => run.units.flatMap((unit) => unit.plannedCaseIds);

const caseStatuses = (run: TestRun): ReadonlyMap<CaseId, CaseStatus> => {
  const observed = observedStatuses(run);
  return new Map(plannedCaseIds(run).map((caseId) => [caseId, observed.get(caseId) ?? 'missing']));
};

const comparisonFor = (current: TestRun, previous: TestRun | undefined): DailyView['comparison'] => {
  if (!previous) return { state: 'unavailable', reason: 'noPrevious' };
  if (previous.environment !== current.environment) return { state: 'unavailable', reason: 'differentEnvironment' };
  if (previous.scopeId !== current.scopeId) return { state: 'unavailable', reason: 'differentScope' };
  if (Date.parse(previous.completedAt) > Date.parse(current.completedAt)) return { state: 'unavailable', reason: 'previousIsNewer' };
  return { state: 'available', previousRunId: previous.runId };
};

const rootDocument = (document: KnowledgeDocument, byId: ReadonlyMap<DocumentId, KnowledgeDocument>): KnowledgeDocument => {
  let current = document;
  while (current.parent) {
    const parent = byId.get(current.parent);
    if (!parent) break;
    current = parent;
  }
  return current;
};

export const buildDailyView = (catalog: Catalog, current: TestRun, previous?: TestRun): DailyViewResult => {
  const casesById = new Map(catalog.cases.map((managedCase) => [managedCase.id, managedCase]));
  const currentPlanned = plannedCaseIds(current);
  const problems = validateTestRunCatalog(catalog.cases, current);
  if (problems.length > 0) return { ok: false, problems };

  const documentsById = new Map(catalog.documents.map((document) => [document.id, document]));
  const domainFor = (managedCase: ManagedCase): KnowledgeDocument => {
    const membership = documentsById.get(managedCase.fields.belongsTo);
    if (!membership) throw new Error(`catalog invariant violated: membership ${managedCase.fields.belongsTo} is missing`);
    return rootDocument(membership, documentsById);
  };
  const belongsTo = catalog.rules.case.fields.belongsTo;
  const membershipKinds = belongsTo?.type === 'reference' ? new Set(belongsTo.targetKinds) : new Set<string>();
  const domainIds = new Set(catalog.documents
    .filter((document) => membershipKinds.has(document.kind))
    .map((document) => rootDocument(document, documentsById).id));
  const domains = sortDocumentsForDisplay(catalog.documents, catalog.rules)
    .filter((document) => domainIds.has(document.id));
  const currentStatuses = caseStatuses(current);
  const comparison = comparisonFor(current, previous);
  const previousStatuses = comparison.state === 'available' && previous ? caseStatuses(previous) : new Map<CaseId, CaseStatus>();

  const changes: DailyChange[] = [];
  for (const caseId of currentPlanned) {
    const managedCase = casesById.get(caseId);
    if (!managedCase) continue;
    const status = currentStatuses.get(caseId);
    const previousStatus = previousStatuses.get(caseId);
    const kind = status === 'missing'
      ? 'resultMissing'
      : status === 'failed' && previousStatus !== undefined && previousStatus !== 'failed' && previousStatus !== 'missing'
        ? 'newFailure'
        : status === 'passed' && previousStatus === 'failed'
          ? 'recovered'
          : undefined;
    if (kind) changes.push({ caseId, title: managedCase.title, domainId: domainFor(managedCase).id, kind });
  }

  const domainRows = domains.map((domain): DailyDomain => {
    const statuses = currentPlanned.flatMap((caseId): ReadonlyArray<CaseStatus> => {
      const managedCase = casesById.get(caseId);
      return managedCase && domainFor(managedCase).id === domain.id ? [currentStatuses.get(caseId) ?? 'missing'] : [];
    });
    const count = (status: CaseStatus): number => statuses.filter((item) => item === status).length;
    return {
      id: domain.id,
      title: domain.title,
      planned: statuses.length,
      passed: count('passed'),
      failed: count('failed'),
      expectedFailure: count('expectedFailure'),
      unexpectedPass: count('unexpectedPass'),
      skipped: count('skipped'),
      missing: count('missing'),
    };
  });

  return { ok: true, view: { run: current, comparison, changes, domains: domainRows } };
};
