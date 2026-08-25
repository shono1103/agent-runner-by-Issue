# PR作成ジョブ デフォルトワークフロー Design

**Date:** 2026-08-23
**Status:** Draft

## Goal
PR作成ジョブ (`runCreatePrJob`) の claude cli 実行フェーズに、「要件定義+テストのラフ作成 → 最小限のコミットに分割 → CI通過確認 → コミットごとのレビュー → ブランチdiff全体のレビュー → 懸念をPRの指摘コメントに残す → コミットメッセージへの5W1H記載」という一連の手順を、issueの内容によらず常に適用される「デフォルトワークフロー」として組み込む。

## Success Criteria
- PR作成ジョブを実行すると、ジョブのログに「ラフ実装完了」「コミット分割」「CI確認」「コミットレビュー」「ブランチdiffレビュー」の各フェーズが記録される
- 生成されたブランチのコミット履歴が単一コミットではなく複数コミットに分割されている
- 各コミットメッセージに、Who/What/When/Where/Why/Howの6要素に相当する内容が含まれている
- コミットレビューまたはブランチdiffレビューで見つかった懸念事項が、生成されたPRへの指摘コメントとして投稿されている (懸念が無い場合は0件でよい)
- 既存の `assertSafeDiff` によるセーフティチェック、`IMPLEMENT_DISALLOWED_TOOLS` (git push/git remote/gh/curl/wget禁止) が引き続き機能している
- `POST /create-pr` の外部インターフェース・レスポンス形式が変更されていない

## Global Constraints
- デフォルトワークフローは、issueの内容 (要件定義/アーキテクチャ定義/テスト定義) によらず常に同一の手順で適用されること
- claude cli への `IMPLEMENT_DISALLOWED_TOOLS` (`Bash(git push:*)`、`Bash(git remote:*)`、`Bash(gh:*)`、`Bash(curl:*)`、`Bash(wget:*)`) は変更せず維持すること
- `.github/workflows/` 配下のファイルへの変更禁止 (既存の `buildImplementPrompt` の指示) を維持すること
- コミットの分割・push・PR作成という、リポジトリへの書き込みを確定させる操作は、既存どおり `createPr.ts` 側 (claude cli 自身ではないプロセス) が行う責務のまま維持すること (claude cli の `IMPLEMENT_DISALLOWED_TOOLS` が `git push` を禁止しているため)

## Architecture
検討した案:
1. デフォルトワークフローの手順を `webhook/src/prompts/implement.ts` の `buildImplementPrompt` に直接テキストとして埋め込み、claude cli へのプロンプトの一部として渡す
2. リポジトリ内 (例: `webhook/src/prompts/workflows/default.md`) に手順を独立したワークフロー定義ファイルとして持ち、`createPr.ts` または `buildImplementPrompt` が実行時に読み込んでプロンプトに合成する
3. ワークフローの手順を webhook のコード側で明示的なステップ関数 (例: `runRoughImplementation` → `splitCommits` → `checkCi` → `reviewCommits` → `reviewBranchDiff` → `postConcerns`) として実装し、claude cli には各ステップの中でのみ narrow な指示を渡す

いずれの案を採るかはissue本文から断定できないため決め打ちせず、`## Open Questions` に残す。ただし案1・2のいずれであっても、「最小限のコミットに分割する」の実現には現状の `git.ts` の `commitAll` (単一コミット固定) を、複数回commit可能な形に置き換える必要がある点は共通の変更として確定させる。案3 (ステップ関数化) は、レビュー・懸念抽出といった判断を要する作業を機械的なステップに分解しにくく、claude cli自身に一括で委ねる現在の設計思想 (`buildImplementPrompt` がひとつのuserPromptで実装全体を依頼する) からの乖離が大きいため、優先度は低いという判断のみ残す (不採用の確定ではない)。

## Components

