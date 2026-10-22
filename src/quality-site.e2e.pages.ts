import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const tabTo = async (page: Page, target: Locator): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('keyboard focus did not reach the requested control');
};

class DestinationPage {
  readonly page: Page;
  readonly #url: string;
  readonly #heading: string;

  constructor(page: Page, url: string, heading: string) {
    this.page = page;
    this.#url = url;
    this.#heading = heading;
  }

  async open(): Promise<void> {
    await this.page.goto(this.#url);
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: this.#heading, exact: true })).toBeVisible();
  }
}

class DailyPage extends DestinationPage {
  readonly #page: Page;

  constructor(page: Page, origin: string) {
    super(page, origin, 'stagingの日次実行');
    this.#page = page;
  }

  async expectAccessibleResultTable(): Promise<void> {
    const rows = this.#page.locator('[role="rowgroup"] [role="row"]');
    await expect(rows).not.toHaveCount(0);
    expect(await rows.evaluateAll((items) => items.every((row) => [...row.children].every((cell) => {
      const role = cell.getAttribute('role');
      return role === 'rowheader' || role === 'cell';
    })))).toBe(true);
    await expect(this.#page.getByRole('progressbar').first()).toBeVisible();
  }
}

class DashboardNavigation {
  readonly #page: Page;

  constructor(page: Page) {
    this.#page = page;
  }

  async openRelease(): Promise<void> {
    await this.#page.getByRole('link', { name: 'リリース差分' }).click();
  }

  async openCaseSearch(): Promise<void> {
    await this.#page.getByRole('link', { name: 'ケース探索' }).click();
  }

  async openReleaseWithKeyboard(): Promise<void> {
    const link = this.#page.getByRole('link', { name: 'リリース差分' });
    await tabTo(this.#page, link);
    await this.#page.keyboard.press('Enter');
  }

  async openCaseSearchWithKeyboard(): Promise<void> {
    const link = this.#page.getByRole('link', { name: 'ケース探索' });
    await tabTo(this.#page, link);
    await this.#page.keyboard.press('Enter');
  }
}

class CatalogSearchPage extends DestinationPage {
  readonly #page: Page;

  constructor(page: Page, origin: string) {
    super(page, `${origin}/catalog/cases/index.html`, 'ケース検索');
    this.#page = page;
  }

  async searchFor(query: string): Promise<void> {
    await this.#page.getByRole('searchbox').fill(query);
  }

  async searchForWithKeyboard(query: string): Promise<void> {
    await this.#page.keyboard.type(query);
  }

  async expectVisibleCases(count: number): Promise<void> {
    await expect(this.#page.locator('[data-case-row]:visible')).toHaveCount(count);
    await expect(this.#page.locator('#result-summary')).toHaveText(`${count}ケース`);
  }

  async filterByLayer(layer: string): Promise<void> {
    await this.#page.getByLabel('テスト層').selectOption(layer);
    const rows = this.#page.locator('[data-case-row]:visible');
    await expect(rows.first()).toBeVisible();
    expect(await rows.evaluateAll((items, selectedLayer) => items.every((item) => JSON.parse(item.getAttribute('data-filters') ?? '{}').layer === selectedLayer), layer)).toBe(true);
    const total = Number.parseInt(await this.#page.locator('.catalog-intro strong span').innerText(), 10);
    expect(await rows.count()).toBeLessThan(total);
    await expect(this.#page).toHaveURL(new RegExp(`[?&]layer=${layer}(?:&|$)`, 'u'));
  }

  async focusSearchWithKeyboard(): Promise<void> {
    await tabTo(this.#page, this.#page.getByRole('searchbox'));
  }

  async filterToFirstDomainWithKeyboard(): Promise<void> {
    const control = this.#page.locator('[data-domain-filter]:not([data-domain-filter=""])').first();
    const domainId = await control.getAttribute('data-domain-filter');
    const expectedCount = Number.parseInt(await control.locator('small').innerText(), 10);
    if (!domainId || !Number.isInteger(expectedCount)) throw new Error('domain filter must expose its ID and case count');
    await tabTo(this.#page, control);
    await this.#page.keyboard.press('Space');
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    const rows = this.#page.locator('[data-case-row]:visible');
    await expect(rows).toHaveCount(expectedCount);
    expect(await rows.evaluateAll((items, selectedDomain) => items.every((item) => item.getAttribute('data-domain') === selectedDomain), domainId)).toBe(true);
    await expect(this.#page.locator('#result-summary')).toHaveText(`${expectedCount}ケース`);
  }

  async expectFocusedControlIsVisible(): Promise<void> {
    expect(await this.#page.evaluate(() => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement)) return false;
      const style = getComputedStyle(focused);
      return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
    })).toBe(true);
  }
}

class CatalogTopPage extends DestinationPage {
  constructor(page: Page, origin: string) {
    super(page, `${origin}/catalog/index.html`, 'ドメインから確認内容をたどる');
  }

  async expectFeaturesFolded(): Promise<void> {
    await expect(this.page.locator('[data-feature-row]:visible')).toHaveCount(0);
  }

  async openFirstDomainWithKeyboard(): Promise<void> {
    const toggle = this.page.locator('[data-domain-toggle]').first();
    await toggle.focus();
    await this.page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(this.page.locator('[data-domain-overview]').first().locator('[data-feature-row]').first()).toBeVisible();
  }

  async searchShowsFeature(title: string): Promise<void> {
    await this.page.getByRole('searchbox').fill(title);
    await expect(this.page.locator('[data-feature-row]:visible')).toHaveCount(1);
    await expect(this.page.locator('[data-feature-row]:visible')).toContainText(title);
  }
}

class DocumentPage {
  readonly #page: Page;
  readonly #origin: string;

  constructor(page: Page, origin: string) {
    this.#page = page;
    this.#origin = origin;
  }

  async open(documentId: string): Promise<void> {
    await this.#page.goto(`${this.#origin}/catalog/documents/${documentId}.html`);
  }

  async filterByLayer(layer: string): Promise<number> {
    const root = this.#page.locator('[data-case-filter-root]');
    await root.getByLabel('テスト層').selectOption(layer);
    const rows = root.locator('[data-case-row]:visible');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(await rows.evaluateAll((items, selectedLayer) => items.every((item) => JSON.parse(item.getAttribute('data-filters') ?? '{}').layer === selectedLayer), layer)).toBe(true);
    await expect(root.locator('#case-filter-summary')).toHaveText(new RegExp(`^${count} / \\d+ケース$`, 'u'));
    return count;
  }

  async openInCaseSearch(): Promise<void> {
    await this.#page.getByRole('link', { name: 'ケース検索で開く' }).click();
  }
}

export class QualitySitePages {
  readonly page: Page;
  readonly navigation: DashboardNavigation;
  readonly daily: DailyPage;
  readonly release: DestinationPage;
  readonly catalog: CatalogSearchPage;
  readonly document: DocumentPage;
  readonly top: CatalogTopPage;

  constructor(page: Page, origin: string) {
    this.page = page;
    this.navigation = new DashboardNavigation(page);
    this.daily = new DailyPage(page, origin);
    this.release = new DestinationPage(page, `${origin}/release.html`, '前回productionからの変更');
    this.catalog = new CatalogSearchPage(page, origin);
    this.document = new DocumentPage(page, origin);
    this.top = new CatalogTopPage(page, origin);
  }

  async expectNoHorizontalOverflow(): Promise<void> {
    expect(await this.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
}
