# nokakoi セキュリティ

秘密鍵の置き場所、ライフサイクル、脅威モデルです。方式ごとの手順は [LOGIN_METHODS.md](LOGIN_METHODS.md) を参照してください。

---

## 1. 秘密鍵のライフサイクル

```
[ 入力 / パスキー認証 / アカウント切替 ]
         │
         ▼
[ 復号 (AES-GCM) ]          ※ NIP-07 / NIP-46 ではこの段は無い
         │
         ▼
[ signer モジュール（クロージャ） ] ── 外部から _sk は列挙できない
         │
         ├── 署名: signer.sign(draft)
         ├── NIP-04/44: signer.nip04* / signer.nip44*
         └── 切替ロールバック用: signer.getKey()  ※ account-manager のみ
         │
         ▼ 切替失敗のロールバック以外 / ログアウト
[ signer.clearKey() ]
```

NIP-07 と NIP-46 ではユーザー nsec はページに入りません。パスキー／パスワード方式だけが、セッション中にクロージャへ平文 hex を置きます。

---

## 2. クロージャ保護

従来よくある `window.state.sk = "hex..."` は、XSS や悪意ある拡張から 1 行で鍵を送れます。nokakoi は `_sk` を `js/core/signer.js` の IIFE 内に閉じます。

```javascript
// js/core/signer.js の概念構造
export const signer = (() => {
  let _sk = null;

  return {
    setKey(skHex) { _sk = skHex; },
    clearKey() { _sk = null; },
    hasKey() { return _sk !== null; },
    getKey() { return _sk; }, // アカウント切替のロールバック専用
    sign(draft) { return finalizeEvent(draft, skBytes(_sk)); }
  };
})();
```

できること:

1. `window.__nostrState` や DOM を見ても `_sk` は出ません。`app-context.js` も秘密鍵を持ちません
2. `Object.keys(signer)` や `JSON.stringify(signer)` では `_sk` は見えません
3. デバッグ用 `lastAction` では鍵の代わりに `'[closure]'` を出します

できないことの境界:

- `signer.getKey()` は切替失敗時のロールバック（`js/core/account-manager.js`）のために公開しています。`signer` オブジェクトへの参照を取れる XSS は、ここから平文 hex を読めます
- `signer` 自体は `window` に載せていません。通常のコンソール列挙では届きませんが、「クロージャがあるから XSS 耐性は十分」ではありません
- XSS は `getKey` が無くても、UI 経由で署名や投稿を起こせる場合があります

NIP-07 / NIP-46 はユーザー nsec がページに無いため、このクラスの XSS でも nsec は取れません。

---

## 3. マルチアカウント

1. **隔離**: 各アカウントの nsec は AES-256-GCM（パスキーは WebAuthn PRF、パスワードは PBKDF2）で暗号化して保存します。切替時は先に `signer.clearKey()` してから次を復号します。失敗時だけ `getKey()` で直前の鍵に戻します
2. **削除 / 全ログアウト**: 対象（または全部）の暗号化 nsec、パスキー情報、NIP-46 通信鍵を消します

---

## 4. 脅威モデル

| 脅威 | 状況 | 対策 |
|------|------|------|
| localStorage からの nsec 平文読み取り | 保護 | パスキーは PRF+AES-GCM。パスワードは PBKDF2+AES-GCM。空パスワード不可 |
| localStorage からの NIP-46 通信鍵読み取り | 残存リスク | 専用キーに分離。ユーザー nsec ではないが、セッションなりすましには使える |
| 端末の物理奪取（パスキー方式） | 保護 | 生体認証が無いと復号できない |
| `window.sk` のようなグローバルからの窃取 | 保護 | クロージャ。`signer` は window に出さない |
| `signer.getKey()` を呼ぶ XSS | 残存リスク | モジュール参照が取れた場合。NIP-07/46 なら nsec は無い |
| コンソールログからの鍵漏洩 | 保護 | 鍵をマスク |
| 偽サイトでのパスキー利用 | 保護 | WebAuthn のオリジン検証 |
| 切替時のメモリ残存 | 保護 | 切替時 `clearKey()` |
| Markdown / HTML 注入 | 保護 | kind:30023 は marked + DOMPurify。URL は `sanitize-url` |
| ディープリンクでの nsec 持ち込み | 保護 | パス末尾の `nsec1` は無視 |

---

## 5. NIP-46 ローカル通信鍵

通信鍵はユーザー nsec ではありませんが、リモートサイナーとのセッションになりすませるため保護対象です。

1. `appSettings` に混ぜず、`nokakoi.nip46.localSecretKey` および `nokakoi.nip46.localSecretKey.{pubkey}` にだけ置く
2. 接続時に `client.getPublicKey()` で通信鍵とユーザー公開鍵を分離する
3. 起動・保存時に、旧版で `appSettings` に残った平文鍵を除去する
4. ログアウト / アカウント削除時に通信鍵も消す
5. ユーザー nsec は Web 側に置かない

リロード後の自動再接続のため、通信鍵は永続化しています。端末アクセスや XSS で読まれる余地は残るので、将来は WebAuthn PRF などでの暗号化を検討します。

---

## 6. CSP と周辺ヘッダ

一次の CSP は `index.html` の meta です。`script-src` は `'self'` と Cloudflare Insights、`style-src` は `'unsafe-inline'` と Google Fonts、`connect-src` はリレー用に `wss:` / `https:` を許可しています。

本番 Apache 向けに `.htaccess` でも CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` を付けています。meta と `.htaccess` のディレクティブは完全一致ではないため、変更時は両方を確認してください。

---

## 7. 今後の候補

1. CSP の厳格化（`'unsafe-inline'` 削減、SRI、CDN 依存の整理）と meta / `.htaccess` の一致
2. NIP-46 通信鍵の WebAuthn PRF 等による暗号化
3. `signer.getKey()` の利用箇所を減らし、ロールバックもクロージャ内で完結させる
4. `window.__nostrState` など deprecated ブリッジの縮小
