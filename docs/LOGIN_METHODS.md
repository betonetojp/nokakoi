# nokakoi ログイン方式

nokakoi が扱う 4 種類のログインと、マルチアカウント切替のデータフローです。脅威モデルは [SECURITY.md](SECURITY.md) を参照してください。

---

## 1. NIP-07（ブラウザ拡張・連携アプリ）

### 概要

nos2x、Alby、AKA Profiles（PC Chrome）、Nostash（iOS）などが注入する `window.nostr` で署名します。

### データフロー

1. 「NIP-07 ログイン」をクリック
2. `window.nostr.getPublicKey()` で公開鍵を取得
3. 送信時は `window.nostr.signEvent(draft)` を拡張側で実行

### 特徴

- 秘密鍵（nsec）は Web アプリの JavaScript に渡りません
- ページ側に XSS があっても、nsec そのものは拡張の外に出ません

---

## 2. nsec + パスキー（WebAuthn PRF）

### 概要

WebAuthn PRF で、生体認証成功時に決まる鍵を使い、nsec を AES-256-GCM で暗号化して保存します。

### データフロー

1. **登録**
   - `navigator.credentials.create()` で PRF 付きパスキーを登録
   - PRF 出力を AES-GCM 鍵として nsec を暗号化（`prf1:` プレフィックス）
   - `appSettings.passkeyEncryptedNsec` と credential ID を localStorage に保存
2. **自動ログイン**
   - `navigator.credentials.get()` で生体認証
   - PRF 鍵で `passkeyEncryptedNsec` を復号
   - 平文 nsec は `signer` モジュールのクロージャにだけ置く
3. **署名**
   - `signer.sign(draft)` がクロージャ内の鍵で `finalizeEvent` する

### 特徴

- 復号後の nsec は `window.__nostrState` には出しません
- WebAuthn は RP（オリジン）に紐づくため、偽サイトでの使い回しに強いです
- `prf1:` のない旧データは、デバイスシード由来の PBKDF2 鍵で復号を試みます（新規保存では使いません）

---

## 3. NIP-46（Nostr Connect / Amber / リモート署名）

### 概要

Amber などの署名アプリと kind:24133 で通信し、リモートで署名します。通信の暗号化は NIP-44 を優先し、未対応時は NIP-04 にフォールバックします。

### データフロー

1. `bunker://...` または Nostr Connect URL を入力するか、保存済みアカウントから復元
2. 通信用の一時鍵（Client Key）を生成し、次の localStorage キーに保存する（`appSettings` には混ぜない）
   - `nokakoi.nip46.localSecretKey`
   - `nokakoi.nip46.localSecretKey.{pubkey}`（アカウント別）
3. `client.getPublicKey()` でリモート側の**ユーザー公開鍵**を確定し、アカウントに紐づける
4. 署名時は `client.signEvent(draft)` を送り、署名済みイベントを受け取る

### 特徴

- ユーザー nsec はリモート署名器側に留まり、Web アプリにはありません
- ログアウト・アカウント削除時に通信鍵も捨てます。明示ログアウト後は再ペアが必要です

---

## 4. nsec + パスワード暗号化

### 概要

マスターパスワードから PBKDF2（SHA-256、100,000 回）で鍵を導き、AES-256-GCM で nsec を暗号化します。**空パスワードでは保存できません。**

### データフロー

1. **保存**: 非空パスワード必須 → PBKDF2 → AES-GCM → `appSettings.encryptedNsec`
2. **ログイン**: パスワード入力 → 同じパラメータで復号
3. 復号後は `signer.setKey(skHex)` でクロージャへ
4. ログアウト時は `signer.clearKey()`

### 特徴

- 空文字での自動ログインは行いません
- 旧形式（SHA-256 のみ）は復号できないため、再ログインして保存し直す必要があります

---

## 5. マルチアカウント

異なる方式のアカウントを同じブラウザで共存できます。

1. **追加**: ログイン済みのまま、パスキー / nsec / NIP-46 / NIP-07 で別アカウントを追加。その場で新規 nsec を生成することもできます
2. **切替**: ヘッダーまたは投稿窓のアバターから選択。切替中に失敗した場合は、直前の signer / NIP-46 セッションへロールバックします
3. **アカウント別設定**: アバター、表示名、kind:10002、kind:10000 などはアカウントごとに独立。既存アカウントの初回追加時は kind:10002 を自動取得して適用します
4. **削除**: 対象アカウントの暗号化鍵、リレー、ミュート、スナップショット、アプリ設定をまとめて消します

切替の実装は `js/core/account-manager.js`、認証の入口は `js/core/auth/` です。

---

## 比較

| 項目 | NIP-07 | nsec + パスキー | NIP-46 | nsec + パスワード |
|------|--------|-----------------|--------|-------------------|
| ユーザー nsec の所在 | 拡張機能内 | 暗号化して localStorage。復号後はメモリ（クロージャ） | リモート署名器 | 暗号化して localStorage。復号後はメモリ（クロージャ） |
| 通信 | in-page `window.nostr` | WebAuthn PRF | kind:24133（NIP-44 / NIP-04） | なし（ローカル復号） |
| 保存時の暗号 | なし | PRF → AES-256-GCM（`prf1:`） | 通信鍵は平文で専用キーに保存 | PBKDF2 + AES-256-GCM |
| マルチアカウント | 対応 | 対応 | 対応 | 対応 |
| 端末共有 | 拡張のアカウント次第 | 不可（デバイス＋生体） | 可（再ペアまたは保存済み通信鍵） | 可（パスワードがあれば） |
