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

test('テスト層でケースを絞り込める', async ({ qualitySite }) => {
  await qualitySite.catalog.open();
  await qualitySite.catalog.expectLoaded();
  await qualitySite.catalog.filterByLayer('unit');
});

test('トップはfeatureを畳んで出し、開くか検索するとfeatureが見える', async ({ qualitySite }) => {
  await qualitySite.top.open();
  await qualitySite.top.expectLoaded();
  await qualitySite.top.expectFeaturesFolded();
  await qualitySite.top.openFirstDomainWithKeyboard();
  await qualitySite.top.open();
  await qualitySite.top.searchShowsFeature('請求');
});

test('featureのページで絞った条件のままケース検索を開ける', async ({ qualitySite }) => {
  await qualitySite.document.open('order-cancellation');
  const count = await qualitySite.document.filterByLayer('unit');
  await qualitySite.document.openInCaseSearch();
  await qualitySite.catalog.expectLoaded();
  await qualitySite.catalog.expectVisibleCases(count);
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