### git.ts (拡張)
- Responsibility: リポジトリのclone・commit・push・cleanupを提供する。現状の `commitAll(ws, message)` は `git add -A && git commit -m <message>` を1回実行するのみで、複数コミットへの分割に対応していない
- Interface: `commitAll(ws: GitWorkspace, message: string): Promise<void>` を、複数コミットに対応する形 (例: `commitEach(ws: GitWorkspace, commits: { message: string }[]): Promise<void>`) に置き換える、または既存シグネチャを維持しつつ複数回呼び出す運用に変更する (実装方式は Open Questions の解決後に確定する)
- Depends on: なし

### prompts/implement.ts (拡張)
- Responsibility: claude cli への実装プロンプト (systemPrompt/userPrompt) を構築する。現状は「commitは行わないでください」という指示のみで、ラフ実装優先・レビュー・5W1Hコミットメッセージの手順は含まれていない
- Interface: `buildImplementPrompt(ref: IssueRef, issueTitle: string): ImplementPrompt` のuserPromptに、デフォルトワークフローの手順 (Open Questionsで確定する保存場所からの参照を含む) を追加する
- Depends on: デフォルトワークフロー定義 (保存場所は Open Questions で確定)

### jobs/createPr.ts (拡張)
- Responsibility: 既存の `runCreatePrJob` に、CI通過確認・コミットレビュー・ブランチdiffレビュー・懸念のPRコメント化のフェーズを追加する。各フェーズの開始・完了を `jobStore.setPhase`/`jobStore.appendLog` でログに残す
- Interface: `runCreatePrJob(job: Job, client: GithubClient, ref: IssueRef): Promise<void>` のシグネチャは変更しない (内部の処理ステップのみ拡張)
- Depends on: `git.ts` (拡張後の複数コミット対応)、`prompts/implement.ts` (拡張後のプロンプト)、`github.ts` (PRへの指摘コメント投稿。既存に無ければ追加が必要)

### github.ts (拡張の可能性)
- Responsibility: GitHub API とのやり取り。既存の `createPullRequest` に加えて、生成済みPRへの指摘コメント投稿機能が必要になる (現状の関数一覧には無い)
- Interface: `postReviewComment(client: GithubClient, pr: PullRequestRef, body: string): Promise<void>` を新設する想定 (関数名・シグネチャは実装時に確定)
- Depends on: なし

## Data Flow
issue (要件定義/アーキテクチャ定義/テスト定義) + issueタイトル
-> `extractSections`/`requireSections` で3種の仕様を収集 (既存、変更なし)
-> `prepareGitWorkspace` でclone、ブランチ作成 (既存、変更なし)
-> `.agent-runner/` に仕様ファイルを書き出し (既存、変更なし)
-> `buildImplementPrompt` がデフォルトワークフローの手順を含むプロンプトを構築
-> `runClaude` (`IMPLEMENT_TOOLS`) が、まず要件定義+テストがざっくり通る状態のラフ実装を行う
-> `git.ts` (拡張後) が差分を意味のある単位ごとに複数コミットに分割する。各コミットメッセージに5W1Hの要素を含める
-> CI通過確認を試みる (仕組みは Open Questions / Architecture のギャップとして残る)
-> 各コミットについてレビューを行い、結果をログに記録する
-> ブランチdiff全体についてレビューを行い、結果をログに記録する
-> レビューで見つかった懸念があれば、`assertSafeDiff` 通過後、push・PR作成に続けて `github.ts` (拡張後) がPRへの指摘コメントとして投稿する
-> `jobStore.finish` でジョブを完了する

## Error Handling
- claude cli がラフ実装に失敗した場合: 既存どおりジョブを `failed` にする。コミット分割以降のフェーズには進まない
- コミット分割に失敗した場合 (差分が空、または分割ロジックがエラーになった場合): ジョブを `failed` にし、既存の `commitAll` 相当の単一コミットへのフォールバックは行わない (デフォルトワークフローの手順を満たさない結果を握りつぶさないため)
- CI通過確認の仕組みが未実装の間は、このフェーズを「試みたが結果を確認できなかった」旨のログを残すのみとし、ジョブを `failed` にはしない (Open Questionsが解決しCI連携の仕組みが確定するまでの暫定挙動)
- コミットレビュー・ブランチdiffレビューでclaude cliが実行できなかった場合: ジョブを `failed` にする (レビューを経ずにPRを作成しない)
- PRへの指摘コメント投稿に失敗した場合: PR自体は既に作成済みのため、ジョブは `succeeded` のまま、コメント投稿失敗をログに残す (PR作成自体を巻き戻さない)
- 既存の `assertSafeDiff` が禁止パスへの変更を検出した場合: 既存どおりジョブを `failed` にする (デフォルトワークフロー導入後も変更なし)

