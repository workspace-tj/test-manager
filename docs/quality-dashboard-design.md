# Test Manager の利用場面と画面設計

この文書は、Test Managerを誰が、いつ、何を判断するために使うかを定義し、その判断に必要な画面と情報の強弱を定めます。画面の見た目や取得方法より先に、利用場面と責務境界を固定します。

現行CLIはテスト定義の静的検査とカタログ生成までを実装しています。実行結果の取込、履歴、リリース差分、GitHub連携は将来機能であり、プロトタイプではfixtureとして表現します。

## 目的

Test Managerは、仕様・テストケース・実行結果を結び、利用者が次の二つを確認できるようにします。

1. 現在確認できるテストの事実は何か
2. 変更した機能について、考慮不足がないかを人がレビューするための材料が揃っているか

登録済みケースがすべて成功しても、「機能を網羅的にテスト済み」「リリース可能」とは判定しません。存在しないケースや、誤ったケース内容を実行結果から検出できないためです。単一の品質スコアも作りません。

## 利用者と責任

### 開発チーム

- 日次実行のSlack通知から、対象環境の実行詳細を開く
- Daily Scrumで新規失敗、継続失敗、未管理の失敗を確認する
- 調査担当をチームで割り振る
- 機能開発・リリース前に、変更機能とケースを見直す

### QA

- 日次失敗の一次切り分けには通常参加しない
- 開発完了後、リリース前にエンジニアと同じ変更機能・ケースを確認する
- 手動確認が必要なケースを確認する

### SM・PO

- Daily Scrumで対応の要否・割り振り・負債化をチームと決める
- Test Manager自身へリリース可否の判断を委ねない

職種ごとに別画面を作りません。QAとエンジニアは同じ証拠を異なる時点で確認します。画面は職種ではなく、判断対象ごとに分けます。

## 利用場面

### 1. 通知から日次実行を確認する

日次では、自動実行可能な設定済みテストを実行します。入口はSlack等の完了通知です。正常なら通知だけで完結してよく、詳細画面を毎日開かせることを成功条件にしません。

失敗時は、通知から一つの環境の実行詳細を開きます。devの通知はdev、stagingの通知はstagingを表示します。他環境との比較は調査時の補助操作であり、初期画面へ並べません。

日次画面は常に次の二軸を表示します。

- 前回の同条件実行から変わったこと
- domainごとの現在の結果

既知のredが多い時期でも、すべてgreenになった後でも画面構造を自動変更しません。フェーズはcoreが推測せず、絞り込みを利用者へ提供します。domainの既定順はプロジェクト設定に固定し、状態の変化で位置を動かしません。

### 2. リリース差分を確認する

前回productionリリースのcommitと、現在stagingにあるcommitの間を比較します。QAとエンジニアは同じ画面で、変更された機能に考慮不足がないかを確認します。

表示対象は次の通りです。

- 差分に含まれるPR
- PRが宣言したdomain・feature
- 追加・変更・削除されたテストケース
- 対象featureの既存ケース
- ケースの最新実行結果
- planned caseと手動確認項目
- 関連Issue

削除されたケースは、過去commitと現在commitのcatalog差分から表示します。削除理由を専用の墓標として必須保存しません。

### 3. ケースを探索する

domain、feature、状態、任意の分類からケースを検索します。unit、E2E、手動などのsourceは確認方法を示す補助情報であり、網羅性を見る主分類にはしません。

### 4. 長期傾向を振り返る

スプリントレトロ等で、継続失敗、flaky候補、復旧、負債の増減を確認します。価値はあるものの、日次確認より優先度は低く、履歴保存とともに後続設計とします。

## 日次実行から行動まで

```text
日次実行完了
  ↓
Slackへ対象環境の成功・失敗件数を通知
  ↓ 必要な場合だけ開く
同じ環境の前回差分とdomain別結果を確認
  ↓
Daily Scrumで修正・再実行・Issue化を決める
  ↓
担当と進捗はGitHub Issue等で管理
```

Test Manager coreは、未確認・調査中・修正中などの作業状態やassigneeを管理しません。

## ケースの知識モデル

### ケースは確認すべき振る舞いの最小単位

別の受け入れ条件文書を必須にしません。明確なケース名、前提、期待結果、理由をケース自身へ記録できます。関連する判断や外部の正本がある場合だけ `refs` で参照します。

