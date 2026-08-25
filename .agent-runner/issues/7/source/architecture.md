## システムアーキテクチャ定義

### 全体像

既存の `runCreatePrJob` (`webhook/src/jobs/createPr.ts`) の「source収集 (`extractSections`/`requireSections`) → clone (`prepareGitWorkspace`) → claude cli実装 (`runClaude`, `IMPLEMENT_TOOLS`) → 安全性検証 (`assertSafeDiff`) → 単一commit (`commitAll`) → push → PR作成 (`createPullRequest`)」という既存フローに、Issue #7 のワークフロー (ラフ実装 → 最小コミット分割 → CI → コミットレビュー → ブランチdiffレビュー → 懸念をPRコメントに残す → 5W1Hコミットメッセージ) を組み込む前提で、現状の各要素との対応関係を整理する。

### 現在の実装との対応・ギャップ

- Issueをまとめる/Claudeに投げる: 既存の `extractSections`/`requireSections` (`webhook/src/sections.ts`) と `runClaude` 呼び出しがそのまま対応する。変更不要
- 要件定義・テストが通る状態をざっくり作る: `webhook/src/prompts/implement.ts` の `buildImplementPrompt` が生成するuserPromptに、既に「Superpowers の TDD 規律に従って実装してください」という指示がある。ここへ「まずラフに要件定義+テストを通す」という段階分けの指示を追加する対象になる
- 最小限のコミットに分割する: 現在の `buildImplementPrompt` は明示的に「実装が終わったら…commit は行わないでください (別プロセスが commit します)」と指示しており、実際に commit を行うのは `createPr.ts` 側の `commitAll(ws, message)` 呼び出し1回のみ (`git.ts` の `commitAll` は `git add -A && git commit -m <message>` を1回実行するだけで、複数コミットには対応していない)。したがって「最小限のコミットに分割する」を実現するには、(a) claude cli 自身に複数回commitさせるよう `buildImplementPrompt` の指示を変更する、または (b) `createPr.ts` 側で差分を複数コミットに分割するロジックを新設する、のいずれかが必要になる。現状のコードはどちらの構造も持たない
- CIを通す: 現在のジョブにはCI起動・待機のステップが無い。GitHub Actions等の外部CIをこのジョブから起動・結果を待つ仕組みは存在しない
- コミットごとにレビューする/ブランチdiff全体のレビューをする: 現在のジョブにはレビューステップが無い。`assertSafeDiff` (`webhook/src/safety.ts`) は禁止パス (`.github/workflows/` 等) への変更を機械的に検出するチェックであり、内容面のレビューではない
- 懸念をPRの指摘コメントに残す: 現在の `createPullRequest` はPR本文の組み立てのみを行い、レビュー起因の指摘コメント投稿は行っていない
- コミットメッセージの5W1H: 現在の `commitAll` 呼び出しは `feat: implement #${ref.issueNumber}\n\nCloses #${ref.issueNumber}\n\nCo-Authored-By: claude <noreply@anthropic.com>` という固定文字列であり、5W1Hの要素を含まない

### デフォルトワークフロー定義の適用方法 (Open Question)

以下いずれの方式を採るかはissue本文から断定できないため、決め打ちせずopen questionとする:

1. `webhook/src/prompts/implement.ts` の `buildImplementPrompt` が生成するsystemPrompt/userPromptに、上記ワークフローの手順を直接文章として埋め込む方式
2. リポジトリ内 (例: `webhook/src/prompts/workflows/default.md`) に独立したワークフロー定義ファイルを置き、`createPr.ts` または `buildImplementPrompt` がそれを読み込んでプロンプトに合成する方式

いずれの方式でも、「最小限のコミットに分割する」を実現するには `git.ts` の `commitAll` (単一コミット固定) を置き換えるか、claude cli 自身に複数回commitさせる方式へ変更する必要がある点は共通の変更になる。