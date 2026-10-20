import { observedCaseStatus } from './case-result.js';
import type { ObservedCaseStatus } from './case-result.js';
import { sameReleaseCatalogContent } from './release-catalog.js';
import type { ReleaseCatalogCase, ReleaseCatalogSnapshot } from './release-catalog.js';
import type { ManualOutcome, ManualResultSet } from './manual-result.js';
import type { TestRun } from './test-run.js';
import { describeTestRunCatalogProblem, validateTestRunCatalog } from './test-run-catalog.js';

type LatestResult = Readonly<
  | { kind: 'notProvided' | 'notInRun' | 'missing' | 'notApplicable' }
  | { kind: 'observed'; status: ObservedCaseStatus }
>;

type ManualLatest = Readonly<
  | { kind: 'notProvided' | 'notRecorded' | 'notApplicable' }
  | { kind: 'recorded'; outcome: ManualOutcome; commit: string; executedAt: string; executedBy?: string; changedSinceExecution: boolean }
>;

type Verification = Readonly<
  | { kind: 'manual'; latest: ManualLatest }
  | { kind: 'automated'; source: Exclude<ReleaseCatalogCase['source'], 'manual'>; latest: LatestResult }
>;

export type ReleaseCaseChange = Readonly<{
  kind: 'added' | 'changed' | 'removed';
  caseId: string;
  title: string;
  layer: string;
  previousLayer?: string;
  verification: Verification;
}>;

export type ReleaseGroup = Readonly<{
  domainId: string;
  domainTitle: string;
  featureId?: string;
  featureTitle?: string;
  changes: ReadonlyArray<ReleaseCaseChange>;
  inventory: ReadonlyArray<Readonly<{ caseId: string; title: string; layer: string; previousLayer?: string; definition: 'active' | 'skip' | 'todo'; change: 'added' | 'changed' | 'unchanged'; verification: Verification }>>;
}>;

export type ReleaseDiffView = Readonly<{
  productionCommit: string;
  stagingCommit: string;
  groups: ReadonlyArray<ReleaseGroup>;
}>;

type ReleaseDiffInput = Readonly<{
  production: ReleaseCatalogSnapshot;
  staging: Readonly<{ snapshot: ReleaseCatalogSnapshot; latestRun?: TestRun }>;
  manual?: Readonly<{ resultSets: ReadonlyArray<ManualResultSet>; snapshots: ReadonlyArray<ReleaseCatalogSnapshot> }>;
}>;

export type ReleaseDiffResult = Readonly<
  | { ok: true; view: ReleaseDiffView }
  | { ok: false; problems: ReadonlyArray<string> }
>;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
};

const sameCase = (left: ReleaseCatalogCase, right: ReleaseCatalogCase): boolean =>
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

type ReleaseDocument = ReleaseCatalogSnapshot['documents'][number];
const rootDocument = (document: ReleaseDocument, documents: ReadonlyMap<string, ReleaseDocument>): ReleaseDocument => {
  let current = document;
  while (current.parent) {
    const parent = documents.get(current.parent);
    if (!parent) break;
    current = parent;
  }
  return current;
};

const latestFor = (caseId: string, run: TestRun | undefined): LatestResult => {
  if (!run) return { kind: 'notProvided' };
  for (const unit of run.units) {
    const observation = unit.observations.find((item) => item.caseId === caseId);
    if (observation) return { kind: 'observed', status: observedCaseStatus(observation) };
    if (unit.plannedCaseIds.some((plannedCaseId) => plannedCaseId === caseId)) return { kind: 'missing' };
  }
  return { kind: 'notInRun' };
};

type ManualRecord = Readonly<{ set: ManualResultSet; result: ManualResultSet['results'][number]; executedCase: ReleaseCatalogCase }>;

