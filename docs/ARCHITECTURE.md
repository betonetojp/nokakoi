# nokakoi アーキテクチャ

コード配置、起動順、対応プロトコル、永続化の現状です。ログイン方式の詳細は [LOGIN_METHODS.md](LOGIN_METHODS.md)、脅威モデルは [SECURITY.md](SECURITY.md) を参照してください。

---

## 1. 起動フロー

```
index.html
  ├── js/boot/theme-color.js     # theme-color meta を先に合わせる
  ├── js/boot/viewport.js        # --vh とスクロールボタンのモーダル連動
  ├── js/boot/page-status.js     # フッターの年号・ビルド情報
  ├── js/boot/debug-policy.js    # 本番での console 抑制
  ├── js/boot/service-worker.js  # 本番のみ SW 登録（localhost では解除）
  └── js/main.js
        └── js/core/bootstrap.js # 設定読込、認証、リレー接続、UI 初期化
```

`index.html` の `<!-- @include partials/... -->` は Vite プラグインがビルド／開発時に埋め込みます。モーダル HTML は `partials/modals-main.html` / `modals-app.html` / `modals-support.html` に分割しています。

`js/main.js` は動的 import の 404（デプロイ直後の古いチャンク参照）を検知すると強制リロードします。

---

## 2. モジュール境界

| 層 | パス | 役割 |
|----|------|------|
| boot | `js/boot/` | HTML から直接読む軽量スクリプト。アプリ本体より先に動かす |
| config | `js/config/` | `VERSION`、リレー／フィード定数 |
| core | `js/core/` | 認証、signer、リレー、設定、アカウント、bootstrap |
| features | `js/features/` | タイムライン、投稿、チャンネル、プロフィール、ミュート、絵文字、ディープリンク |
| ui | `js/ui/` | レンダラー、モーダル、タブ、ショートカット、テーマ |
| utils | `js/utils/` | DOM ヘルパー、i18n、URL サニタイズ、Markdown |

一部のファイルは再エクスポート用のファサードです。新しいコードは中身のモジュールを直接 import してください。

- `js/core/auth.js` → `js/core/auth/`
- `js/core/relay.js` → `js/core/relay/`
- `js/utils/utils.js` → `js/utils/helpers/`
- `js/ui/ui-setup.js` → `js/ui/setup/`

共有の実行時参照（`state`、`settingsManager` など）は `js/core/app-context.js` に集約しています。秘密鍵はここに置かず、`js/core/signer.js` のクロージャ内に留めます。移行用に `window.__nostrState` などの deprecated ブリッジは残っていますが、新規コードでは使わないでください。

CSS は `style.css` → `src/styles/index.css` から base / layout / components / features / utilities を import します。

---

## 3. 対応プロトコル（実装している範囲）

| NIP / kind | 内容 |
|------------|------|
| NIP-01 | 基本イベント、kind:0 / 1 |
| NIP-02 | kind:3 フォロー（petname 含む） |
| NIP-04 / NIP-44 | ミュート非公開項目、NIP-46 通信、signer 経由の加復号 |
| NIP-05 | 識別子の検証表示 |
| NIP-07 | `window.nostr` による署名 |
| NIP-18 | 引用 `q` タグ、リポスト kind:6、汎用リポスト kind:16 |
| NIP-19 | npub / nsec / note / nevent / nprofile |
| NIP-22 | kind:1111 コメント |
| NIP-23 | kind:30023 長文の閲覧（Markdown） |
| NIP-25 | kind:7 リアクション |
| NIP-28 | チャンネル kind:40 / 41 / 42 |
| NIP-30 | カスタム絵文字、kind:10030 |
| NIP-38 | kind:30315 User Status（Now Playing 表示） |
| NIP-46 | リモート署名（kind:24133） |
| NIP-51 | kind:10000 ミュート、kind:10005 Public chats |
| NIP-65 | kind:10002 リレーリスト |
| kind:20000 | omochat（BitChat 系。NIP 外） |

完全準拠ではなく、クライアントとして必要な範囲の実装です。

---

## 4. 永続化

ブラウザの `localStorage` を使います。サーバ側セッションはありません。

| キー | 内容 |
|------|------|
| `appSettings` | 表示設定、暗号化 nsec、パスキー情報、preferredSigner など。アカウント切替時はアカウント別に読み書き |
| `pubkey` | 現在の公開鍵 |
| `nokakoi.nip46.localSecretKey` | NIP-46 通信用ローカル鍵（グローバル） |
| `nokakoi.nip46.localSecretKey.{pubkey}` | 同上（アカウント別） |
| `nokakoi_georelays_cache` / `_ts` | omochat 用 geo リレー一覧（24h TTL） |
| `pendingShareText` | `?text=` / `?content=` から取り込んだ投稿下書き |
| `nokakoi_device_seed` | 旧パスキー方式の互換用デバイスシード（新規保存では使わない） |

リレーリストやミュート、スナップショットもアカウント単位で保存します。アカウント削除時は対象アカウントの認証情報と関連設定をまとめて消します。

---

## 5. ディープリンクと GitHub Pages

パス末尾の bech32 を解釈します。

- 対象: `nevent1` / `note1` / `npub1` / `nprofile1`（任意の `nostr:` 接頭辞は除去）
- 除外: `nsec1`、アセットパス、`naddr`

例: `/app/nevent1...` はイベント詳細、`/npub1...` はプロフィール。解釈後、履歴から bech32 セグメントを落としてルートパスに戻します。

GitHub Pages は実在しないパスを 404 にするため、Vite ビルド後に `dist/index.html` を `dist/404.html` へコピーしています（`vite.config.mjs` の `githubPages404Plugin`）。

---

## 6. PWA と Service Worker

- マニフェスト: `public/manifest.json`（standalone）
- SW: `public/sw.js`。`CACHE_VERSION` はアプリバージョンと同期
- 登録: `js/boot/service-worker.js`。更新時は確認モーダルから `SKIP_WAITING`
- 開発: `localhost` / `127.0.0.1` では登録せず、既存 SW を unregister

バージョンを上げる手順はリポジトリ直下の [README.md](../README.md)「バージョン管理」を参照してください。

---

## 7. テスト

Vitest + jsdom です。対象ファイルの隣に `*.test.js` を置きます。認証、暗号、signer、アカウント切替、リレー購読、ディープリンク、フィードライフサイクルなどをカバーしています。ESLint はテストファイルを ignore しています。
