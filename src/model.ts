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
  | { required: false; requiredWhen?: Readonly<{ field: string; equals: string | number }> | undefined }
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
    type: 'enum' | 'integer-enum';
    values: Readonly<Record<string, Readonly<{ description: string }>>>;
  }
  | { type: 'text' }
  | {
    type: 'text-list';
    minItems?: number | undefined;
    uniqueItems?: boolean | undefined;
  }
> & Readonly<{ placement: 'classification' | 'detail' }>;

export type SourceKind = 'vitest' | 'playwright' | 'storybook';
export type ProjectRules = Readonly<{
  version: 1;
  idPattern: string;
  discovery: Readonly<{
    documents: ReadonlyArray<string>;
    manualCases: ReadonlyArray<string>;
    sources: ReadonlyArray<Readonly<{ kind: SourceKind; paths: ReadonlyArray<string> }>>;
  }>;
  documents: Readonly<{ kinds: Readonly<Record<string, KindRule>> }>;
  case: Readonly<{ fields: Readonly<Record<string, FieldRule>> }>;
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

export type CaseSource = 'manual' | SourceKind;
export type CaseFields = Readonly<{ owner: DocumentId; refs?: ReadonlyArray<DocumentId>; readonly [key: string]: unknown }>;
type CaseBase = Readonly<{
  id: CaseId;
  title: string;
  fields: CaseFields;
  details: Readonly<Record<string, unknown>>;
  location: Location;
  snippet: string;
}>;

export type ManagedCase = Readonly<
  | (CaseBase & { source: 'manual'; status: 'active'; procedure: ReadonlyArray<Readonly<{ action: string; expected: string }>> })
  | (CaseBase & { source: 'vitest'; status: 'active' | 'skip' | 'todo'; parameters?: ReadonlyArray<unknown>; procedure?: never })
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
