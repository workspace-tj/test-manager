import { escapeHtml } from './html.js';

// The subset of Markdown that specs and decisions are written in: headings, paragraphs, lists, quotes, tables,
// fenced code, and inline code, emphasis and links. Raw HTML is always escaped, never passed through.

// Links keep only web URLs and relative paths, so a `javascript:` or `data:` URL never becomes clickable.
const safeHref = (href: string): string | undefined => /^https?:\/\//iu.test(href) || (!href.startsWith('//') && !/^[^/?#]*:/u.test(href)) ? href : undefined;

export const renderInlineMarkdown = (source: string): string => {
  const parts: string[] = [];
  let rest = source;
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/u;
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    parts.push(escapeHtml(rest.slice(0, match.index)));
    const [whole, code, strong, label, href] = match;
    if (code !== undefined) parts.push(`<code>${escapeHtml(code)}</code>`);
    else if (strong !== undefined) parts.push(`<strong>${renderInlineMarkdown(strong)}</strong>`);
    else if (label !== undefined && href !== undefined) {
      const target = safeHref(href);
      parts.push(target === undefined ? escapeHtml(whole) : `<a href="${escapeHtml(target)}">${renderInlineMarkdown(label)}</a>`);
    }
    rest = rest.slice(match.index + whole.length);
  }
  parts.push(escapeHtml(rest));
  return parts.join('');
};

const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/u;
const tableRow = /^\s*\|.*\|\s*$/u;
const cells = (line: string): string[] => line.trim().replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim());

const renderList = (lines: readonly string[]): string => {
  // Items indented deeper than the first one belong to the item above them.
  const baseIndent = listItem.exec(lines[0] ?? '')?.[1]?.length ?? 0;
  const ordered = /\d/u.test(listItem.exec(lines[0] ?? '')?.[2] ?? '');
  const items: { text: string; children: string[] }[] = [];
  for (const line of lines) {
    const match = listItem.exec(line);
    if (match && (match[1]?.length ?? 0) <= baseIndent) items.push({ text: match[3] ?? '', children: [] });
    else if (match) items.at(-1)?.children.push(line);
    else { const last = items.at(-1); if (last) last.text += ` ${line.trim()}`; }
  }
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((item) => `<li>${renderInlineMarkdown(item.text)}${item.children.length > 0 ? renderList(item.children) : ''}</li>`).join('')}</${tag}>`;
};

const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u;
const startsTable = (lines: readonly string[], index: number): boolean => tableRow.test(lines[index] ?? '') && /^\s*\|?\s*:?-{3,}/u.test(lines[index + 1] ?? '');
const startsBlock = (lines: readonly string[], index: number): boolean => {
  const line = lines[index] ?? '';
  return /^\s*(`{3,}|~{3,})/u.test(line) || heading.test(line) || listItem.test(line) || /^\s*>/u.test(line) || startsTable(lines, index);
};

export const renderMarkdown = (source: string, options: Readonly<{ omitHeading?: string }> = {}): string => {
  const lines = source.replace(/\r\n?/gu, '\n').trim().split('\n');
  const html: string[] = [];
  let index = 0;
  let omitted = false;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const fence = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      const closing = new RegExp(`^\\s*${fence[1]?.[0] === '~' ? '~' : '`'}{${fence[1]?.length ?? 3},}\\s*$`, 'u');
      while (index < lines.length && !closing.test(lines[index] ?? '')) body.push(lines[index++] ?? '');
      index += 1;
      html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const headingMatch = heading.exec(line);
    if (headingMatch) {
      index += 1;
      const text = headingMatch[2] ?? '';
      // The page already shows the document title as its own heading.
      if (!omitted && html.length === 0 && options.omitHeading !== undefined && text === options.omitHeading) { omitted = true; continue; }
      const level = headingMatch[1]?.length ?? 1;
      html.push(`<h${level}>${renderInlineMarkdown(text)}</h${level}>`);
      continue;
    }
    if (line.trim() === '') { index += 1; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/u.test(line)) { index += 1; html.push('<hr>'); continue; }
    const block = (predicate: (value: string) => boolean): string[] => {
      const result: string[] = [];
      while (index < lines.length && predicate(lines[index] ?? '')) result.push(lines[index++] ?? '');
      return result;
    };
    if (listItem.test(line)) {
      html.push(renderList(block((value) => value.trim() !== '' && (listItem.test(value) || /^\s+\S/u.test(value)))));
      continue;
    }
    if (/^\s*>/u.test(line)) {
      html.push(`<blockquote>${renderMarkdown(block((value) => /^\s*>/u.test(value)).map((value) => value.replace(/^\s*>\s?/u, '')).join('\n'))}</blockquote>`);
      continue;
    }
    if (startsTable(lines, index)) {
      const [head, , ...rows] = block((value) => tableRow.test(value));
      html.push(`<div class="table-scroll"><table><thead><tr>${cells(head ?? '').map((cell) => `<th scope="col">${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${cells(row).map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    // A paragraph always takes its first line, then runs until a blank line or the start of another block.
    const paragraph = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !startsBlock(lines, index)) paragraph.push(lines[index++] ?? '');
    html.push(`<p>${paragraph.map((value) => renderInlineMarkdown(value.trim())).join('<br>')}</p>`);
  }
  return html.join('');
};
