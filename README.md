# test-manager

プロジェクト定義の知識文書、手動ケース、Vitest、Playwright、Storybook を実行せずに静的解析し、参照整合性を検査して閲覧用サイトを生成する独立 CLI です。

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js check --config fixtures/valid/test-manager.yaml
node dist/cli.js build --config fixtures/valid/test-manager.yaml --out /tmp/test-manager-site
```

設定パスは設定ファイルのディレクトリ基準です。`check` は診断があれば終了コード 1、CLI の使い方が不正なら 2 を返します。`build` は検証成功後だけ出力し、既存ディレクトリは test-manager の marker がある場合だけ置換します。生成物に日時や絶対パスを含めません。

## v1 の記述規約

- 文書: Markdown 先頭の厳密な YAML frontmatter に `id`, `kind`, `title`, 任意の単一 `parent` と関連文書 `refs`。`refs` の相互参照は親循環とは別です。本文の raw HTML は実行せず文字として表示します。
- 手動: 1 YAML ファイルに 1 ケース。`id`, `title`, `steps: [{ action, expected }]` とプロジェクト定義フィールドを記述します。結果欄はありません。
- Vitest: `it` / `test`（`skip`, `todo`, inline literal `each` を含む）の直前に `@case`、宣言 options の `meta.caseId` に ID、callback 冒頭の任意 `@case-doc` に条件・理由を書きます。
- Playwright: 直前 `@case` と、宣言 options の `annotation: { type: 'case-id', description: 'CASE-ID' }` を使います。`skip` / `fixme` は定義状態として表示し、成功とは扱いません。
- Storybook: export の直前に `@case`、明示 `name: '[CASE-ID] 表示名'` を使います。補足は object の最初の property 直前の `@case-doc` に置きます。Story の状態から別ケースや成功結果は生成しません。

`@case` は owner・refs・分類、`@case-doc` は必要な conditions・reason の記録場所です。通常コメントは抽出しません。親・パス・describe から値を継承しません。一宣言一ケース ID で、literal `each` の行は入力違いとして保持しつつ一ケースです。

ケースフィールド規則は `placement: classification | detail`、`required`、`requiredWhen: { field, equals }`、型、列挙値、参照先 kind、最小件数、一意性だけを扱います。フィールド名を生成器へハードコードせず、`@case` と `@case-doc` の配置および絞り込み項目を規則から導出します。任意コードや緩和スイッチはありません。

## 静的解析の対応境界

対象は各ランナーから直接 import した標準宣言、静的文字列タイトル、オブジェクトリテラル options、inline 配列リテラルの `each`、object literal の Story です。動的タイトル・動的 each・独自 wrapper・外部データ生成は診断対象または対象外として明示され、任意 JavaScript を実行して発見しません。意味的な十分さ、コードと記述の一致、未記録の仕様は人がレビューします。

## AI 記述と人レビュー

AI は設定済み語彙だけを使い、owner を一つ明記し、関連がある場合だけ refs を追加します。impact は壊れた場合の影響であり実装優先度ではありません。人はケース名が確認内容を表すか、conditions / reason が必要十分か、Arrange / Assert と一致するかをレビューします。ツールはこれらの意味を推測しません。

導入時は探索 glob が既存の Vitest / Playwright / Story を漏らさず、かつ一つのファイルが複数規則に重複しないことを先に確認してください。独自 wrapper、変数参照の each、Story factory は v1 では書き換えまたは対象外の明示が必要です。
