/*
@case
belongsTo: order-cancellation
role: product
impact: 2
*/
export const Disabled = {
  /*
  @case-doc
  conditions: [注文は出荷済み]
  */
  name: '[CASE-301] 出荷済み注文では取消ボタンを無効表示する',
  tags: ['skip-test'],
};
