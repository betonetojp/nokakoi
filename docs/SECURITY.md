# 🛡️ nokakoi セキュリティアーキテクチャ仕様書

nokakoiにおける秘密鍵（nsec）のセキュリティモデル、ライフサイクル管理、およびクロージャ保護の仕組みについての仕様書です。

---

## 1. 秘密鍵のライフサイクル管理

```
[ 入力 / パスキー認証 ]
         │
         ▼
[ 復号化処理 (AES-GCM) ]
         │
         ▼
[ signer モジュール (クロージャ保護) ] ── (外部から直接参照不可)
         │
         ├── 署名実行: signer.sign(draft)
         ├── NIP-04/44暗号復号: signer.nip44Decrypt(...)
         │
         ▼ (ログアウト時)
[ signer.clearKey() (メモリ消去) ]
```

---

## 2. クロージャによる秘密鍵保護の仕組み

### 概要
従来のWebアプリケーションでは、`window.state.sk = "hex..."` のようにグローバルオブジェクト上に秘密鍵を露出させる設計が多く見られました。しかし、悪意あるブラウザ拡張機能やXSS（クロスサイトスクリプティング）によって、1行のJSコードで秘密鍵が外部サーバーに送信されるリスクがありました。

nokakoiでは、秘密鍵を `signer.js` 内の関数クロージャ（即時実行関数 IIFE）内の変数 `_sk` として隠蔽しています。

```javascript
// js/core/signer.js の概念構造
export const signer = (() => {
  let _sk = null; // スコープ外部からはアクセス不能

  return {
    setKey(skHex) { _sk = skHex; },
    clearKey() { _sk = null; },
    hasKey() { return _sk !== null; },
    sign(draft) { return finalizeEvent(draft, _sk); },
    // ...
  };
})();
```

### なぜ安全なのか
1. `window.__nostrState` や DOM、グローバルスコープをインスペクトしても `_sk` 変数は列挙されません。
2. `Object.keys(signer)` や `JSON.stringify(signer)` を実行しても、`_sk` 変数のプロパティは存在しないため流出しません。
3. ログ出力（`window.__nokakoiLastAction`）内では秘密鍵の代わりに `'[closure]'` という固定文字が記録され、コンソールからの漏洩を防ぎます。

---

## 3. 脅威モデルと対策マトリクス

| 脅威シナリオ | 保護状況 | 採用している対策 |
|-------------|----------|------------------|
| LocalStorageの第三者閲覧（nsec） | ✅ 保護済み | WebAuthn PRF または PBKDF2+AES-GCM による強力な暗号化。空パスワードでの保存は不可 |
| LocalStorageの第三者閲覧（NIP-46） | ✅ 保護済み | ローカル通信鍵は **localStorage に永続化しない**（後述） |
| 端末の物理的強奪 | ✅ 保護済み | Touch ID / Face ID / Windows Hello 生体認証が必須（パスキー方式） |
| XSSによる `window.sk` の直接窃取 | ✅ 保護済み | **クロージャ保護**によりグローバル空間から隔離 |
| コンソールログからの鍵漏洩 | ✅ 保護済み | デバッグログおよび `lastAction` から鍵情報をマスク・除外 |
| 偽サイトでのパスキー利用 | ✅ 保護済み | WebAuthn のオリジン検証 (RP ID = nokakoi.com) |

---

## 4. NIP-46 ローカル通信鍵の保護

NIP-46（リモート署名）でクライアント側が保持するローカル通信鍵（`nip46LocalSecretKey`）は、ユーザーの Nostr 秘密鍵そのものではありませんが、リモートサイナーとのセッションなりすましに使えるため保護が必要です。

**採用している対策（セッション限定保持）:**
1. 鍵は `sessionStorage` にのみ保存し、`localStorage` / `appSettings` には書き込まない
2. 設定保存時および起動時に、過去バージョンで残った平文鍵を `appSettings` から除去する
3. ログアウト時に `sessionStorage` 上の鍵も消去する
4. ブラウザ／タブを閉じた後は再ペア（再接続）が必要

これによりディスク上の長期永続化やバックアップ経由の漏洩面を縮小します。同一タブセッション内の再読み込みでは自動再接続が可能です。

---

## 5. 今後の改善候補（Future Security Enhancements）

1. **コンテンツセキュリティポリシー (CSP) のさらなる厳格化**:
   現状は `index.html` の meta CSP と `.htaccess` で基本ポリシーを適用済み。`'unsafe-inline'` や CDN 依存の削減、SRI 付与を進める。
