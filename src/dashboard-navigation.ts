export type DashboardPage = 'daily' | 'release' | 'catalog';

export type DashboardNavigation = Readonly<{
  active: DashboardPage;
  rootPrefix: string;
}>;

const pages: ReadonlyArray<Readonly<{ page: DashboardPage; href: string; label: string }>> = [
  { page: 'daily', href: 'index.html', label: '日次実行' },
  { page: 'release', href: 'release.html', label: 'リリース差分' },
  { page: 'catalog', href: 'catalog/index.html', label: 'ケース探索' },
];

export const renderDashboardNavigation = ({ active, rootPrefix }: DashboardNavigation): string =>
  `<nav class="segmented-nav" aria-label="主要ナビゲーション">${pages.map(({ page, href, label }) =>
    `<a href="${rootPrefix}${href}"${page === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
