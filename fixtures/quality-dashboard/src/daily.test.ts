import { it } from 'vitest';

/* @case
 * belongsTo: order-cancellation
 * impact: 2
 */
it('取消可能な注文を取り消せる', {
  meta: { caseId: 'CASE-101' },
}, () => {});

/** @case
 * belongsTo: order-cancellation
 * impact: 3
 */
it('出荷済み注文は取り消せない', {
  meta: { caseId: 'CASE-102' },
}, () => {});

/** @case
 * belongsTo: order-cancellation
 * impact: 2
 */
it.fails('既知制約のある一括取消', {
  meta: { caseId: 'CASE-103' },
}, () => {});

/** @case
 * belongsTo: invoicing
 * impact: 3
 */
it.fails('未対応通貨の請求確定', {
  meta: { caseId: 'CASE-104' },
}, () => {});

/** @case
 * belongsTo: invoicing
 * impact: 1
 */
it.skip('締め日変更中の請求確定', {
  meta: { caseId: 'CASE-105' },
}, () => {});

/* @case
 * belongsTo: invoicing
 * impact: 2
 */
it.todo('複数税率の端数を確認する', {
  meta: { caseId: 'CASE-111' },
}, () => {});
