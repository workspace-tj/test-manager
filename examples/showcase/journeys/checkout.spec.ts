import { test } from '@playwright/test';

test.describe('注文の確定', { tag: '@regression' }, () => {
  /**
   * @case
   * belongsTo: checkout
   * characteristic: functional
   * path: normal
   */
  test('カートから注文を確定し、完了画面に注文番号が出る', {
    tag: '@rank-S',
    annotation: { type: 'case-id', description: 'CASE-005' },
  }, async () => {
  });

  /**
   * @case
   * belongsTo: checkout
   * characteristic: reliability
   * path: boundary
   */
  test('確定ボタンを2回押しても注文は1件だけ作られる', {
    tag: '@rank-A',
    annotation: { type: 'case-id', description: 'CASE-006' },
  }, async () => {
  });

  /**
   * @case
   * belongsTo: checkout
   * characteristic: performance
   * path: boundary
   */
  test('100品目のカートでも3秒以内に確定できる', {
    tag: '@rank-B',
    annotation: { type: 'case-id', description: 'CASE-007' },
  }, async () => {
  });
});
