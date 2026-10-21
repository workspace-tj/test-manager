import type { CaseId, DocumentId } from './ids.js';

export type Location = Readonly<{ file: string; line: number; column: number }>;

export type Diagnostic = Readonly<{
  code: string;
  location: Location;
  subject: string;
  reason: string;
}>;

export type KindRule = Readonly<{
  description: string;
  parent: Readonly<{ required: boolean; targetKinds: ReadonlyArray<string> }>;
}>;

type FieldRequiredness = Readonly<
  | { required: true; requiredWhen?: undefined }
  | { required: false; requiredWhen?: Readonly<{ field: string; in: ReadonlyArray<string | number> }> | undefined }
>;

export type FieldRule = FieldRequiredness & Readonly<
  | {
    type: 'reference';
    targetKinds: ReadonlyArray<string>;
  }
  | {
    type: 'reference-list';
    targetKinds: ReadonlyArray<string>;
    minItems?: number | undefined;
    uniqueItems?: boolean | undefined;
  }
  | {
    type: 'enum';
    values: Readonly<Record<string, Readonly<{ label?: string; description: string }>>>;
    playwrightTag?: string;
  }
  | {
    type: 'integer-enum';
    values: Readonly<Record<string, Readonly<{ label?: string; description: string }>>>;
  }
  | { type: 'text' }
  | {
    type: 'text-list';
    minItems?: number | undefined;
    uniqueItems?: boolean | undefined;
  }
> & Readonly<{ label?: string; placement: 'classification' | 'detail' }>;

export const sourceKinds = ['vitest', 'playwright', 'storybook'] as const;
export type SourceKind = typeof sourceKinds[number];
export type ProjectRules = Readonly<{
  version: 1;
  idPattern: string;
  discovery: Readonly<{
    documents: ReadonlyArray<string>;
    layers: ReadonlyArray<Readonly<{ name: string; description?: string }>>;
    sources: ReadonlyArray<Readonly<{ kind: CaseSource; layer: string; paths: ReadonlyArray<string> }>>;
  }>;
  documents: Readonly<{
    kinds: Readonly<Record<string, KindRule>>;
    displayOrder: Readonly<Record<string, ReadonlyArray<string>>>;
  }>;
  case: Readonly<{ fields: Readonly<Record<string, FieldRule>> }>;
  runners?: Readonly<{ [Kind in 'vitest' | 'playwright']?: Readonly<{ testModules: ReadonlyArray<string> }> | undefined }> | undefined;
  reports?: Readonly<{ breakdowns: ReadonlyArray<Readonly<{ rows: string; columns: string }>> }> | undefined;
}>;

export type KnowledgeDocument = Readonly<{
  id: DocumentId;
  kind: string;
  title: string;
  parent?: DocumentId;
  refs?: ReadonlyArray<DocumentId>;
  body: string;
  location: Location;
  fieldLocations?: Readonly<Record<string, Location>>;
}>;

export const caseSources = ['manual', ...sourceKinds] as const;
export type CaseSource = typeof caseSources[number];
export type CaseFields = Readonly<{ belongsTo: DocumentId; refs?: ReadonlyArray<DocumentId>; readonly [key: string]: unknown }>;
type CaseBase = Readonly<{
  id: CaseId;
  title: string;
  layer: string;
  fields: CaseFields;
  details: Readonly<Record<string, unknown>>;
  location: Location;
  snippet: string;
}>;

export type ManagedCase = Readonly<
  | (CaseBase & { source: 'manual'; status: 'active'; procedure: ReadonlyArray<Readonly<{ action: string; expected: string }>> })
  | (CaseBase & { source: 'vitest'; status: 'active' | 'skip' | 'todo'; parameters?: ReadonlyArray<unknown>; parametersSource?: string; procedure?: never })
  | (CaseBase & { source: 'playwright'; status: 'active' | 'skip'; procedure?: never })
  | (CaseBase & { source: 'storybook'; status: 'active' | 'skip'; procedure?: never })
>;

export type Catalog = Readonly<{
  configPath: string;
  projectRoot: string;
  rules: ProjectRules;
  documents: ReadonlyArray<KnowledgeDocument>;
  cases: ReadonlyArray<ManagedCase>;
}>;

export type CheckResult = Readonly<
  | { ok: true; catalog: Catalog }
  | { ok: false; diagnostics: ReadonlyArray<Diagnostic> }
>;
