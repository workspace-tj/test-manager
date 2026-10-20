# GitHub Actionsで日次ダッシュボードを生成する

この例は、consumerリポジトリの確定したcommitでVitestとPlaywrightを実行し、test-managerの日次・リリース差分を一つの静的dashboard artifactとして公開します。test-managerはnpm packageとして解決せず、指定したfull commit SHAをrunner内へcloneしてbuildします。

## 導入

1. [`test-manager.yml`](test-manager.yml) をconsumerリポジトリの`.github/workflows/test-manager.yml`へコピーします。
2. GitHub Actions Variablesへ次の値を登録します。
   - `TEST_MANAGER_REF`: 使用するtest-managerの40文字commit SHA。helperを読み込むため、`examples/github-actions/`を含むcommit以降を指定します
   - `TEST_MANAGER_PRODUCTION_REF`: 比較元にするconsumerリポジトリのproduction commit SHA。このcommitにも`test-manager.yaml`が必要です
3. workflowの`TM_ID_PATTERN`、environment、scope、unit ID、targetをconsumerに合わせます。`TM_ID_PATTERN`は`test-manager.yaml`の`rules.idPattern`と同じ値にします。
4. 下記のreporter設定を既存のVitest・Playwright設定へ組み込みます。
5. workflow内の`pnpm vitest run`と`pnpm playwright test --project=chromium`を、consumerで普段使う実行コマンドへ必要に応じて置き換えます。Playwrightのproject名を変える場合は`TM_PLAYWRIGHT_TARGET`も同じ実行対象を表す値へ揃えます。

production snapshotも、指定した`TEST_MANAGER_REF`のtest-managerで`TEST_MANAGER_PRODUCTION_REF`時点の`test-manager.yaml`を読み直して生成します。そのため、test-managerを設定形式が変わる版へ上げるときは、production側の`test-manager.yaml`も新形式へ移行してから参照を更新します。たとえば`discovery.sources`へ`layer`を必須化した版では、`manualCases`を残したproduction設定はsnapshot生成で失敗します。

実行unitのlayerは、`create-manifest.mjs`がcatalogの各ケースの`layer`から決めます。`dashboard`は、unitのlayerと計画したケースのlayerが一致しない実行結果を拒否します。この例はrunnerごとに1unitへまとめるため、同じrunnerのケースが複数layerにまたがるとmanifest作成で失敗します。その場合はVitestの`projects`などでlayerごとに実行を分け、unitもlayerごとに作るよう例を拡張してください。`TM_VITEST_LAYER`はVitest reporterの必須オプションですが、unit artifactには記録されず、TestRunのlayerには使われません。紛らわしさを避けるためcatalogのlayerと同じ値にしておきます。旧版の例（`TM_PLAYWRIGHT_LAYER: E2E`など）で作ったTestRunは、layerの表記がcatalogと違うと`daily`・`dashboard`で拒否されるため、作り直してから渡します。

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
          unitId: process.env.TM_VITEST_UNIT_ID,
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
        unitId: process.env.TM_PLAYWRIGHT_UNIT_ID,
        idPattern: new RegExp(process.env.TM_ID_PATTERN, 'u'),
      })] : []),
  ],
});
```

環境変数がないローカル実行ではtest-manager reporterを追加しないため、既存の開発用テスト実行はそのまま利用できます。

attachmentは`TM_STATE_DIR/runner-artifacts`配下だけに置きます。reporterはこのroot外への参照を受け付けません。

この例はVitest 1 unitとPlaywright 1 unitを対象にしています。targetやshardを複数unitとして実行する場合は、各unitに一意なunit IDを割り当て、その全unitをmanifest作成時に確定する必要があります。

## 失敗時の扱い

runner stepは一時的に`continue-on-error`として、後続の統合とartifact公開を継続します。reporterが取得できた結果はrunner途中終了時にも保持されます。unit artifact自体が存在しない場合は`artifactMissing`となり、途中終了を示す`runnerError`とは区別されます。最後のstepでrunner失敗をjob failureへ戻します。

manifestへ保存するCI情報は、workflowが明示したrun ID、attempt、commit、environment、scope、開始時刻、HTTP(S)のCI URLだけです。GitHub context全体やtoken、secretは保存しません。