## Testing Strategy
TDDのRed-Green-Refactorに従い、各コンポーネントの観測可能な振る舞いを1テスト1振る舞いで検証する。

### git.ts (拡張後のコミット分割機能)
- 複数の変更ファイル群を渡したとき、意味のある単位ごとに複数のコミットが作られることを検証する単体テスト
- 各コミットのメッセージにWho/What/When/Where/Why/Howの6要素が含まれることを検証する単体テスト

### prompts/implement.ts (拡張後)
- `buildImplementPrompt` の返すuserPromptに、デフォルトワークフローの手順 (ラフ実装優先・コミット分割・レビュー・5W1H) への言及が含まれることを検証する単体テスト

### jobs/createPr.ts (結合テスト、GitHub API・claude cliはモック)
- 正常系: ワークフローの各フェーズ (ラフ実装/コミット分割/CI確認/コミットレビュー/ブランチdiffレビュー) が順にジョブログへ記録されることを検証する結合テスト
- 懸念あり: レビューで懸念が見つかったとき、PRへの指摘コメントが投稿されることを検証する結合テスト
- 懸念なし: レビューで懸念が見つからなかったとき、指摘コメントが投稿されない (0件のまま) ことを検証する結合テスト
- 失敗系: ラフ実装に失敗したとき、コミット分割以降のフェーズに進まずジョブが `failed` になることを検証する結合テスト
- 既存動作の非リグレッション: `assertSafeDiff` が禁止パスへの変更を検出したとき、ワークフロー導入後も引き続きジョブが `failed` になることを検証する結合テスト

### 手動確認 (E2E)
1. 要件定義/アーキテクチャ定義/テスト定義が揃ったissueに対してPR作成ジョブを実行する
2. ジョブのログに、ラフ実装 → コミット分割 → CI確認 → コミットレビュー → ブランチdiffレビューの各フェーズが記録されていることを確認する
3. 生成されたブランチのコミット履歴が複数コミットに分割されており、各コミットメッセージに5W1Hの要素が含まれていることを確認する
4. 生成されたPRに、レビューで見つかった懸念事項が指摘コメントとして残っていることを確認する (懸念が無ければ0件でよいことを確認する)
5. `IMPLEMENT_DISALLOWED_TOOLS` に該当する操作 (git push/gh等) がジョブ内で実行されていないことを確認する

## Out of Scope (YAGNI)
- 外部CIサービス (GitHub Actions等) を実際に起動・待機する仕組みの実装そのもの (本ワークフローでは「確認を試みる」フェーズの追加までとし、CI連携の実装方式は別途検討する)
- レビューで見つかった懸念に基づく自動修正の実行 (懸念はコメントとして残すのみで、自動的な差し戻し・再実装は行わない)
- コミット分割の粒度を人間が事後調整するUI
- issueの種類 (task/bug/feature) ごとに異なるワークフローを適用する仕組み (今回は「デフォルト」= 常に同一の手順を対象とする)

## Open Questions
- 「デフォルトワークフロー定義」の保存場所・適用方法 — `webhook/src/prompts/implement.ts` の `buildImplementPrompt` に直接埋め込むか、リポジトリ内に独立したworkflow定義ファイル (例: `webhook/src/prompts/workflows/default.md`) として持ち `createPr.ts` から読み込むか — はissue本文から断定できないため未確定
- CI通過確認を具体的にどのような仕組みで実現するか (GitHub Actionsの実行結果をポーリングするのか、ローカルでテストコマンドを実行することをもって代替するのか) は未確定
- レビューで見つかった懸念をPRのどの位置に投稿するか (該当コミット/該当行へのインラインコメントか、PR全体への通常コメントか) は未確定