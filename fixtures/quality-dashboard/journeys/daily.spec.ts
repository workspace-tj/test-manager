import { test } from '@playwright/test';

/* @case
 * belongsTo: order-cancellation
 * impact: 3
 */
test('競合後の再試行で注文を取り消せる', {
  annotation: { type: 'case-id', description: 'CASE-106' },
}, async () => {});

/** @case
 * belongsTo: invoicing
 * impact: 3
 */
test('大量明細の請求を確定する', {
  annotation: { type: 'case-id', description: 'CASE-107' },
}, async () => {});

/** @case
 * belongsTo: invoicing
 * impact: 2
 */
test('税率変更後の請求額を表示する', {
  annotation: { type: 'case-id', description: 'CASE-108' },
}, async () => {});

/** @case
 * belongsTo: order-cancellation
 * impact: 2
 */
test('取消履歴を表示する', {
  annotation: { type: 'case-id', description: 'CASE-109' },
}, async () => {});