unit、integration、component、E2E、手動を別々の網羅性として評価しません。すべてを同じfeatureのケース集合として扱い、sourceは各ケースの補助情報として表示します。

### domainとfeature

- domainは業務領域であり、人・チーム・assigneeを意味しない
- featureは一つのdomainへ属する
- feature同士の階層は作らない
- ケースは一つのdomainまたはfeatureへ所属する
- featureへ切れないdomain全体のケースを許容する
- 所属別集計でケースを重複計上しない
- 横断的な関連は `refs` で表す

現行の `owner` は人の責任者と誤読されるため、所属を示す名前へ変更します。保存時は、domainとfeatureを重複記録せず、一つの所属参照からdomainを導出します。

```yaml
# feature固有のケース
belongsTo: cancellation-and-refund

# domain全体のケース
belongsTo: billing
```

domainとfeatureは既存の知識文書として登録します。

```md
---
id: cancellation-and-refund
kind: feature
title: 取消・返金
parent: billing
---
```

feature文書はID、表示名、domain、正本への参照だけでも成立します。既存のNotion等と説明を二重管理しません。

### planned case

人がレビューで不足へ気づいた場合、実装前でもplanned caseとして記録できるようにします。これは失敗ではなく、「必要性を認識済みだが、まだ確認手段がない」状態です。

手動ケースはケース集合へ含め、「手動確認項目」と表示します。手動実施結果の取込は後回しにし、自動テストの成功率へ混ぜません。

## 変更とfeatureの対応

コードpathとdomain・featureの恒久対応表は持ちません。コードから本来分かる情報を二重管理し、日々のファイル移動・共通化・横断変更で腐るためです。

代わりに、変更意図を知るPR作成者が、PRへdomain・featureを宣言します。ケース側とPR側は同じ登録済み語彙を使います。PRは複数のdomain・featureを指定できます。

タグ不足はmergeを止めず、リリース差分の `未分類` へ必ず表示します。利用実績を見てから必須化を検討します。

## 任意のGitHub連携

GitHub固有機能はcoreから分離します。

- 実行結果に関連するIssue一覧
- 入力済みIssue作成画面を開く
- assign可能なユーザーからassigneeを選ぶ
- 将来のケース定義PR作成

不足ケース追加の初期フローは、画面でケース名、所属、理由等を入力し、schema検証後にGitHubのIssue作成画面を入力済みで開く方式とします。GitHub AppやtokenをTest Managerへ持たせません。

## 画面構成

### 日次実行詳細

```text
dev / 2026-09-12

前回からの変化
新規失敗 / 復旧 / 結果欠損

domainごとの現在地
domain / 全ケース / 成功 / 失敗 / 未管理

失敗ケース
ケース / feature / 前回結果 / Issue
```

### リリース差分

```text
前回production → 現在staging

変更対象
domain / feature / PR / 未分類

featureごとのケース
追加 / 変更 / 削除 / planned / 手動確認項目 / 最新結果
```

### ケース探索

```text
domain一覧
  ↓
feature一覧
  ↓
sourceを横断したケース一覧
```

## 情報の強弱

- 本文は通常ウェイトを基本にする
- 太字は判断、行動名、異常値に限定する
- 文字サイズだけで階層を作らず、余白とまとまりで読む順序を示す
- 一覧の全セルを罫線で囲まない
- 同じ大きさの指標カードを大量に並べない
- failure message、stack、traceは詳細リンク先へ置く
- coverage、実行時間、source別件数は補助情報として扱う
- 正常時にもred多数の時期にも、coreがフェーズを推測して表示を変えない

## Test Managerが判定しないこと

- 必要なテストケースがすべて存在するか
- ケース内容が意味的に正しいか
- プロダクト品質が高いか
- リリース可能か
- 失敗の担当者は誰か
- AIによる原因や修正方法

## 取得・保存する事実

### catalog

- case ID、title、所属、refs、分類、詳細、source、定義状態
- domain、featureとその関係
- ソース位置

### 実行結果

- case ID
- 一つの実行環境
- runnerとtest layer
- actual statusとexpected status
- retry、duration
- run ID、commit、startedAt、completedAt
- artifactまたはCI runへの参照

