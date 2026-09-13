import path from 'node:path';
import fg from 'fast-glob';
import type { Catalog, CheckResult, Diagnostic, ManagedCase } from './model.js';
import { diagnostic } from './diagnostics.js';
import { loadRules } from './rules.js';
import { readKnowledgeDocument, validateDocumentDisplayOrder, validateDocumentGraph } from './documents.js';
import { readManualCase } from './manual.js';
import { readTestSource } from './source.js';

const discover = async (patterns: ReadonlyArray<string>, root: string): Promise<ReadonlyArray<string>> =>
  fg([...patterns], { cwd: root, absolute: true, onlyFiles: true, unique: true, dot: false }).then((files) => files.sort());

const discoverConfigured = async (patterns: ReadonlyArray<string>, root: string, configFile: string): Promise<Readonly<{ files: ReadonlyArray<string>; diagnostics: ReadonlyArray<Diagnostic> }>> => {
  const matches = await Promise.all(patterns.map(async (pattern) => ({ pattern, files: await discover([pattern], root) })));
  const owners = new Map<string, string>();
  const overlapDiagnostics: Diagnostic[] = [];
  for (const match of matches) for (const file of match.files) {
    const previous = owners.get(file);
    if (previous) overlapDiagnostics.push(diagnostic('TM010', path.relative(root, file), 'discovery', `file matches both ${previous} and ${match.pattern}`));
    else owners.set(file, match.pattern);
  }
  return {
    files: [...new Set(matches.flatMap((match) => match.files))].sort(),
    diagnostics: [...matches.filter((match) => match.files.length === 0).map((match) => diagnostic('TM011', configFile, match.pattern, 'configured discovery pattern matched no files')), ...overlapDiagnostics],
  };
};

export const checkProject = async (configPath: string): Promise<CheckResult> => {
  const absoluteConfig = path.resolve(configPath);
  const projectRoot = path.dirname(absoluteConfig);
  const loaded = await loadRules(absoluteConfig);
  if (!loaded.rules) return { ok: false, diagnostics: loaded.diagnostics };
  const rules = loaded.rules;
  const diagnostics: Diagnostic[] = [];
  const configFile = path.relative(projectRoot, absoluteConfig);
  const documentDiscovery = await discoverConfigured(rules.discovery.documents, projectRoot, configFile);
  const manualDiscovery = await discoverConfigured(rules.discovery.manualCases, projectRoot, configFile);
  const documentFiles = documentDiscovery.files;
  const manualFiles = manualDiscovery.files;
  const sourceMatches = await Promise.all(rules.discovery.sources.map(async (source) => ({ source, ...(await discoverConfigured(source.paths, projectRoot, configFile)) })));
  diagnostics.push(...documentDiscovery.diagnostics, ...manualDiscovery.diagnostics, ...sourceMatches.flatMap((match) => match.diagnostics));

  const ownership = new Map<string, string>();
  for (const group of [{ name: 'documents', files: documentFiles }, { name: 'manualCases', files: manualFiles }, ...sourceMatches.map(({ source, files }) => ({ name: source.kind, files }))]) {
    for (const file of group.files) {
      const previous = ownership.get(file);
      if (previous) diagnostics.push(diagnostic('TM010', path.relative(projectRoot, file), 'discovery', `file matches both ${previous} and ${group.name}`));
      else ownership.set(file, group.name);
    }
  }

  const documentResults = await Promise.all(documentFiles.map((file) => readKnowledgeDocument(file, projectRoot, rules)));
  const documents = documentResults.flatMap((result) => result.document ? [result.document] : []);
  diagnostics.push(
    ...documentResults.flatMap((result) => result.diagnostics),
    ...validateDocumentGraph(documents, rules),
    ...validateDocumentDisplayOrder(documents, rules, configFile),
  );

  const manualResults = await Promise.all(manualFiles.map((file) => readManualCase(file, projectRoot, rules, documents)));
  const sourceResults = await Promise.all(sourceMatches.flatMap(({ source, files }) => files.map((file) => readTestSource(file, projectRoot, source.kind, rules, documents))));
  const cases: ManagedCase[] = [
    ...manualResults.flatMap((result) => result.managedCase ? [result.managedCase] : []),
    ...sourceResults.flatMap((result) => result.cases),
  ];
  diagnostics.push(...manualResults.flatMap((result) => result.diagnostics), ...sourceResults.flatMap((result) => result.diagnostics));
  const caseIds = new Map<string, ManagedCase>();
  for (const managedCase of cases) {
    const duplicate = caseIds.get(managedCase.id);
    if (duplicate) diagnostics.push(diagnostic('TM140', managedCase.location.file, managedCase.id, `duplicate case ID; first declared in ${duplicate.location.file}`));
    else caseIds.set(managedCase.id, managedCase);
  }
  const documentIds = new Set<string>(documents.map((document) => document.id));
  for (const managedCase of cases) if (documentIds.has(managedCase.id)) diagnostics.push(diagnostic('TM141', managedCase.location.file, managedCase.id, 'ID collides with a document ID'));
  if (diagnostics.length > 0) return { ok: false, diagnostics: diagnostics.sort((a, b) => `${a.location.file}:${a.code}`.localeCompare(`${b.location.file}:${b.code}`)) };
  const catalog: Catalog = { configPath: absoluteConfig, projectRoot, rules, documents, cases };
  return { ok: true, catalog };
};
