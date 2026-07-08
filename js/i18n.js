// シンプルな i18n ヘルパー

let DICTS = null;
let loadPromise = null;

// 多言語データを非同期でロードする関数
export function initI18n() {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      // 相対パスで JSON 辞書をフェッチ
      const [jaRes, enRes] = await Promise.all([
        fetch('./i18n/ja.json').then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch('./i18n/en.json').then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
      ]);
      DICTS = { ja: jaRes, en: enRes };
    } catch (e) {
      console.error('[i18n] Failed to load translations:', e);
      // フォールバック用の空オブジェクト
      DICTS = { ja: {}, en: {} };
    }
  })();
  return loadPromise;
}

// 読み込み時に即時非同期フェッチを開始
initI18n();

// 不要な全再翻訳を避けるため、最後に適用した言語を保持
let _lastI18nLang = null;

// ブラウザ/OS 言語を検出して対応言語へマッピング
export function detectBrowserLang() {
  try {
    if (typeof navigator === 'undefined') return 'en';
    const langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || navigator.userLanguage || 'en'];
    for (const l of langs) {
      if (!l) continue;
      const code = l.toLowerCase();
      if (code.startsWith('ja')) return 'ja';
      if (code.startsWith('en')) return 'en';
      // 言語を増やす場合はここにマッピングを追加
    }
    // 既定フォールバック: 日本語以外は英語
    return 'en';
  } catch (e) {
    return 'en';
  }
}

export function getLang() {
  try {
    const stored = localStorage.getItem('lang');
    if (stored) return stored;
    // 初回はブラウザ言語で選択（日本語は ja、それ以外は en）
    const detected = detectBrowserLang();
    // 次回以降も同じ設定を使うため既定言語を保存
    try { localStorage.setItem('lang', detected); } catch (e) { }
    return detected;
  } catch (e) { return 'en'; }
}

export function setLang(lang) {
  try { localStorage.setItem('lang', lang); } catch (e) { }
}

export function t(key, params) {
  const lang = getLang();
  // DICTS が未ロードの場合は key をそのまま返す
  if (!DICTS) {
    return key;
  }
  let s = (DICTS[lang] && DICTS[lang][key]) ? DICTS[lang][key] : (DICTS['en'][key] || key);
  if (params && typeof params === 'object') {
    for (const k of Object.keys(params)) {
      s = s.replace('{' + k + '}', String(params[k]));
    }
  }
  return s;
}

// data-i18n 属性を持つ DOM 要素へ翻訳を適用
export async function applyTranslations(root = document, suppressEvent = false) {
  try {
    if (!DICTS) {
      await initI18n();
    }
    const lang = getLang();

    // 同一言語で文書全体に適用済みならスキップ
    // （ただし root が部分木のときは部分適用を許可）
    if (root === document && _lastI18nLang === lang) return;

    // 無効セレクタ回避のため、主要 i18n 属性を明示的に列挙
    const selector = '[data-i18n], [data-i18n-title], [data-i18n-alt], [data-i18n-html], [data-i18n-placeholder], [data-i18n-value]';
    // root 配下の要素を収集
    let els = [];
    try {
      els = Array.from(root.querySelectorAll(selector));
    } catch (e) {
      els = [];
    }
    // root 自体が要素かつセレクタ一致なら先頭に追加
    try {
      if (root && root.nodeType === 1 && typeof root.matches === 'function') {
        if (root.matches(selector)) els.unshift(root);
      }
    } catch (e) { }

    els.forEach(el => {
      try {
        // この言語で翻訳済みの要素はスキップ
        try {
          if (el.dataset && el.dataset.i18nLang === lang) return;
        } catch (e) { }

        // 主処理: data-i18n によるテキスト/placeholder 翻訳
        const key = el.getAttribute('data-i18n');
        if (key) {
          const txt = t(key);
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            if (el.hasAttribute('placeholder')) el.setAttribute('placeholder', txt);
            else el.value = txt;
          } else {
            el.textContent = txt;
          }
        }

        // 属性別 i18n を処理: data-i18n-title/alt/html など
        for (const attr of Array.from(el.attributes || [])) {
          try {
            if (!attr || !attr.name) continue;
            if (!attr.name.startsWith('data-i18n-')) continue;
            const field = attr.name.slice('data-i18n-'.length); // e.g., 'title' or 'alt' or 'html' or 'value'
            const k = attr.value;
            if (!k) continue;
            const translated = t(k);
            if (field === 'html') {
              el.innerHTML = translated;
            } else if (field === 'placeholder') {
              el.setAttribute('placeholder', translated);
            } else if (field === 'value') {
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = translated;
              else el.setAttribute('value', translated);
            } else {
              el.setAttribute(field, translated);
            }
          } catch (e) { }
        }

        // 現在言語で翻訳済みであることをマーク
        try { if (el.dataset) el.dataset.i18nLang = lang; } catch (e) { }
      } catch (e) { }
    });

    // document の言語属性を設定し、i18n 適用を通知
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = lang;
      }
    } catch (e) { }

    // 文書全体呼び出し向けに最終適用言語を記録
    if (root === document) _lastI18nLang = lang;

    try {
      if (!suppressEvent) {
        try {
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('i18n:updated', { detail: { lang } }));
          }
        } catch (e) { }
      }
    } catch (e) { }

  } catch (e) { }
}
