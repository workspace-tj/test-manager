export const escapeHtml = (value: unknown): string => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const renderAppHeader = ({ homeHref, navigationHtml, spacer = false }: Readonly<{
  homeHref: string;
  navigationHtml: string;
  spacer?: boolean;
}>): string => `<header class="app-header"><div class="header-inner"><a class="brand" href="${escapeHtml(homeHref)}"><span class="brand-mark" aria-hidden="true">✓</span><span>Test Manager</span></a>${navigationHtml}${spacer ? '<span class="header-spacer" aria-hidden="true"></span>' : ''}</div></header>`;

export const renderHtmlDocument = ({ title, stylesheetHref, headerHtml, bodyHtml }: Readonly<{
  title: string;
  stylesheetHref: string;
  headerHtml: string;
  bodyHtml: string;
}>): string => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Test Manager</title><link rel="stylesheet" href="${escapeHtml(stylesheetHref)}"></head><body>${headerHtml}<main>${bodyHtml}</main></body></html>\n`;
