import { expect, it, test } from 'vitest';

throw new Error('静的抽出時に実行されてはいけない');

/*
@case
owner: order-cancellation
refs: [cancellation-eligibility]
role: product
impact: 3
*/
it('出荷済みの注文は、取消期限内でも取り消せない', {
  meta: { caseId: 'CASE-001' },
}, () => {
  /*
  @case-doc
  conditions: [注文は出荷済み, 現在時刻は取消期限より前]
  reason: 出荷後は返品手続きとして扱うため
  */
  expect(false).toBe(false);
});

/*
@case
owner: order-cancellation
role: engineering
impact: 2
*/
test.each([[0, false], [1, true]])('取消可能件数 %i を判定する', {
  meta: { caseId: 'CASE-002' },
}, () => {});

/*
@case
owner: order-cancellation
role: product
impact: 1
*/
it.todo('取消理由の候補を表示する', {
  meta: { caseId: 'CASE-003' },
}, () => {});