const manualLatestFor = (managedCase: ReleaseCatalogCase, records: ReadonlyMap<string, ManualRecord> | undefined, removed: boolean): ManualLatest => {
  if (removed) return { kind: 'notApplicable' };
  if (!records) return { kind: 'notProvided' };
  const record = records.get(managedCase.id);
  if (!record) return { kind: 'notRecorded' };
  return {
    kind: 'recorded',
    outcome: record.result.outcome,
    commit: record.set.commit,
    executedAt: record.result.executedAt,
    ...(record.set.executedBy === undefined ? {} : { executedBy: record.set.executedBy }),
    changedSinceExecution: !sameCase(record.executedCase, managedCase),
  };
};

const verificationFor = (managedCase: ReleaseCatalogCase, run: TestRun | undefined, removed: boolean, manualRecords?: ReadonlyMap<string, ManualRecord>): Verification => {
  if (managedCase.source === 'manual') return { kind: 'manual', latest: manualLatestFor(managedCase, manualRecords, removed) };
  return { kind: 'automated', source: managedCase.source, latest: removed ? { kind: 'notApplicable' } : latestFor(managedCase.id, run) };
};

const collectManualRecords = (input: ReleaseDiffInput, problems: string[]): ReadonlyMap<string, ManualRecord> => {
  const snapshots = new Map<string, ReleaseCatalogSnapshot>();
  for (const snapshot of [input.production, input.staging.snapshot, ...(input.manual?.snapshots ?? [])]) {
    const known = snapshots.get(snapshot.commit);
    if (known && !sameReleaseCatalogContent(known, snapshot)) problems.push(`catalog snapshots for ${snapshot.commit} have different content`);
    else if (!known) snapshots.set(snapshot.commit, snapshot);
  }
  const snapshotFor = (commit: string): ReleaseCatalogSnapshot | 'ambiguous' | undefined => {
    const exact = snapshots.get(commit);
    if (exact) return exact;
    const candidates = [...snapshots.values()].filter((snapshot) => snapshot.commit.startsWith(commit) || commit.startsWith(snapshot.commit));
    return candidates.length > 1 ? 'ambiguous' : candidates[0];
  };
  const records = new Map<string, ManualRecord>();
  for (const set of input.manual?.resultSets ?? []) {
    if (set.environment !== 'staging') {
      problems.push(`manual result set for ${set.commit} must use the staging environment`);
      continue;
    }
    const snapshot = snapshotFor(set.commit);
    if (!snapshot || snapshot === 'ambiguous') {
      problems.push(snapshot ? `manual result set commit ${set.commit} matches several catalog snapshots` : `manual result set for ${set.commit} has no catalog snapshot for that commit`);
      continue;
    }
    for (const result of set.results) {
      const executedCase = snapshot.cases.find((item) => item.id === result.caseId);
      if (!executedCase) problems.push(`manual result for ${result.caseId} does not exist in the catalog at ${set.commit}`);
      else if (executedCase.source !== 'manual') problems.push(`manual result for ${result.caseId} targets a ${executedCase.source} case at ${set.commit}`);
      else {
        const previous = records.get(result.caseId);
        const order = previous ? Date.parse(result.executedAt) - Date.parse(previous.result.executedAt) : 1;
        if (previous && order === 0 && (previous.result.outcome !== result.outcome || previous.set.commit !== set.commit)) {
          problems.push(`manual results for ${result.caseId} at ${result.executedAt} disagree`);
        } else if (order > 0) records.set(result.caseId, { set, result, executedCase });
      }
    }
  }
  return records;
};

