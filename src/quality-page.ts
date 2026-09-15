import type { DashboardPage } from './dashboard-navigation.js';
import { renderDashboardNavigation } from './dashboard-navigation.js';
import { renderAppHeader, renderHtmlDocument } from './html.js';

export const renderQualityPage = ({ active, title, bodyHtml, integrated = false }: Readonly<{
  active: Extract<DashboardPage, 'daily' | 'release'>;
  title: string;
  bodyHtml: string;
  integrated?: boolean;
}>): string => {
  const href = active === 'daily' ? 'index.html' : 'release.html';
  const label = active === 'daily' ? '日次実行' : 'リリース差分';
  const navigationHtml = integrated
    ? renderDashboardNavigation({ active, rootPrefix: '' })
    : `<nav class="segmented-nav" aria-label="主要ナビゲーション"><a href="${href}" aria-current="page">${label}</a></nav>`;
  return renderHtmlDocument({
    title,
    stylesheetHref: 'assets/dashboard.css',
    headerHtml: renderAppHeader({ homeHref: integrated ? 'index.html' : href, navigationHtml }),
    bodyHtml,
  });
};
