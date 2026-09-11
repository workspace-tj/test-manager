import { z } from 'zod';

export const documentIdSchema = (pattern: RegExp) => z.string().regex(pattern).brand<'DocumentId'>();
export const caseIdSchema = (pattern: RegExp) => z.string().regex(pattern).brand<'CaseId'>();

export type DocumentId = z.infer<ReturnType<typeof documentIdSchema>>;
export type CaseId = z.infer<ReturnType<typeof caseIdSchema>>;
