# nokakoi web client

Nostr Webクライアントの実装。

## 公開URL

- **テスト環境 (GitHub Pages)**: `https://betonetojp.github.io/nokakoi/`
- **本番環境 (nokakoi.com)**: `https://nokakoi.com/app/`

> [!NOTE]
> 本リポジトリは公開テスト用のリポジトリです。本リポジトリの最新コミットは GitHub Pages に自動でデプロイされ、動作確認ができます。テストで問題がなければ、非公開の本体リポジトリ (`nokakoi.com`) に同期スクリプトを使って取り込まれ、正式版として本番環境に反映されます。

## 機能

- NIP-07（ブラウザ拡張）認証
- `nsec` + パスワード暗号化（PBKDF2 + AES-GCM）／パスキー（WebAuthn PRF）
- NIP-46（リモート署名・ローカル通信鍵は sessionStorage 限定）
- カスタム絵文字（NIP-30）
- PWA
- i18n（日本語/英語）

詳細なログイン方式・脅威モデルは [`docs/LOGIN_METHODS.md`](docs/LOGIN_METHODS.md) / [`docs/SECURITY.md`](docs/SECURITY.md) を参照。

## 開発環境

### 前提

- Node.js 20+

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

# ビルド成果物のローカルプレビュー（port 8000）
npm run preview

# ユニットテスト
npm test

# ESLint
npm run lint
```

ローカル確認URL: `http://localhost:8000/`

> [!NOTE]
> 開発時は Service Worker がキャッシュの競合を引き起こすのを防ぐため、`localhost` 環境では自動的に登録解除（無効化）されるようになっています。

### CI

`main` への push で GitHub Actions が `lint` → `test` → `build` の順に実行し、GitHub Pages へデプロイします。

## ディレクトリ構成

```text
nokakoi/
├── index.html              # メインUI (Viteエントリーポイント)
├── package.json            # プロジェクト設定・依存関係
├── vite.config.mjs         # Vite設定ファイル
├── eslint.config.mjs       # ESLint設定ファイル
├── dist/                   # ビルド成果物 (GitHub Pages や本番へのデプロイ対象)
├── public/                 # 静的アセット (ビルド時に dist 直下にコピーされる)
│   ├── sw.js               # Service Worker
│   ├── manifest.json       # PWAマニフェスト
│   ├── clients.json        # クライアント一覧データ
│   ├── gyouza/             # セクシー餃子ツール
│   ├── i18n/               # 多言語翻訳データ
│   └── icon/               # アイコン
├── docs/                   # ログイン方式・セキュリティ仕様
├── src/                    # スタイル定義
│   └── styles/             # 機能別分割CSS (base, components, features, layout, utilities)
└── js/                     # JavaScriptモジュール
    ├── main.js             # エントリーポイント
    ├── config/             # 設定・定数・バージョン
    ├── core/               # コアロジック (auth, relay, state, bootstrap, crypto)
    ├── features/           # 機能モジュール (channel, emoji, post, profile, timeline, relay)
    ├── ui/                 # UI制御・レンダラー・モダル (modals, renderers, setup)
    └── utils/              # ユーティリティ (content, helpers, i18n, sanitize-url, notification)
```

## 開発ルール

- `.editorconfig` に準拠
- 文字コードは UTF-8（BOMなし）
- ESLint フラット設定によるチェック (`npm run lint` / `npm run lint:fix`)
- 認証・暗号まわりの変更時は `npm test` を実行

## 依存ライブラリ

- [nostr-tools](https://github.com/nbd-wtf/nostr-tools)（npm・`package-lock.json` で解決。`js/core/nostr-compat.js` で Filter 配列購読などの互換を維持）
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（npm版を名前付きインポートでバンドル）

## ライセンス

MIT License
