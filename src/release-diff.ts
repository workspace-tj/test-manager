import { observedCaseStatus } from './case-result.js';
import type { ObservedCaseStatus } from './case-result.js';
import type { ReleaseCatalogCase, ReleaseCatalogSnapshot } from './release-catalog.js';
import type { TestRun } from './test-run.js';

type LatestResult = Readonly<
  | { kind: 'notProvided' | 'notInRun' | 'missing' | 'notApplicable' }
  | { kind: 'observed'; status: ObservedCaseStatus }
>;

type Verification = Readonly<
  | { kind: 'manual' }
  | { kind: 'automated'; source: Exclude<ReleaseCatalogCase['source'], 'manual'>; latest: LatestResult }
>;

export type ReleaseCaseChange = Readonly<{
  kind: 'added' | 'changed' | 'removed';
  caseId: string;
  title: string;
  verification: Verification;
}>;

export type ReleaseGroup = Readonly<{
  domainId: string;
  domainTitle: string;
  featureId?: string;
  featureTitle?: string;
  changes: ReadonlyArray<ReleaseCaseChange>;
  inventory: ReadonlyArray<Readonly<{ caseId: string; title: string; definition: 'active' | 'skip' | 'todo'; change: 'added' | 'changed' | 'unchanged'; verification: Verification }>>;
}>;

export type ReleaseDiffView = Readonly<{
  productionCommit: string;
  stagingCommit: string;
  groups: ReadonlyArray<ReleaseGroup>;
}>;

type ReleaseDiffInput = Readonly<{
  production: ReleaseCatalogSnapshot;
  staging: Readonly<{ snapshot: ReleaseCatalogSnapshot; latestRun?: TestRun }>;
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

const verificationFor = (managedCase: ReleaseCatalogCase, run: TestRun | undefined, removed: boolean): Verification => {
  if (managedCase.source === 'manual') return { kind: 'manual' };
  return { kind: 'automated', source: managedCase.source, latest: removed ? { kind: 'notApplicable' } : latestFor(managedCase.id, run) };
};

export const buildReleaseDiff = (input: ReleaseDiffInput): ReleaseDiffResult => {
  const problems: string[] = [];
  if (input.production.commit === input.staging.snapshot.commit) problems.push('production and staging commits must differ');
  if (input.staging.latestRun && (input.staging.latestRun.environment !== 'staging' || input.staging.latestRun.commit !== input.staging.snapshot.commit)) {
    problems.push('staging run must use the staging environment and commit');
  }
  const stagingCases = new Map(input.staging.snapshot.cases.map((item) => [item.id, item]));
  for (const unit of input.staging.latestRun?.units ?? []) for (const caseId of unit.plannedCaseIds) {
    const managedCase = stagingCases.get(caseId);
    if (!managedCase) problems.push(`staging run contains unknown case ${caseId}`);
    else if (managedCase.source === 'manual' || managedCase.source === 'storybook' || managedCase.source !== unit.runner) {
      problems.push(`staging run runner ${unit.runner} does not match case ${caseId} source ${managedCase.source}`);
    }
  }
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
      verification: verificationFor(change.managedCase, input.staging.latestRun, change.kind === 'removed'),
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
      caseId: managedCase.id, title: managedCase.title, definition: managedCase.status,
      change: change === 'added' || change === 'changed' ? change : 'unchanged',
      verification: verificationFor(managedCase, input.staging.latestRun, false),
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
