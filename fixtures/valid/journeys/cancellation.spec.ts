import { test } from '@playwright/test';

/*
@case
owner: order-cancellation
refs: [cancellation-eligibility]
role: product
impact: 3
*/
test('出荷済み表示では取消ボタンを操作できない', {
  annotation: { type: 'case-id', description: 'CASE-201' },
}, async () => {});
