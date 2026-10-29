# 37,055ケースのカタログ検査を高速化する

問い: 大規模カタログの検査範囲と生成サイトを保ったまま、何を短縮できるか。
調査日: 2026-10-29〜30（Asia/Tokyo）。反映先: standaloneのsource/YAML/field parserとmanaged output。

未確認事項: CI上の短縮率、別CPU・cold filesystem cacheでの性能。

ソースごとの検証準備とYAML位置情報の再利用で、静的検査を短縮する。
永続キャッシュは導入せず、毎回すべての入力を発見・読取・検証する。

keibiの別セッション管理チェックアウトは変更せず、一時コピーで互換性を確認する。
コミット、push、PR作成は行っていない。

## 実装と正本の関係

standalone基点は`af6d93c`、consumer基点は`431baab275792317b48a4fb297c81075a7792ebc`。
consumerは`/Users/tanasejuni/atomic-software/keibi/keibi-force/worktrees/wt-6`。

両者は同じpackage名・依存バージョンの別コピーで、自動同期の仕組みは確認できなかった。
内蔵版をstandaloneで丸ごと置換してはいけない。

内蔵版だけに次の差分がある。

- `model.ts` / `rules.ts`: Node・RuleTesterのsource種別と独自testExports。
- `source-runner-adapters.ts`: Node import、独自fixture export、条件付き実行の解釈。
- `source-rule-tester-adapter.ts` / `source.ts`: RuleTester宣言の読取。
- `release-catalog.ts`: 追加source種別のsnapshot往復。
- 関連する追加runner・source・catalogのテスト。

今回の一般的な性能変更だけを一時コピーへ重ねた。
内蔵版の追加機能はstandaloneへ持ち込まない。

## 計測で分かったこと

ビルド済みNode CLIを別Nodeプロセスで直列実行する。
依存インストール・TypeScriptコンパイルは除外する。

OSファイルキャッシュは消去していない。
環境はApple M4・10論理コア・32GiB・macOS arm64。

Node v24.22.0を使用した。
checkは3回、audit・buildは各1回。製品テスト本体の実行時間ではない。

工程計測は別実行で`checkProject`の各await境界とrender/writeを計測した。
CPU profileも別実行とし、最終CLIの実時間には含めない。

CPU profileのinclusive時間は包含関係があるため加算できない。

工程別の別実行では、ソース読取・解析が18.658→8.241秒だった。
globを含むdiscoveryは0.837→0.407秒だった。

renderは1.964→3.075秒、freshな出力先へのwriteは9.571→6.476秒。
これらは単発で変動が大きく、個別処理の改善率とは扱わない。
checkからwriteまでのpeak RSSは1,933.9→1,789.8 MiBだった。

変更前は`markerYaml`約4.56秒、`parseCaseFields`約4.53秒が含まれた。

GCのself時間も約2.22秒あり、短命オブジェクトを繰り返し作る負担が見えた。

最終の数値と工程別結果は[測定JSON](2026-10-30-performance.json)に記録した。

| コマンド | 変更前 | 改善後 | 短縮率 |
|---|---:|---:|---:|
| check（3回の中央値） | 18.643秒 | 7.949秒 | 57.4% |
| audit（1回） | 22.396秒 | 11.262秒 | 49.7% |
| build（1回） | 26.266秒 | 16.995秒 | 35.3% |

変更前checkの3回は19.628/18.053/18.643秒。
改善後は7.949/8.497/7.693秒だった。
提供値はcheck中央値17.824秒、audit21.098秒、build28.212秒だった。

今回も同じ一時コピー条件で変更前を再測定した。
初回の探索計測には調査処理が重なったため、最終比較には用いない。

## 変更した処理

`parseStrictYaml`が解析したASTから行番号を返す`lineAt`を持つ。
sourceコメントと文書frontmatterは、各フィールドのためにYAMLを再解析しない。

行番号の親へのフォールバック、オフセット、CRLFの扱いは維持する。

`createCaseFieldParser`は、sourceファイルの処理中だけスキーマと文書mapを再利用する。
`requiredWhen`のsource/layerは固定し、入力値・診断のファイル・行・列はケースごとに渡す。

既存の`parseCaseFields`は同じ検証を呼ぶ入口として残す。
コメントの許可キーは既存の`unknownKeys`で検査する。

型・必須・参照先・分類の検証は共通field parserが引き続き行う。

sourceの行分割とIDスキーマもファイルごとに一度だけ準備する。
managed outputでは、今回の一時出力内で作成済みのディレクトリを再度mkdirしない。

パス検証、所有マーカー、temporary生成と置換の順序は保つ。

再利用は各読取呼出し・出力呼出しの中で終わる。
更新・削除・設定変更・文書変更をまたいだキャッシュは存在しない。

### 責務と依存の検査

変更対象は同じ`src`内の既存モジュールで、新しい層やディレクトリは作らない。
sourceとmanualはfield parserを消費する。
field parserはmodel/ids/diagnosticsへ依存する。

YAML行位置の定義はyamlに一つだけ置く。
source/documentsがその定義を消費する。

