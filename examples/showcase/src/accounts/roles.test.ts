import { it } from 'vitest';

/**
 * @case
 * belongsTo: member-roles
 * refs: [order-cancellation, invoice-issue]
 * rank: S
 * characteristic: security
 * path: normal
 */
it('店長は注文の取消と請求書の発行ができる', { meta: { caseId: 'CASE-029' } }, () => {
});

/**
 * @case
 * belongsTo: member-roles
 * refs: [invoice-issue]
 * rank: S
 * characteristic: security
 * path: error
 */
it('スタッフは請求書を発行できない', { meta: { caseId: 'CASE-030' } }, () => {
});
