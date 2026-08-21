# Allium (.allium) 出力仕様

Allium は「振る舞い」を形式的に記述する LLM-native な仕様言語である。
ここでは要件定義・テスト定義を Allium 形式に変換するためのルールを示す。

## 必須の先頭行

ファイルは必ず次の行から始める。

```
-- allium: 3
```

コメントは `--`。

## セクション順序

出現する場合、次の順序を守る (無い節は省略してよい)。

```
Enumerations -> Entities and Variants -> Config -> Defaults -> Rules
  -> Invariants -> Actor Declarations -> Surfaces -> Open Questions
```

## 命名規約

* 型・ルール・不変条件・contract・surface・actor名: **PascalCase**
* フィールド名・config パラメータ・enum リテラル・関係名: **snake_case**
* エンティティのコレクションは自然な英語複数形 (`Users`, `Orders`)

## 主要構文

```allium
-- allium: 3

enum Status { pending | active | closed }

entity Order {
    customer: Customer
    status: pending | shipped | delivered
    tracking_number: String when status = shipped | delivered  -- 状態依存フィールド

    transitions status {
        pending -> shipped
        shipped -> delivered
        terminal: delivered            -- 終端状態は明示必須
    }

    items: OrderItem with order = this  -- with は関係宣言。this 必須
    active_items: items where status = active  -- where はフィルタ。this 禁止
    is_complete: status = delivered     -- derived (計算値、読み取り専用)
}

external entity Customer {              -- 外部管理エンティティ
    email: String
}

config {
    max_retries: Integer = 3
    cancellation_window: Duration = 48.hours
}

rule ShipOrder {
    when: ShipOrder(order, tracking)    -- トリガー (外部刺激)
    requires: order.status = pending    -- 事前条件
    ensures:
        order.status = shipped          -- 状態変更
        order.tracking_number = tracking
}

rule NotifyOnShipment {
    when: order: Order.status transitions_to shipped  -- 状態遷移トリガー
    ensures: Email.created(to: order.customer.email, template: order_shipped)  -- エンティティ作成
}

invariant NonNegativeTotal {
    for order in Orders where status != cancelled:
        order.total >= 0
}

open question "返品時のポリシーは未確定"
```

## 厳守すべき制約

1. エンティティ作成は **`.created(...)` のみ**。`Email.sent(...)` のような動詞は禁止
   (意味は entity 名と rule 名に載せる)。
2. 時間トリガー (`when: x: Entity.field <= now` の形) には**必ず再発火防止の `requires`** を付ける。
3. `with` は関係宣言専用で `this` を参照しなければならない。`where` はフィルタ専用で
   `this` を参照してはいけない。
4. コレクションの dot-method は組込8種のみ: `.count .any() .all() .first .last .unique .add() .remove()`。
   それ以外は自由関数形式のブラックボックス関数にする (例: `hash(password)`)。
5. ラムダは常に明示する (`i => i.field`。`field` だけの省略形は不可)。
6. `transitions` を宣言したら、非終端状態は必ず出口を持ち、終端状態は `terminal:` で明示する。
7. `?` (オプショナル) は本質的にオプショナルなフィールド専用。ライフサイクル依存の
   存在有無は `when` 句を使う。
8. 未決事項は勝手に決めず `open question "..."` に落とす。実装の詳細
   (DB スキーマ、API 設計、UI レイアウト) は書かない。観測可能な振る舞いだけを書く。
9. インライン enum 同士は比較できない。比較が必要なら名前付き `enum` を切り出す。
10. コードフェンスは ```` ```allium ```` を使う。
