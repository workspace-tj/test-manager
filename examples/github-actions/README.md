# GitHub Actionsで日次ダッシュボードを生成する

この例は、consumerリポジトリの確定したcommitでVitestとPlaywrightを実行し、test-managerの日次・リリース差分を一つの静的dashboard artifactとして公開します。test-managerはnpm packageとして解決せず、指定したfull commit SHAをrunner内へcloneしてbuildします。

## 導入

1. [`test-manager.yml`](test-manager.yml) をconsumerリポジトリの`.github/workflows/test-manager.yml`へコピーします。
2. GitHub Actions Variablesへ次の値を登録します。
   - `TEST_MANAGER_REF`: 使用するtest-managerの40文字commit SHA。helperを読み込むため、`examples/github-actions/`を含むcommit以降を指定します
   - `TEST_MANAGER_PRODUCTION_REF`: 比較元にするconsumerリポジトリのproduction commit SHA。このcommitにも`test-manager.yaml`が必要です
3. workflowの`TM_ID_PATTERN`、environment、scope、targetをconsumerに合わせます。`TM_PLAYWRIGHT_LAYER`は、`discovery.sources`でPlaywrightを書いたlayerと同じ値にします。`TM_ID_PATTERN`は`test-manager.yaml`の`rules.idPattern`と同じ値にします。
4. 下記のreporter設定を既存のVitest・Playwright設定へ組み込みます。
5. workflow内のVitestの2つの実行コマンドと`pnpm playwright test --project=chromium`を、consumerで普段使う実行コマンドへ必要に応じて置き換えます。Playwrightのproject名を変える場合は`TM_PLAYWRIGHT_TARGET`も同じ実行対象を表す値へ揃えます。

## layerごとの実行

この例は、Vitestでunitとintegrationの2つのlayerを書くリポジトリを想定しています。`test-manager.yaml`の`discovery.sources`は次のように分けておきます。

```yaml
discovery:
  sources:
    unit:
      vitest: ['src/**/!(*.integration).test.ts']
    integration:
      vitest: ['src/**/*.integration.test.ts']
    e2e:
      playwright: ['e2e/**/*.e2e.ts']
```

- `create-manifest.mjs`は、catalogのケースをrunnerとlayerの組ごとに1つのunitへまとめます。unit IDは`<runner>-<layer>-<target>`（例: `vitest-integration-node`）です
- reporterも同じ規則でunit IDを決めるため、workflowの各実行stepでは`TM_VITEST_LAYER`だけを変えます。unit IDを別に書く必要はありません
- 実行の分け方は`discovery.sources`のpathsと揃えます。この例では`--exclude '**/*.integration.test.ts'`でunitを、`.integration.test.ts`を含むファイルだけでintegrationを実行します
- catalogにあるlayerの実行stepを忘れると、そのunitは`artifactMissing`になります。catalogにないlayerを実行すると、manifestにないunitとして統合で失敗します。integrationのケースがないリポジトリでは、integrationのstepを消してください。残すと、Vitestがテストファイルを見つけられずに失敗し、jobも失敗します
- layerとtargetはunit IDの一部になるため、英数字と`.`、`_`、`-`だけで書きます
- Playwrightは1回だけ実行するため、Playwrightのケースは1つのlayerにまとめます。複数のlayerに分ける場合は、Vitestと同じようにlayerごとの実行stepを足します
- `dashboard`は、unitのlayerと計画したケースのlayerが一致しない実行結果を拒否します

どちらの参照もbranchやtagではなくfull SHAに固定します。production checkoutはconsumerのworkspace外へ作成するため、current catalogのglobやテスト探索へproduction側のファイルは混入しません。

## Reporter設定

helperはworkflowがcloneしたtest-managerから動的に読み込みます。consumerリポジトリからtest-manager packageへの依存は追加しません。設定例はtop-level awaitを使うため、ESMとして読み込まれる設定ファイル（`"type": "module"`または`.mjs`/`.mts`）を前提とします。

Vitest設定例:

