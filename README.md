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

### ローカル起動

```bash
# 通常キャッシュあり
npm start

# 開発向け（キャッシュ無効）
npm run dev
```

ローカル確認URL: `http://localhost:8000/`

> [!WARNING]
> 本アプリはES Modulesを使用するため、`file://` での直接起動はできません。必ず上記のようにローカルHTTPサーバー経由で検証してください。

## ディレクトリ構成

```text
nokakoi/
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

## 開発ルール

- `.editorconfig` に準拠
- 文字コードは UTF-8（BOMなし）

## 依存ライブラリ

- [nostr-tools](https://github.com/nbd-wtf/nostr-tools)（CDN）
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（CDN）

## ライセンス

MIT License
