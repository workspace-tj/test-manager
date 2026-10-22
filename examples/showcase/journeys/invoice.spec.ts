import { test } from '@playwright/test';

test.describe('請求書', { tag: '@regression' }, () => {
  /**
   * @case
   * belongsTo: invoice-issue
   * characteristic: functional
   * path: normal
   */
  test('請求書を発行して PDF をダウンロードできる', {
    tag: '@rank-A',
    annotation: { type: 'case-id', description: 'CASE-023' },
  }, async () => {
  });

  /**
   * @case
   * belongsTo: invoice-issue
   * characteristic: performance
   * path: boundary
   */
  test('明細1,000行の請求書を発行できる', {
    tag: '@rank-B',
    annotation: { type: 'case-id', description: 'CASE-024' },
  }, async () => {
  });
});
