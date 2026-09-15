import { readFile } from 'node:fs/promises';
import path from 'node:path';

const defaultStylesheet = new URL('./assets/dashboard.css', import.meta.url);

export const loadDashboardStyles = async (overridePath?: string): Promise<string> =>
  readFile(overridePath ? path.resolve(overridePath) : defaultStylesheet, 'utf8');
