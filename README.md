# nokakoi web client

Nostr Webクライアントの実装。

## 公開URL

- **テスト環境 (GitHub Pages)**: `https://betonetojp.github.io/nokakoi/`
- **本番環境 (nokakoi.com)**: `https://nokakoi.com/app/`

> [!NOTE]
> 本リポジトリは公開テスト用のリポジトリです。本リポジトリの最新コミットは GitHub Pages に自動でデプロイされ、動作確認ができます。テストで問題がなければ、非公開の本体リポジトリ (`nokakoi.com`) に同期スクリプトを使って取り込まれ、正式版として本番環境に反映されます。

## 機能

- NIP-07（ブラウザ拡張）認証
- `nsec` 認証
- NIP-46（リモート署名）
- Passkey（WebAuthn）
- カスタム絵文字（NIP-30）
- PWA
- i18n（日本語/英語）

## 開発環境

### 前提

- Node.js

### セットアップ

```bash
npm install
```

### 開発サーバーの起動

```bash
# 開発サーバー起動（HMR対応）
npm run dev

# 本番用ビルド（dist/ に成果物が出力されます）
npm run build

# ビルド成果物のローカルプレビュー
npm run preview
```

ローカル確認URL: `http://localhost:8000/`

> [!NOTE]
> 開発時は Service Worker がキャッシュの競合を引き起こすのを防ぐため、`localhost` 環境では自動的に登録解除（無効化）されるようになっています。

## ディレクトリ構成

```text
nokakoi/
├── index.html              # メインUI (Viteエントリーポイント)
├── style.css               # スタイル
├── package.json            # プロジェクト設定・依存関係
├── vite.config.mjs         # Vite設定ファイル
├── eslint.config.mjs       # ESLint設定ファイル
├── dist/                   # ビルド成果物 (GitHub Pages や本番へのデプロイ対象)
├── public/                 # 静的アセット (ビルド時に dist 直下にコピーされる)
│   ├── sw.js               # Service Worker
│   ├── manifest.json       # PWAマニフェスト
│   ├── clients.json        # クライアント一覧データ
│   ├── gyouza/             # セクシー餃子ツール
│   └── icon/               # アイコン
└── js/                     # JavaScriptモジュール
    ├── main.js             # エントリーポイント
    ├── auth.js             # 認証
    ├── webauthn.js         # Passkey
    ├── relay.js            # リレー接続
    ├── renderer.js         # 描画
    ├── composer.js         # 投稿UI
    ├── settings.js         # 設定
    ├── i18n.js             # 多言語
    └── ...
```

## 開発ルール

- `.editorconfig` に準拠
- 文字コードは UTF-8（BOMなし）
- ESLint フラット設定によるチェック (`npm run lint` / `npm run lint:fix`)

## 依存ライブラリ

- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) (npm版 v2.9.4 をバンドル)
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (npm版 を名前付きインポートでバンドル)

## ライセンス

MIT License
