# nokakoi web client

`/app` 配下で動作するNostr Webクライアントの実装。

## 公開URL

- App: `https://nokakoi.com/app/`
- Gyouza Tool: `https://nokakoi.com/app/gyouza/`

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

### セットアップ（リポジトリルートで実行）

```bash
npm install
```

### ローカル起動（リポジトリルートで実行）

```bash
# 通常キャッシュ
npm start

# 開発向け（キャッシュ無効）
npm run dev
```

確認URL: `http://localhost:8000/app/`

> 本アプリはES Modulesを使用するため、`file://` での直接起動は不可。HTTPサーバー経由で検証すること。

## ディレクトリ構成

```text
app/
├── index.html              # メインUI
├── style.css               # スタイル
├── sw.js                   # Service Worker
├── manifest.json           # PWAマニフェスト
├── clients.json            # クライアント一覧データ
├── test-hidden-emoji.html  # 開発用検証ページ
├── gyouza/
│   └── index.html          # セクシー餃子ツール
├── icon/                   # アイコン
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

## テスト / 検査（リポジトリルートで実行）

```bash
npm test
npm run test:preview-length
npm run test:reaction
npm run scan:i18n
```

## バージョン管理

バージョンソースは `app/js/version.js`。

```bash
npm run version:update
npm run version:check
```

詳細は `../docs/VERSION_MANAGEMENT.md` を参照。

## 開発ルール

- `.editorconfig` に準拠
- 文字コードは UTF-8（BOMなし）

## 依存ライブラリ

- [nostr-tools](https://github.com/nbd-wtf/nostr-tools)（CDN）
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（CDN）

## ライセンス

MIT License