一つの結果は一つの環境に属します。異なる環境の結果を一つの結果として扱いません。環境横断表示が必要な場合も、個別結果を集約して表示します。

### リリース差分

- 比較元production commit
- 比較先staging commit
- 区間内のPRと宣言されたdomain・feature
- 二つのcatalogから導出した追加・変更・削除ケース

## 実データへの接続設計

### 現在取得できるもの

現行実装の `Catalog` は、静的解析が成功した時点の文書・ケース定義・ソース位置を持ちます。ケースについて取得済みの事実と、画面で必要な事実の対応は次の通りです。

| 画面の情報 | 現在の取得元 | 状態 |
| --- | --- | --- |
| case ID、title、source、定義状態 | `Catalog.cases` | 取得済み |
| 所属、refs、分類、理由、条件 | `fields` / `details` | 取得済み。ただし所属の保存名はまだ `owner` |
| domain・feature関係 | `Catalog.documents` の `kind` / `parent` | 取得済み。kind名はプロジェクト設定依存 |
| domainの表示順 | 未定義 | 追加契約が必要 |
| actual status、retry、duration | runner reporter | 未実装 |
| 実行環境、commit、run ID、時刻、CI URL | CI実行時のmetadata | 未実装 |
| 結果の完全性 | 実行予定unitとrunnerの完了記録 | 未実装 |
| 前回差分 | 同じ環境・同じ実行範囲の二つのrun | 未実装 |
| リリース区間のPRと宣言feature | 変更情報adapter | 未実装 |
| ケースの追加・変更・削除 | 二つのcommitから生成したcatalog | 未実装 |

`owner` から `belongsTo` への変更は実行結果取込と異なる変更理由を持つため、別のmigrationとして扱います。取込側は移行後の内部概念を「所属」として参照し、旧フィールド名を新しい実行結果形式へ持ち込みません。

### 収集単位

一回の日次実行は一つの環境だけを持ち、その中に複数の実行unitを持ちます。unitはrunner、test layer、targetの組み合わせです。

```text
Daily run: dev / commit 7f3a12c / scope daily-all
  ├─ vitest / unit / node
  ├─ vitest / integration / test-database
  ├─ playwright / component / chromium
  └─ playwright / E2E / chromium
```

`dev`、`staging`、`production`を一つのrunへ混ぜません。test layerも環境ではありません。環境を切り替えた場合は、別のrunを表示します。

### 正規化する実行事実

runner固有のJSONを画面へ直接渡しません。Vitest、Playwright等のadapterが次のrunner非依存形式へ変換します。以下は契約を説明する疑似TypeScriptであり、現時点の公開APIではありません。

```ts
type TestRun = Readonly<{
  schemaVersion: 1;
  runId: string;
  attempt: number;
  environment: string;
  commit: string;
  scopeId: string;
  startedAt: string;
  completedAt: string;
  ciUrl: string;
  units: ReadonlyArray<TestRunUnit>;
}>;

type TestRunUnit = Readonly<
  | {
      state: 'completed';
      unitId: string;
      runner: 'vitest' | 'playwright';
      layer: string;
      target: string;
      plannedCaseIds: ReadonlyArray<string>;
      observations: ReadonlyArray<CaseObservation>;
    }
  | {
      state: 'incomplete';
      unitId: string;
      runner: 'vitest' | 'playwright';
      layer: string;
      target: string;
      reason: 'cancelled' | 'timedOut' | 'runnerError' | 'artifactMissing';
      observedCaseIds: ReadonlyArray<string>;
    }
>;

type CaseObservation = Readonly<{
  caseId: string;
  expected: 'passed' | 'failed' | 'skipped';
  attempts: readonly [CaseAttempt, ...CaseAttempt[]];
}>;

type CaseAttempt = Readonly<{
  outcome: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  durationMs: number;
  startedAt: string;
  artifactRefs: ReadonlyArray<string>;
}>;
```

`CaseObservation` は少なくとも一つのattemptを必須にし、「実行結果なし」をnullableな結果で表しません。欠損は `plannedCaseIds` と観測済みcase IDの差から導出します。unit自体のartifactがない場合は、CI側があらかじめ宣言したunit一覧との照合により `artifactMissing` とします。

