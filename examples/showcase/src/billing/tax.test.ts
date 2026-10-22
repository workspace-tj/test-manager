import { it } from 'vitest';

/**
 * @case
 * belongsTo: tax-rounding
 * refs: [invoice-issue]
 * rank: S
 * characteristic: functional
 * path: normal
 */
it.each([
  { rate: '10%', subtotal: 1999, tax: 199 },
  { rate: '8%', subtotal: 1999, tax: 159 },
])('税率ごとに税額を計算し1円未満を切り捨てる', { meta: { caseId: 'CASE-026' } }, () => {
});

/**
 * @case
 * belongsTo: tax-rounding
 * rank: S
 * characteristic: functional
 * path: boundary
 */
it('8%と10%の商品が混ざった請求書の税額', { meta: { caseId: 'CASE-027' } }, () => {
});

/**
 * @case
 * belongsTo: tax-rounding
 * rank: A
 * characteristic: functional
 * path: boundary
 */
it.todo('値引きは税率ごとに按分してから税額を計算する', { meta: { caseId: 'CASE-028' } }, () => {
});
