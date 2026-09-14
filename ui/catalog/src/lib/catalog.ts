import type { Catalog, KnowledgeDocument, ManagedCase } from '../../../../src/model.ts';

declare const __TEST_MANAGER_CATALOG__: Catalog;

export const catalog = __TEST_MANAGER_CATALOG__;
export const documents = catalog.documents;
export const cases = catalog.cases;
export const documentById = new Map(documents.map((document) => [document.id, document]));

export const safeName = (value: string): string => encodeURIComponent(value);

export const breadcrumbs = (document: KnowledgeDocument): ReadonlyArray<KnowledgeDocument> => {
  const result: KnowledgeDocument[] = [document];
  let current = document;
  while (current.parent) {
    const parent = documentById.get(current.parent);
    if (!parent) break;
    result.unshift(parent);
    current = parent;
  }
  return result;
};

export const rootDocument = (document: KnowledgeDocument): KnowledgeDocument => {
  const path = breadcrumbs(document);
  return path[0] ?? document;
};

export const domainOf = (managedCase: ManagedCase): KnowledgeDocument | undefined => {
  const membership = documentById.get(managedCase.fields.belongsTo);
  return membership ? rootDocument(membership) : undefined;
};

export const casesBelow = (document: KnowledgeDocument): ReadonlyArray<ManagedCase> => cases.filter((managedCase) => {
  const membership = documentById.get(managedCase.fields.belongsTo);
  return membership ? breadcrumbs(membership).some((ancestor) => ancestor.id === document.id) : false;
});