```js
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig } from 'vitest/config';

const toolDirectory = process.env.TM_TOOL_DIR;
const stateDirectory = process.env.TM_STATE_DIR;
const testManagerVitestReporter = toolDirectory && stateDirectory
  ? (await import(pathToFileURL(
      path.join(toolDirectory, 'examples/github-actions/reporters.mjs'),
    ).href)).testManagerVitestReporter
  : undefined;

export default defineConfig({
  test: {
    reporters: [
      'default',
      ...(testManagerVitestReporter ? [testManagerVitestReporter({
          toolDirectory,
          stateDirectory,
          layer: process.env.TM_VITEST_LAYER,
          target: process.env.TM_VITEST_TARGET,
          idPattern: new RegExp(process.env.TM_ID_PATTERN, 'u'),
        })] : []),
    ],
  },
});
```

Playwright設定例:

```js
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig } from '@playwright/test';

const toolDirectory = process.env.TM_TOOL_DIR;
const stateDirectory = process.env.TM_STATE_DIR;
const testManagerPlaywrightReporter = toolDirectory && stateDirectory
  ? (await import(pathToFileURL(
      path.join(toolDirectory, 'examples/github-actions/reporters.mjs'),
    ).href)).testManagerPlaywrightReporter
  : undefined;

export default defineConfig({
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  ...(stateDirectory
    ? { outputDir: path.join(stateDirectory, 'runner-artifacts', 'playwright') }
    : {}),
  reporter: [
    ['list'],
    ...(testManagerPlaywrightReporter ? [testManagerPlaywrightReporter({
        toolDirectory,
        stateDirectory,
        layer: process.env.TM_PLAYWRIGHT_LAYER,
        target: process.env.TM_PLAYWRIGHT_TARGET,
        idPattern: new RegExp(process.env.TM_ID_PATTERN, 'u'),
      })] : []),
  ],
});
```

環境変数がないローカル実行ではtest-manager reporterを追加しないため、既存の開発用テスト実行はそのまま利用できます。

attachmentは`TM_STATE_DIR/runner-artifacts`配下だけに置きます。reporterはこのroot外への参照を受け付けません。

この例のunitは、runnerとlayerの組ごとに1つです。同じlayerをtargetやshardで複数unitに分けて実行する場合は、各unitに一意なunit IDを割り当て、その全unitをmanifest作成時に確定するよう例を拡張してください。

## 失敗時の扱い

runner stepは一時的に`continue-on-error`として、後続の統合とartifact公開を継続します。reporterが取得できた結果はrunner途中終了時にも保持されます。unit artifact自体が存在しない場合は`artifactMissing`となり、途中終了を示す`runnerError`とは区別されます。最後のstepでrunner失敗をjob failureへ戻します。

manifestへ保存するCI情報は、workflowが明示したrun ID、attempt、commit、environment、scope、開始時刻、HTTP(S)のCI URLだけです。GitHub context全体やtoken、secretは保存しません。

## PRへケースの変更をコメントする

[`test-manager-pr-comment.yml`](test-manager-pr-comment.yml) は、PRのbaseとheadでcatalog snapshotを作り、追加・変更・削除されたケースをdomain・featureごとにPRへコメントします。

- コメント本文は `test-manager pr-comment --base-snapshot <path> --head-snapshot <path> [--out <path>]` が作るMarkdownです。投稿は `gh pr comment` が行うため、test-manager本体はGitHub APIを使いません。ほかのホスティングでも同じ本文を投稿できます
- 本文の先頭に `<!-- test-manager:pr-comment -->` を入れています。同じPRへの再実行では、この目印で始まる `github-actions[bot]` のコメントを探して更新し、なければ新しく投稿します
- forkからのPRでは書き込み権限のないtokenになるため、jobをスキップします。`pull_request_target` はPRのコードを書き込み権限付きで動かすことになるため使いません
- base側にまだ `test-manager.yaml` がない導入直後のPRでは、コメントせずに終了します
- 1件のコメントは最大約6万文字に収め、超える分は件数だけを示して省略します

