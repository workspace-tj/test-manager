import { it } from 'vitest';

/**
 * @case
 * belongsTo: checkout
 * rank: S
 * characteristic: functional
 * path: normal
 */
it('在庫がある商品で注文を確定すると在庫が引き当てられる', { meta: { caseId: 'CASE-001' } }, () => {
});

/**
 * @case
 * belongsTo: checkout
 * rank: S
 * characteristic: functional
 * path: boundary
 */
it('合計が0円の注文はクーポンだけで確定できる', { meta: { caseId: 'CASE-002' } }, () => {
  /**
   * @case-doc
   * conditions: [クーポンの額が合計以上]
   */
});

/**
 * @case
 * belongsTo: checkout
 * rank: A
 * characteristic: functional
 * path: error
 */
it.each([
  { item: '在庫切れの商品', ordered: 1, stock: 0 },
  { item: '在庫を超える数量', ordered: 5, stock: 3 },
])('在庫が足りない商品があると確定せず、その商品を示す', { meta: { caseId: 'CASE-003' } }, () => {
});

/**
 * @case
 * belongsTo: checkout
 * rank: S
 * characteristic: reliability
 * path: error
 */
it('支払いに失敗すると引き当てた在庫を戻す', { meta: { caseId: 'CASE-004' } }, () => {
  /**
   * @case-doc
   * reason: 在庫が戻らないと、売れるはずの商品が売り切れと表示されるため
   */
});
