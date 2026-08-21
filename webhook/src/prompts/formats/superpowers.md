# Superpowers (Markdown) 出力仕様

Superpowers (obra/superpowers) は独自 DSL を持たず、成果物は素の Markdown。
ただし文書構造と品質基準が厳密に決まっている。要件定義・テスト定義を
「設計ドキュメント (spec)」として、この構造で出力する。

## 出力構造

```markdown
# <Topic> Design

**Date:** <YYYY-MM-DD>
**Status:** Draft

## Goal
<何を作るか、なぜ作るかを1文で>

## Success Criteria
- <測定可能な達成条件。曖昧語禁止>

## Global Constraints
- <バージョン下限、依存制限、命名/文言ルール、プラットフォーム要件。1行1件、正確な値>

## Architecture
<採用アプローチと、検討した2-3案に対するトレードオフ・選定理由>

## Components
### <Component A>
- Responsibility: <一つの明確な責務>
- Interface: <正確なシグネチャ>
- Depends on: <依存関係>

## Data Flow
<入力 -> 変換 -> 出力の経路>

## Error Handling
<失敗モードごとに、検知方法と挙動を明示。「適切にエラー処理する」は禁止>

## Testing Strategy
<TDD 前提で、各コンポーネントの観測可能な振る舞いをどう検証するか>

## Out of Scope (YAGNI)
- <意図的に作らないもの>

## Open Questions
- <未解決。空であることが望ましい>
```

## 厳守すべき制約 (Superpowers が明示的に "plan failures" と定義するもの)

1. **一切出力してはいけない語句**: "TBD" / "TODO" / "後で決める" / "実装は省略" /
   「適切にエラー処理する」/「エッジケースを扱う」。すべて具体的な内容に置き換える。
2. **曖昧さゼロ**: 2通りに解釈できる要件があれば、片方を選んで明示する
   (どちらを選んだか・なぜかも書く)。
3. **スコープ判定**: 1つの実装計画に収まる範囲か判定する。複数の独立したサブシステムを
   含むなら「分割すべき」と `## Open Questions` に明記する。
4. **YAGNI**: 依頼されていない機能を足さない。
5. **内部無矛盾性**: セクション間で矛盾がないか自己レビューする
   (例: Architecture と Components の記述が食い違っていないか)。
6. テスト定義を書く場合は TDD の Red-Green-Refactor の順序を前提にし、
   各テストが「1つの振る舞い」だけを検証するようにする (`and` で複数の検証を
   1テストに詰め込まない)。

コードフェンスは ```` ```markdown ```` を使う。