runnerのerror message、stack、trace、screenshotは集計用モデルへ複製せず、CI artifactまたはrunner reportへの参照だけを保存します。

### runner adapterで取得する値

Vitest adapterはcustom reporterのtest case完了hookから結果を収集し、test metadataのcase IDと静的catalogを照合します。Playwright adapterはReporter APIの `TestCase` と `TestResult` からexpected status、actual status、retry、duration、開始時刻、attachmentを読みます。

runnerの語彙はadapter内でのみ正規化します。たとえばPlaywrightの `timedOut` と、run全体が時間切れになった状態を同じ値へ潰しません。前者はattempt outcome、後者はunitの不完全理由です。

### CI metadataで取得する値

CI coordinatorはrunnerを開始する前に、次を含むrun manifestを作ります。

- run IDと再実行attempt
- commit SHA
- 対象環境
- `scopeId`
- 予定するunit一覧
- CI runへのURL
- 開始時刻

各reporterの出力をunit artifactとして集め、最後にmanifestと照合して一つの `TestRun` を生成します。GitHub Actionsのcontext全体はtoken等を含み得るため保存せず、許可した値だけを明示的に取り込みます。

### 表示モデルは保存しない

画面用の「新規失敗」「復旧」「domain別件数」は保存せず、catalogとrunから都度導出します。

```text
静的catalog ───────────────┐
                           ├─ daily view builder ── 日次画面
今回のTestRun ─────────────┤
前回の同条件TestRun ───────┘

比較元commitのcatalog ─────┐
比較先commitのcatalog ─────┼─ release view builder ─ リリース差分画面
変更宣言 ──────────────────┤
比較先の最新TestRun ───────┘
```

daily view builderが比較できるのは、同じproject、environment、`scopeId`のrunだけです。異なる実行範囲を前回値として採用しません。domain集計はcatalog上の所属から導出し、一つのケースを重複計上しません。domainの位置はrunの状態で並べ替えず、プロジェクト設定の表示順を維持します。

### リリース差分の境界

coreが知るのは、二つのcatalogと正規化済みの変更宣言です。GitHubのlabel、PR API、commit比較方法はGitHub adapter側に閉じます。

```ts
type ChangeDeclaration = Readonly<{
  changeId: string;
  url: string;
  title: string;
  memberships: ReadonlyArray<string>;
}>;
```

case差分はcase IDをidentityとして比較します。

- 比較先だけに存在する: 追加
- 両方に存在し、管理対象の定義が異なる: 変更
- 比較元だけに存在する: 削除

snippetや絶対パスなど、環境差で変わる値を意味的な変更判定へ含めません。何を「管理対象の定義」とするかは実装時に明示的な比較projectionとして固定します。

### 導入順

1. `owner` を `belongsTo` へ移行し、domain・featureの不変条件と安定した表示順をcatalogで表現する
2. 正規化形式のZod schemaと純粋なdaily view builderを実装する
3. Vitest reporter adapterを実装し、fixture runから日次画面を生成する
4. Playwright reporter adapterと複数unitのmergeを実装する
5. CI manifestとの照合と不完全runの表示を実装する
6. catalog diffとrelease view builderを実装する
7. GitHub adapterを任意連携として追加する

最初から履歴DBやGitHub Appを導入しません。日次画面は「今回と前回」の二つのartifactを入力に生成できるため、まずCI artifactだけで成立させます。長期傾向の要件が確定してから、同じ正規化runを保存する永続化方式を選びます。

## 後回しにするもの

- QAによる網羅性承認フロー
- 手動テスト実施結果の取込
- 長期履歴の保存方式とflaky閾値
- AI調査
- GitHub Appによる自動commit・PR作成
- Test Manager内のタスク状態管理

## 参照した公式仕様

- [Vitest Reporters](https://main.vitest.dev/guide/reporters)
- [Vitest Reporter API](https://main.vitest.dev/api/advanced/reporters)
- [Playwright Reporters](https://playwright.dev/docs/test-reporters)
- [Playwright TestResult](https://playwright.dev/docs/api/class-testresult)
- [Playwright TestCase](https://playwright.dev/docs/api/class-testcase)
- [Istanbul alternative reporters](https://istanbul.js.org/docs/advanced/alternative-reporters/)
- [GitHub Actions workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)
