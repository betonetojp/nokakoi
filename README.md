# nokakoi web client

Nostr Webクライアントの実装。

## 公開URL

- **テスト環境 (GitHub Pages)**: `https://betonetojp.github.io/nokakoi/`
- **本番環境 (nokakoi.com)**: `https://nokakoi.com/app/`

> [!NOTE]
> 本リポジトリは公開テスト用のリポジトリです。本リポジトリの最新コミットは GitHub Pages に自動でデプロイされ、動作確認ができます。テストで問題がなければ、非公開の本体リポジトリ (`nokakoi.com`) に同期スクリプトを使って取り込まれ、正式版として本番環境に反映されます。

## 機能

- マルチアカウント管理（複数アカウントの保持・ワンタップ切り替え・新規アカウント生成・アカウント削除時の設定消去）
- 多彩なログイン方式
  - NIP-07（ブラウザ拡張機能・連携アプリ）認証
  - `nsec` + パスキー（WebAuthn PRF生体認証）
  - `nsec` + パスワード暗号化（PBKDF2 + AES-256-GCM）
  - NIP-46（Amber連携・リモート署名／通信鍵自動分離）
- タイムライン（ホーム / リレー / 自分 / 通知 / チャンネル / omochat。タブの表示・順序変更）
- 投稿（kind:1、返信・引用・リポスト・リアクション、共通 composer）
- NIP-22 (kind:1111) コメント（送信・受信。全返信を kind:1111 で送る設定は実験中）
- NIP-28 チャンネル（kind:40/41 メタデータ、kind:42 の閲覧・投稿・返信、kind:10005 Public chats 参加同期）
- omochat（kind:20000、geohash、専用タブ、最寄りリレー自動導出、ホーム混在表示）
- eHagaki 連携投稿
- NIP-65 (kind:10002) リレーリスト管理（初回自動同期・上書き発行・Readリレーのグローバル反映）
- プロフィール (kind:0)・フォロー (kind:3) の編集
- ローカルスナップショット（kind:0 / 3 / 10000 / 10002 / 10005 のバックアップ・復元）
- ミュート（kind:10000 非公開／公開、kind:0 等への適用、折りたたみ表示、アカウント別同期）
- カスタム絵文字（NIP-30 / kind:10030）
- 表示カスタマイズ（ライト／ダーク／カラーテーマ、メディアのインライン展開、引用イベントのカード表示）
- キーボードショートカット（WASD によるフィード移動・タブ切替）
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

`node_modules` は Git 管理外です。初回 clone 時に加え、`git pull` 後に `package.json` / `package-lock.json` が変わっていた場合も、もう一度 `npm install` を実行してください。古い依存のままだと実行時エラーの原因になります。

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

# バージョン表記の整合性確認
npm run version:check

# ESLint
npm run lint
```

ローカル確認URL: `http://localhost:8000/`

> [!NOTE]
> 開発時は Service Worker がキャッシュの競合を引き起こすのを防ぐため、`localhost` 環境では自動的に登録解除（無効化）されるようになっています。

### CI

`main` への push で GitHub Actions が `version:check` → `lint` → `test` → `build` の順に実行し、GitHub Pages へデプロイします。

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
