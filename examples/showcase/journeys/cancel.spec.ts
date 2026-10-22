import { test } from '@playwright/test';

test.describe('注文の取消', { tag: '@regression' }, () => {
  /**
   * @case
   * belongsTo: order-cancellation
   * characteristic: functional
   * path: normal
   */
  test('購入者が注文履歴から注文を取り消せる', {
    tag: '@rank-A',
    annotation: { type: 'case-id', description: 'CASE-014' },
  }, async () => {
  });

  /**
   * @case
   * belongsTo: order-cancellation
   * refs: [order-cancellation-after-shipment]
   * characteristic: usability
   * path: error
   */
  test('出荷済みの注文では返品の手続きへ案内する', {
    tag: '@rank-A',
    annotation: { type: 'case-id', description: 'CASE-015' },
  }, async () => {
  });

  /**
   * @case
   * belongsTo: order-cancellation
   * characteristic: reliability
   * path: boundary
   */
  test('出荷処理と同時に取り消すと、どちらか一方だけが成立する', {
    tag: '@rank-S',
    annotation: { type: 'case-id', description: 'CASE-016' },
  }, async () => {
  });
});
