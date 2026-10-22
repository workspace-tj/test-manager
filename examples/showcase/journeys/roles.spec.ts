import { test } from '@playwright/test';

test.describe('操作権限', { tag: '@regression' }, () => {
  /**
   * @case
   * belongsTo: member-roles
   * refs: [order-cancellation]
   * characteristic: security
   * path: error
   */
  test('閲覧のみの担当者が取消の API を直接呼ぶと拒否される', {
    tag: '@rank-S',
    annotation: { type: 'case-id', description: 'CASE-031' },
  }, async () => {
  });

  /**
   * @case
   * belongsTo: member-roles
   * refs: [invoice-issue]
   * characteristic: usability
   * path: normal
   */
  test('スタッフの画面には請求書の発行ボタンが出ない', {
    tag: '@rank-A',
    annotation: { type: 'case-id', description: 'CASE-032' },
  }, async () => {
  });
});
