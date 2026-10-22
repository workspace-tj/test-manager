import { it } from 'vitest';

/**
 * @case
 * belongsTo: order-cancellation
 * rank: S
 * characteristic: functional
 * path: normal
 */
it('出荷前の注文を取り消すと在庫を戻して返金する', { meta: { caseId: 'CASE-010' } }, () => {
});

/**
 * @case
 * belongsTo: order-cancellation
 * refs: [order-cancellation-after-shipment]
 * rank: A
 * characteristic: functional
 * path: error
 */
it('出荷済みの注文は取り消せない', { meta: { caseId: 'CASE-011' } }, () => {
});

/**
 * @case
 * belongsTo: order-cancellation
 * rank: B
 * characteristic: functional
 * path: boundary
 */
it('一部の商品だけを取り消す操作は受け付けない', { meta: { caseId: 'CASE-012' } }, () => {
});

/**
 * @case
 * belongsTo: order-cancellation
 * rank: A
 * characteristic: reliability
 * path: error
 */
it.fails('返金の失敗時は取消を確定せず再試行できる', { meta: { caseId: 'CASE-013' } }, () => {
});