sourceのrunner選択や分類規則を別の層へ移していない。
既存のsrc全体は機能単位と補助モジュールが同居するが、今回は構成全体を再編しない。

## サイトのファイル数とサイズ

変更前は37,511ファイル、277,686,744 bytes（約264.8 MiB）。
`catalog.json`は64,496,981 bytes、検索データ`cases/index-data.js`は約29 MiB。

JSONをcompactにするだけでは6,599,928 bytes（全体の約2.4%）の削減に留まる。

ケースごとのHTMLをまとめるには、既存URL、直接リンク、JavaScriptなしの詳細表示を変える必要がある。
検索データを分割する場合も、全件検索・絞り込みと読み込みの契約を設計する必要がある。

今回はこれらを維持し、出力内容を変えずに生成までの所要時間を短縮する。
ファイル数・サイズの削減は実装していない。

## consumerへ反映する手順

1. `yaml.ts`、`documents.ts`、`case-fields.ts`、`managed-output.ts`の性能差分を取り込む。
2. `source.ts`のmarker読取、lineAt、行分割、IDとfield parserの再利用を統合する。
3. 内蔵版のRuleTester分岐にも同じparserとsourceLinesを使う。追加runnerのimport・分岐・status判定は保つ。
4. 追加runner、独自fixture、条件付き実行、snapshot往復のテストを実行する。
5. 全量check・独立audit・buildを再測定し、カタログと全生成ファイルを比較する。

`model.ts`、`rules.ts`、runner adapter、`release-catalog.ts`をstandaloneで上書きしない。
今回の一時コピーではこれらのconsumer独自実装を維持した。

### CIで二重にcheckする処理

consumerの`audit-discovery.mjs`は最初に`checkProject`を呼び、その後に独立宣言走査を行う。
したがって同じ入力にcheck CLI→auditを連続実行すると、カタログ処理が二度走る。

coreに永続化したチェック結果を受け渡す必要はない。

consumer側で一つのstepから`node scripts/test-manager/audit-discovery.mjs --json`を実行すれば、
カタログ診断と独立した登録漏れ監査を両方実行できる。

成功時だけ独立走査へ進む順序は従来のCIと同じである。
通常checkを別stepとして重ねない構成への変更はconsumer側で行う。

独立走査は削除せず、coreのdiscovery結果で代用しない。
consumerのスクリプト・workflowは今回変更していない。

## 再測定する方法

baselineはconsumerの`tools/test-manager`を一時ディレクトリへコピーしてコンパイルする。
candidateはそのコピーへ上記の共有差分だけを統合する。

依存は同じstandaloneのnode_modulesを使い、ビルド時間は計測外にする。

CLIの同条件計測は次のスクリプトを両方のdistに対して実行できる。
引数はCLIファイル、設定ファイル、生成先（project外）の順。

```sh
node --input-type=module - /absolute/tool/dist/cli-entry.js /absolute/project/test-manager.yaml /tmp/tm-repro-site <<'JS'
import { spawnSync } from 'node:child_process';
const [cli, config, out] = process.argv.slice(2);
for (const command of ['check', 'check', 'check', 'build']) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [cli, command, '--config', config,
    ...(command === 'build' ? ['--out', out] : [])], { encoding: 'utf8' });
  console.log(JSON.stringify({ command, seconds: (performance.now() - start) / 1000,
    exitCode: result.status, stdout: result.stdout, stderr: result.stderr }));
  if (result.status !== 0) process.exit(1);
}
JS
```

auditはconsumerのスクリプトを一時コピーする。
core importだけを各検証コピーのdist/catalog.jsへ向ける。

`discovery-audit.mjs`は元のconsumerの実装をimportし、`--root`で元チェックアウトを読む。
この調整は計測対象のcoreを選ぶためだけで、監査のアルゴリズムは変更しない。

## 回帰検証と限界

- standalone: `pnpm build`と`pnpm exec vitest run`で35ファイル・237件成功。
- standalone: `pnpm test:e2e`でdesktop/mobile計12件成功。
- consumer overlay: 正しい作業ディレクトリで全単体33ファイル・242件成功。
- 正常・異常fixtureで、変更前後のcatalog/diagnosticsをdeep equalityで比較して一致。
- 大規模サイト全37,511ファイルのパスとSHA-256が一致。
- 生成物は両者とも277,686,744 bytesで一致。
- 独立レビューで指摘なし。最終差分に`git diff --check`成功。

E2Eの初回はmacOS sandboxのMachPort制限でChromiumが起動しなかった。
sandbox外で同じローカルテストを再実行し、12件すべて成功した。

consumerの入力は446文書・37,055ケース。
独立auditは3,673ファイル・36,561宣言・理由付き除外5件で前後一致した。
TODO・文書参照・分類・snippetを含む生成物の全内容を維持した。

CI実行、cold filesystem cache、別マシンは未検証。
単発のaudit/build/工程時間とpeak RSSには変動がある。
mkdirの重複削減単独による短縮率は確定していない。

性能変更の検証コピー以外にconsumerのファイルを変更していない。
終了時に内蔵版srcと開始時コピーの差分がないことを確認した。
