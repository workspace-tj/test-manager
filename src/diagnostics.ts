import type { Diagnostic, Location } from './model.js';

export const location = (file: string, line = 1, column = 1): Location => ({ file, line, column });

export const diagnostic = (
  code: string,
  file: string,
  subject: string,
  reason: string,
  line = 1,
  column = 1,
): Diagnostic => ({ code, location: location(file, line, column), subject, reason });

export const formatDiagnostic = (item: Diagnostic): string =>
  `${item.location.file}:${item.location.line}:${item.location.column} ${item.code} ${item.subject}: ${item.reason}`;
