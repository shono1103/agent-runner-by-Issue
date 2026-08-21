# LikeC4 (.c4) 出力仕様

LikeC4 は C4 モデル (Context/Container/Component) をコードとして書くための DSL。
システムアーキテクチャ定義を LikeC4 形式に変換するためのルールを示す。

## 全体構造 (単一ファイルで完結させる)

```
specification { ... }   -- 使う element/relationship の種別を宣言
model { ... }            -- 実際の要素とその関係
views { ... }            -- 見せ方 (最低1つの view index が必須)
```

## サンプル

```likec4
specification {
  element actor
  element system
  element component
  element database {
    style {
      shape storage
    }
  }
}

model {
  customer = actor 'Customer' {
    description 'サービスの利用者'
  }

  app = system 'アプリケーション' {
    ui = component 'フロントエンド' {
      description 'ブラウザで動くUI'
    }
    backend = component 'バックエンド' {
      description 'ビジネスロジックを持つAPI'
    }
    db = database 'データベース'

    ui -> backend 'HTTPSでAPIを呼ぶ'
    backend -> db 'クエリを実行'
  }

  customer -> ui 'ブラウザで操作する'
}

views {
  view index {
    title '全体像'
    include *
  }

  view of app {
    title 'アプリケーション内部'
    include *
  }
}
```

## 厳守すべき制約

1. `model` で使う要素の種別は、必ず先に `specification { element <kind> }` として宣言する
   (未宣言の kind を使うとバリデーションエラーになる)。
2. 識別子に**ドットを使わない** (`payment-api` は OK、`payment.api` は NG)。数字始まりも禁止。
   ファイルをまたぐ参照が必要な場合のみ FQN (`app.backend`) を使う。
3. `*` は**直接の子のみ**を指す (再帰ではない)。再帰的な子孫が要るときは `**` を使う。
4. 親子間の直接の関係は書けない (`app -> app.ui` のような記述は不可)。
   関係は同じ階層の要素間、または祖先→非直接の子孫で書く。
5. タグ (`#tag`) はネストブロックの**先頭**に書く (他プロパティの後に置くとエラー)。
6. `views` ブロックには**必ず `view index` を定義する** (未定義だと自動生成され、
   エクスポート時のファイル名/URLになるため明示しておく)。
7. 文字列は `'` か `"`。複数行の説明は `'''...'''` のトリプルクォートも使える。
8. ユースケースのやり取り (シーケンス) を表したい場合は `dynamic view` を使う:
   `dynamic view flow { a -> b 'リクエスト'; b -> a '応答' }`。
9. コードフェンスは ```` ```likec4 ```` を使う。
