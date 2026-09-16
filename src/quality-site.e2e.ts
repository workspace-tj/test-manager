import { test } from './quality-site.e2e.fixture.js';

test('日次・リリース差分・ケース検索を移動してケースを探せる', async ({ qualitySite }) => {
  await qualitySite.daily.open();
  await qualitySite.daily.expectLoaded();
  await qualitySite.daily.expectAccessibleResultTable();
  await qualitySite.navigation.openRelease();
  await qualitySite.release.expectLoaded();
  await qualitySite.navigation.openCaseSearch();
  await qualitySite.catalog.expectLoaded();
  await qualitySite.catalog.searchFor('CASE-108');
  await qualitySite.catalog.expectVisibleCases(1);
});

test('キーボードだけで主要画面とdomain絞り込みを操作できる', async ({ qualitySite }) => {
  await qualitySite.daily.open();
  await qualitySite.navigation.openReleaseWithKeyboard();
  await qualitySite.release.expectLoaded();
  await qualitySite.navigation.openCaseSearchWithKeyboard();
  await qualitySite.catalog.expectLoaded();
  await qualitySite.catalog.focusSearchWithKeyboard();
  await qualitySite.catalog.expectFocusedControlIsVisible();
  await qualitySite.catalog.searchForWithKeyboard('CASE');
  await qualitySite.catalog.filterToFirstDomainWithKeyboard();
});

test('現在のviewportで主要画面に横方向のはみ出しがない', async ({ qualitySite }) => {
  for (const destination of [qualitySite.daily, qualitySite.release, qualitySite.catalog]) {
    await destination.open();
    await destination.expectLoaded();
    await qualitySite.expectNoHorizontalOverflow();
  }
});
