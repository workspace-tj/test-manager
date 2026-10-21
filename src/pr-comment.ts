import type { ReleaseCaseChange, ReleaseDiffView } from './release-diff.js';

export const prCommentMarker = '<!-- test-manager:pr-comment -->';

const changeLabel: Readonly<Record<ReleaseCaseChange['kind'], string>> = { added: '追加', changed: '変更', removed: '削除' };

// GitHub limits a comment body to 65536 characters; keep room for the heading and the omission note.
const maxCommentLength = 60_000;

// Catalog text is project-controlled; escape characters that would change Markdown structure, inject HTML, or notify users.
const escapeMarkdown = (value: string): string => value
  .replace(/[\\`*_[\]<>|#~&]/gu, (character) => `\\${character}`)
  .replace(/@/gu, '@\u2060')
  .replace(/\s*\r?\n\s*/gu, ' ');

// Long texts such as a changed purpose are shortened; the comment shows that and how a value changed, not the full text.
const clip = (value: string): string => {
  const characters = Array.from(value);
  return characters.length > 40 ? `${characters.slice(0, 40).join('')}…` : value;
};

const layerText = (change: ReleaseCaseChange): string => change.previousLayer === undefined ? change.layer : `${change.previousLayer} → ${change.layer}`;

export const renderPrComment = (view: ReleaseDiffView): string => {
  const changes = view.groups.flatMap((group) => group.changes);
  const count = (kind: ReleaseCaseChange['kind']): number => changes.filter((change) => change.kind === kind).length;
  const heading = [
    prCommentMarker,
    '### test-manager: ケースの変更',
    '',
    `base \`${view.productionCommit.slice(0, 12)}\` → head \`${view.stagingCommit.slice(0, 12)}\` · 追加 ${count('added')} · 変更 ${count('changed')} · 削除 ${count('removed')}`,
  ];
  if (changes.length === 0) return `${[...heading, '', 'ケースの追加・変更・削除はありません。'].join('\n')}\n`;
  const lines = [...heading];
  let length = lines.join('\n').length;
  let omitted = 0;
  for (const group of view.groups) {
    const title = group.featureTitle ? `${group.domainTitle} / ${group.featureTitle}` : group.domainTitle;
    const groupLines = ['', `#### ${escapeMarkdown(title)}`, ''];
    for (const change of group.changes) {
      const fieldLine = change.fieldChanges?.length
        ? `\n  - ${change.fieldChanges.map((item) => `${escapeMarkdown(item.label)}: ${escapeMarkdown(clip(item.before))} → ${escapeMarkdown(clip(item.after))}`).join('、')}`
        : '';
      const row = `- ${changeLabel[change.kind]} \`${change.caseId.replace(/[`\s]/gu, '')}\` ${escapeMarkdown(change.title)} · ${escapeMarkdown(layerText(change))}${fieldLine}`;
      const added = (groupLines.length === 3 ? groupLines.join('\n').length + 1 : 0) + row.length + 1;
      if (omitted > 0 || length + added > maxCommentLength) {
        omitted += 1;
        continue;
      }
      if (groupLines.length === 3) lines.push(...groupLines);
      lines.push(row);
      groupLines.push(row);
      length += added;
    }
  }
  if (omitted > 0) lines.push('', `ほか${omitted}件の変更は、コメントの長さの上限のため省略しました。`);
  return `${[...lines, '', '登録済みケースの差分です。網羅性やマージ可否は判定しません。'].join('\n')}\n`;
};
