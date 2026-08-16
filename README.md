# nokakoi web client

小型の Nostr Web クライアントです。マルチアカウント、パスキー／NIP-07／NIP-46 ログイン、チャンネル、omochat に対応しています。

## 公開URL

- **テスト環境 (GitHub Pages)**: `https://betonetojp.github.io/nokakoi/`
- **本番環境 (nokakoi.com)**: `https://nokakoi.com/app/`

> [!NOTE]
> 本リポジトリは公開テスト用です。`main` への push は GitHub Pages に自動デプロイされます。問題がなければ、非公開の本体リポジトリ (`nokakoi.com`) へ同期スクリプトで取り込まれ、本番に反映されます。

## ドキュメント

| 文書 | 内容 |
|------|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 起動フロー、ディレクトリ、対応 NIP、永続化、PWA |
| [docs/LOGIN_METHODS.md](docs/LOGIN_METHODS.md) | ログイン方式・データフロー・比較 |
| [docs/SECURITY.md](docs/SECURITY.md) | 秘密鍵の保護、脅威モデル、CSP |

## 機能

- **アカウント**
  - マルチアカウント（保持・ワンタップ切替・新規鍵生成・削除時の設定消去）
  - NIP-07（ブラウザ拡張・連携アプリ）
  - `nsec` + パスキー（WebAuthn PRF + AES-256-GCM）
  - `nsec` + パスワード（PBKDF2 + AES-256-GCM。空パスワード不可）
  - NIP-46（Amber 等のリモート署名。通信鍵はアカウント別に分離）
- **タイムライン**
  - ホーム / リレー / 自分 / 通知 / チャンネル / omochat
  - タブの表示・順序変更、スワイプ切替、無限スクロール
  - 引用カード、メディアのインライン展開、クライアント名バッジ
- **投稿**
  - kind:1、返信・引用（NIP-18 `q` タグ）・リポスト（kind:6 / 16）・リアクション（kind:7）
  - NIP-22 (kind:1111) コメント（全返信を kind:1111 にする設定は実験中）
  - eHagaki 連携投稿、外部アプリへのイベントリンク（既定: lumilumi）
  - `?text=` / `?content=` からの投稿下書き取り込み
- **チャンネル / omochat**
  - NIP-28（kind:40/41 メタデータ、kind:42 の閲覧・投稿・返信、チャンネル作成）
  - NIP-51 kind:10005 Public chats の参加同期
  - omochat（kind:20000、geohash、最寄りリレー自動導出、ホーム混在表示）
- **プロフィール / リスト**
  - kind:0 編集、kind:3 フォロー（petname 含む）
  - NIP-05 検証表示
  - NIP-65 kind:10002 リレーリスト（初回自動同期・上書き発行・Read リレーのグローバル反映）
  - ミュート（kind:10000 公開／非公開、折りたたみ表示、アカウント別同期）
  - カスタム絵文字（NIP-30 / kind:10030、フォロイー参照の取得は任意）
  - ローカルスナップショット（kind:0 / 3 / 10000 / 10002 / 10005）
- **表示**
  - ライト／ダーク／カラーテーマ、背景の明るさ、コンパクト表示、ファミコンモード
  - kind:30315 Now Playing、kind:30023 長文の Markdown 表示（DOMPurify でサニタイズ）
  - ブラウザ通知（PC 向け）、点滅通知の無効化
- **その他**
  - ディープリンク（`nevent1` / `note1` / `npub1` / `nprofile1`。`nsec` は受け付けない）
  - PWA、i18n（日本語 / 英語）

## キーボードショートカット

入力欄にフォーカスがあるときは無効です（Esc で投稿欄から抜ける場合を除く）。

| キー | 動作 |
|------|------|
| `W` / `S` | フィード内の投稿を上下移動 |
| `Shift+W` / `Shift+S` | 先頭 / 末尾へジャンプ |
| `A` / `D` | 左 / 右のタブへ切替 |
| `N` / `C` | 投稿欄にフォーカス |
| `E` | 返信 |
| `Q` | 引用 |
| `F` | リアクション |
| `B` | リポスト |
| `G` | 投稿者プロフィール |
| `V` | 参照先イベントを開く |
| `X` | 外部イベントビューアで開く |
| `R` | ソフトリロード |
| `Esc` | 投稿欄のフォーカス解除・返信/引用解除 |