export const buildReleaseDiff = (input: ReleaseDiffInput): ReleaseDiffResult => {
  const problems: string[] = [];
  if (input.production.commit === input.staging.snapshot.commit) problems.push('production and staging commits must differ');
  if (input.staging.latestRun && (input.staging.latestRun.environment !== 'staging' || input.staging.latestRun.commit !== input.staging.snapshot.commit)) {
    problems.push('staging run must use the staging environment and commit');
  }
  if (input.staging.latestRun) for (const problem of validateTestRunCatalog(input.staging.snapshot.cases, input.staging.latestRun)) {
    problems.push(`staging run ${describeTestRunCatalogProblem(problem)}`);
  }
  const manualRecords = input.manual ? collectManualRecords(input, problems) : undefined;
  if (problems.length > 0) return { ok: false, problems };

  const previousById = new Map(input.production.cases.map((item) => [item.id, item]));
  const currentById = new Map(input.staging.snapshot.cases.map((item) => [item.id, item]));
  const changes: Array<Readonly<{ kind: ReleaseCaseChange['kind']; managedCase: ReleaseCatalogCase; snapshot: ReleaseCatalogSnapshot }>> = [];
  for (const managedCase of input.staging.snapshot.cases) {
    const previous = previousById.get(managedCase.id);
    if (!previous) changes.push({ kind: 'added', managedCase, snapshot: input.staging.snapshot });
    else if (!sameCase(previous, managedCase)) changes.push({ kind: 'changed', managedCase, snapshot: input.staging.snapshot });
  }
  for (const managedCase of input.production.cases) {
    if (!currentById.has(managedCase.id)) changes.push({ kind: 'removed', managedCase, snapshot: input.production });
  }

  const layerMove = (managedCase: ReleaseCatalogCase): Readonly<{ previousLayer?: string }> => {
    const previousLayer = previousById.get(managedCase.id)?.layer;
    return previousLayer !== undefined && previousLayer !== managedCase.layer ? { previousLayer } : {};
  };
  const grouped = new Map<string, ReleaseGroup>();
  for (const change of changes) {
    const documents = new Map(change.snapshot.documents.map((document) => [document.id, document]));
    const membership = documents.get(change.managedCase.fields.belongsTo);
    if (!membership) return { ok: false, problems: [`case ${change.managedCase.id} has no membership document`] };
    const domain = rootDocument(membership, documents);
    const feature = membership.id === domain.id ? undefined : membership;
    const key = `${domain.id}\u0000${feature?.id ?? ''}`;
    const item: ReleaseCaseChange = {
      kind: change.kind,
      caseId: change.managedCase.id,
      title: change.managedCase.title,
      layer: change.managedCase.layer,
      ...layerMove(change.managedCase),
      verification: verificationFor(change.managedCase, input.staging.latestRun, change.kind === 'removed', manualRecords),
    };
    const existing = grouped.get(key);
    grouped.set(key, existing
      ? { ...existing, changes: [...existing.changes, item] }
      : {
        domainId: domain.id,
        domainTitle: domain.title,
        ...(feature ? { featureId: feature.id, featureTitle: feature.title } : {}),
        changes: [item], inventory: [],
      });
  }
  const groupForCurrentCase = (managedCase: ReleaseCatalogCase): string | undefined => {
    const documents = new Map(input.staging.snapshot.documents.map((document) => [document.id, document]));
    const membership = documents.get(managedCase.fields.belongsTo);
    if (!membership) return undefined;
    const domain = rootDocument(membership, documents);
    return `${domain.id}\u0000${membership.id === domain.id ? '' : membership.id}`;
  };
  for (const managedCase of input.staging.snapshot.cases) {
    const key = groupForCurrentCase(managedCase);
    if (!key) continue;
    const group = grouped.get(key);
    if (!group) continue;
    const change = group.changes.find((item) => item.caseId === managedCase.id)?.kind;
    const inventoryItem = {
      caseId: managedCase.id, title: managedCase.title, layer: managedCase.layer, ...layerMove(managedCase), definition: managedCase.status,
      change: change === 'added' || change === 'changed' ? change : 'unchanged',
      verification: verificationFor(managedCase, input.staging.latestRun, false, manualRecords),
    } as const;
    grouped.set(key, { ...group, inventory: [...group.inventory, inventoryItem] });
  }
  const groups = [...grouped.values()]
    .map((group) => ({
      ...group,
      changes: [...group.changes].sort((left, right) => left.caseId.localeCompare(right.caseId)),
      inventory: [...group.inventory].sort((left, right) => left.caseId.localeCompare(right.caseId)),
    }))
    .sort((left, right) => `${left.domainId}/${left.featureId ?? ''}`.localeCompare(`${right.domainId}/${right.featureId ?? ''}`));
  return { ok: true, view: { productionCommit: input.production.commit, stagingCommit: input.staging.snapshot.commit, groups } };
};
