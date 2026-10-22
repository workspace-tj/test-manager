import { it } from 'vitest';

/**
 * @case
 * belongsTo: invoice-issue
 * rank: S
 * characteristic: functional
 * path: normal
 */
it('締め日までの注文を1枚の請求書にまとめる', { meta: { caseId: 'CASE-019' } }, () => {
});

/**
 * @case
 * belongsTo: invoice-issue
 * rank: A
 * characteristic: functional
 * path: boundary
 */
it('締め日当日の23:59の注文はその月に入る', { meta: { caseId: 'CASE-020' } }, () => {
});

/**
 * @case
 * belongsTo: invoice-issue
 * rank: A
 * characteristic: functional
 * path: error
 */
it('発行済みの請求書は変更できない', { meta: { caseId: 'CASE-021' } }, () => {
});

/**
 * @case
 * belongsTo: invoice-issue
 * rank: B
 * characteristic: functional
 * path: boundary
 */
it.skip('注文が0件の月は請求書を作らない', { meta: { caseId: 'CASE-022' } }, () => {
});