## 開発環境

### 前提

- Node.js 20+

### セットアップ

```bash
npm install
```

`node_modules` は Git 管理外です。初回 clone 時に加え、`git pull` 後に `package.json` / `package-lock.json` が変わっていた場合も、もう一度 `npm install` を実行してください。

### コマンド

```bash
npm run dev            # 開発サーバー（HMR、port 8000）
npm run build          # 本番ビルド（dist/）
npm run preview        # dist のローカルプレビュー（port 8000）
npm test               # ユニットテスト（Vitest）
npm run test:watch     # テストのウォッチ実行
npm run version:check  # バージョン表記の整合性確認
npm run version:update # version.js をソースに sw.js / package.json 等を同期
npm run lint           # ESLint
npm run lint:fix       # ESLint 自動修正
```

ローカル確認URL: `http://localhost:8000/`

> [!NOTE]
> `localhost` / `127.0.0.1` では Service Worker を登録せず、既存登録も解除します。開発時のキャッシュ競合を防ぐためです。

### バージョン管理

バージョンの単一ソースは `js/config/version.js` です。値を書き換えたら `npm run version:update` を実行し、`public/sw.js` の `CACHE_VERSION`、`package.json`、`package-lock.json` を揃えてください。CI は `npm run version:check` で不一致を落とします。

### CI

`main` への push で GitHub Actions が `version:check` → `lint` → `test` → `build` の順に実行し、GitHub Pages へデプロイします。ディープリンク用に、ビルド後の `index.html` が `dist/404.html` にもコピーされます。

### 開発ルール

- `.editorconfig` に準拠（UTF-8、LF、インデント 2 スペース）
- ESLint フラット設定（`eslint.config.mjs`。テストファイルは対象外）
- 認証・暗号・アカウント切替まわりの変更時は `npm test` を実行
- テストは対象モジュールの隣に `*.test.js` として置く

## ディレクトリ構成

```text
nokakoi/
├── index.html              # メイン UI（Vite エントリー）
├── style.css               # CSS エントリー（src/styles を import）
├── vite.config.mjs         # Vite（HTML partials、404.html コピー）
├── eslint.config.mjs
├── .htaccess               # 本番 Apache 向けキャッシュ / CSP
├── scripts/                # バージョン同期スクリプト
├── partials/               # モーダル HTML（ビルド時に index.html へ埋め込み）
├── docs/                   # アーキテクチャ・ログイン・セキュリティ
├── public/                 # 静的アセット（dist 直下へコピー）
│   ├── sw.js
│   ├── manifest.json
│   ├── clients.json
│   ├── gyouza/             # セクシー餃子ツール
│   ├── i18n/
│   └── icon/
├── src/styles/             # 機能別 CSS
├── js/
│   ├── main.js             # エントリー（initApp）
│   ├── boot/               # 起動直後の軽量処理（viewport、SW、theme 等）
│   ├── config/             # 定数・バージョン
│   ├── core/               # 認証、リレー、signer、bootstrap
│   ├── features/           # タイムライン、投稿、チャンネル、プロフィール等
│   ├── ui/                 # レンダラー、モーダル、ショートカット
│   └── utils/              # i18n、sanitize、Markdown 等
└── dist/                   # ビルド成果物
```

モジュール境界の詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## 依存ライブラリ

| パッケージ | 用途 |
|------------|------|
| [nostr-tools](https://github.com/nbd-wtf/nostr-tools) | 署名・NIP-19・リレー。`js/core/nostr-compat.js` で Filter 配列購読などの互換を維持 |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | QR コード生成（名前付き import でバンドル） |
| [DOMPurify](https://github.com/cure53/DOMPurify) | Markdown HTML のサニタイズ |
| [marked](https://github.com/markedjs/marked) | kind:30023 などの Markdown パース |

## ライセンス

MIT License
