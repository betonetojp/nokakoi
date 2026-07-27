# 🔑 nokakoi ログイン方式・技術仕様書

nokakoiでサポートされている4種類のログイン方式の技術仕様、データフロー、およびセキュリティ比較です。

---

## 1. NIP-07 (ブラウザ拡張機能・連携アプリ)

### 技術概要
ブラウザ拡張機能・連携アプリ（nos2x, Alby, AKA Profiles (PC Chrome), Nostash (iOS) 等）が注入・提供する `window.nostr` オブジェクトを使用して署名を行います。

### データフロー
1. ユーザーが「NIP-07ログイン」をクリック
2. `window.nostr.getPublicKey()` を呼び出して公開鍵を取得
3. イベント送信時: `window.nostr.signEvent(draft)` により拡張機能内で署名処理を実施

### セキュリティ特徴
- 秘密鍵（nsec）はWebアプリのJavaScript環境に**一切引き渡されません**。
- Webアプリ側のXSS脆弱性が存在しても、秘密鍵そのものが流出することはありません。

---

## 2. nsec + パスキー（WebAuthn PRF拡張）

### 技術概要
WebAuthn PRF (Pseudo-Random Function) 拡張を利用して、デバイスの生体認証（Touch ID / Windows Hello / Face ID）成功時に決定論的な暗号鍵を導出し、秘密鍵（nsec）をAES-256-GCM暗号化・保存します。

### データフロー
1. **登録時**:
   - `navigator.credentials.create()` でPRF拡張を指定してパスキー登録
   - 生体認証により取得したPRFキーで `nsec` を AES-GCM 暗号化（`prf1:...` プレフィックス付き）
   - 暗号化データを `localStorage` の `appSettings.passkeyEncryptedNsec` に保存
2. **自動ログイン時**:
   - `navigator.credentials.get()` でパスキー生体認証
   - 取得したPRFキーで `passkeyEncryptedNsec` を復号
   - 復号された `nsec` は **`signer` モジュールのクロージャ内部**に保持
3. **署名時**:
   - `signer.sign(draft)` を呼び出し、クロージャ内部の秘密鍵で `finalizeEvent` を実行

### セキュリティ特徴
- **クロージャ保護**: 復号後の `nsec` は `window.__nostrState` 等のグローバル空間には露出せず、関数の閉じたスコープ内に保護されます。
- **物理・フィッシング保護**: 生体認証なしでは復号不可。WebAuthnはドメイン紐づけのため偽サイト（フィッシング）に強いです。

---

## 3. NIP-46 (Nostr Connect / リモート署名)

### 技術概要
外部の署名アプリ（AndroidのAmberや遠隔NIP-46リレー）と暗号化Nostrメッセージ（kind:24133）経由で通信し、リモートで署名を実施します。

### データフロー
1. ユーザーがNIP-46接続URLを入力、または既存接続を復元
2. ローカルで通信用の一時鍵ペアを生成し、専用キー `nokakoi.nip46.localSecretKey`（localStorage）に保持（`appSettings` には混ぜない）
3. イベント署名時: `client.signEvent(draft)` を送信し、リモート署名器からの署名済みレスポンスを受信

### セキュリティ特徴
- メインの秘密鍵（nsec）はリモート署名器内に留まり、Webアプリ側には存在しません。
- ローカル通信鍵は自動再接続用に永続化され、ログアウト時に消去されます。

---

## 4. nsec + パスワード暗号化

### 技術概要
ユーザーが入力したマスターパスワードから PBKDF2（100,000イテレーション）で鍵導出し、AES-GCMで `nsec` を暗号化して保存します。**空パスワードでの保存は不可**です（旧来の単一 SHA-256 フォールバック復号も廃止済み）。

### データフロー
1. **保存時**: 非空のマスターパスワード必須 → PBKDF2鍵導出 → AES-GCM暗号化 → `localStorage`（`appSettings.encryptedNsec`）へ保存
2. **ログイン時**: マスターパスワード入力 → PBKDF2鍵導出 → AES-GCM復号
3. 復号後: `signer.setKey(skHex)` によりクロージャに保持
4. セッション終了（ログアウト）時: `signer.clearKey()` でメモリ消去

### セキュリティ特徴
- 復号にはユーザーが設定したパスワードが必要（空文字での自動ログインは行わない）
- 旧形式（SHA-256 のみ）で保存されたデータは復号できず、再ログイン・再保存が必要

---

## 📊 ログイン方式の技術比較表

| 項目 | NIP-07 | nsec + パスキー | NIP-46 | nsec + パスワード |
|------|--------|----------------|--------|-------------------|
| 秘密鍵の所在 | ブラウザ拡張 | デバイスTPM + メモリ(クロージャ) | リモート署名器 | LocalStorage(暗号) + メモリ(クロージャ) |
| 通信プロトコル | in-page window.nostr | WebAuthn PRF + Local Web | NIP-46 (kind:24133) | Local Web |
| 暗号アルゴリズム | N/A | PBKDF2 / AES-256-GCM | NIP-04 / NIP-44 | PBKDF2 / AES-256-GCM |
| 端末共有 | 不可 | 不可（デバイス固有） | 可 | 可 |
