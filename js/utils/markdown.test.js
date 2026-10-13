// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { parseMarkdownSafe, renderMarkdownWithCustomEmojis, replaceCustomEmojiInDom, truncateMarkdownTokens, renderArticleMarkdownPreviewSync } from './markdown.js';

describe('parseMarkdownSafe', () => {
  it('renders common Markdown syntax', async () => {
    const html = await parseMarkdownSafe('# Title\n\n**bold** and [link](https://example.com)');

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com">link</a>');
  });

  it('removes executable HTML and unsafe URLs', async () => {
    const html = await parseMarkdownSafe([
      '<script>alert("xss")</script>',
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)">unsafe</a>',
      '<a href="ftp://example.com">ftp link</a>',
      '<a href="data:text/html,<script>alert(1)</script>">data link</a>'
    ].join('\n'));

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href="ftp:');
    expect(html).not.toContain('href="data:');
    expect(html).toContain('<a>ftp link</a>');
    expect(html).toContain('<img src="x">');
  });

  it('escapes and renders disallowed tags (marquee, script, etc.) as visible text', async () => {
    const html = await parseMarkdownSafe('<marquee>(☝ ՞ਊ ՞)☝ｳｪｰｲ</marquee><SCRIPT>alert("xss")</SCRIPT><font size=1000>huge</font>');
    expect(html).not.toContain('<marquee');
    expect(html).not.toContain('<SCRIPT');
    expect(html).not.toContain('<font');
    expect(html).toContain('&lt;marquee&gt;(☝ ՞ਊ ՞)☝ｳｪｰｲ&lt;/marquee&gt;');
    expect(html).toContain('&lt;SCRIPT&gt;alert("xss")&lt;/SCRIPT&gt;');
    expect(html).toContain('&lt;font size=1000&gt;huge&lt;/font&gt;');
  });

  it('safely handles unclosed disallowed tags without breaking following markdown', async () => {
    const input = [
      '<marquee>(☝ ՞ਊ ՞)☝ｳｪｰｲ<marquee>',
      '',
      '|1|2|',
      '|:--|:--|',
      '|test|value|'
    ].join('\n');
    const html = await parseMarkdownSafe(input);
    expect(html).toContain('&lt;marquee&gt;(☝ ՞ਊ ՞)☝ｳｪｰｲ&lt;marquee&gt;');
    expect(html).toContain('<table>');
    expect(html).toContain('test');
    expect(html).toContain('value');
  });

  it('handles empty input', async () => {
    await expect(parseMarkdownSafe()).resolves.toBe('');
  });

  it('renders superscript (^th^) and subscript (~2~) without conflicting with strikethrough (~~del~~)', async () => {
    const input = [
      '- 19^th^',
      '- H~2~O',
      '- ~~strikethrough~~'
    ].join('\n');
    const html = await parseMarkdownSafe(input);
    expect(html).toContain('19<sup>th</sup>');
    expect(html).toContain('H<sub>2</sub>O');
    expect(html).toContain('<del>strikethrough</del>');
  });

  it('renders text highlights (==highlight==)', async () => {
    const input = 'This is ==highlighted text== and normal text.';
    const html = await parseMarkdownSafe(input);
    expect(html).toContain('<mark>highlighted text</mark>');
  });

  it('renders task list checkboxes as disabled inputs safely', async () => {
    const input = [
      '- [ ] Incomplete task',
      '- [x] Completed task'
    ].join('\n');
    const html = await parseMarkdownSafe(input);
    expect(html).toContain('<input disabled="" type="checkbox">');
    expect(html).toContain('<input checked="" disabled="" type="checkbox">');
    expect(html).toContain('Incomplete task');
    expect(html).toContain('Completed task');
  });

  it('does not double-escape disallowed tags inside code blocks and inline code', async () => {
    const input = [
      'use `<iframe>` tag',
      '',
      '```html',
      '<script>alert(1)</script>',
      '<b>bold</b>',
      '```'
    ].join('\n');
    const html = await parseMarkdownSafe(input);
    expect(html).toContain('<code>&lt;iframe&gt;</code>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).not.toContain('&amp;lt;');
  });

  it('escapes disallowed tags in block-level raw HTML', async () => {
    const html = await parseMarkdownSafe('<script>\nalert(1)\n</script>\n\n<iframe src="https://example.com"></iframe>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;iframe src="https://example.com"&gt;');
  });

  it('strips inline style attributes to prevent overlay/clickjacking layouts', async () => {
    const html = await parseMarkdownSafe([
      '<div style="position:fixed;inset:0;z-index:99999">overlay</div>',
      '',
      '<a href="https://example.com" style="position:fixed;inset:0;pointer-events:auto">click</a>'
    ].join('\n'));
    expect(html).not.toContain('style=');
    expect(html).not.toContain('position:fixed');
    expect(html).toContain('overlay');
    expect(html).toContain('<a href="https://example.com">click</a>');
  });

  it('does not leak the task-list input hook into other DOMPurify.sanitize calls', async () => {
    const { default: DOMPurify } = await import('dompurify');
    await parseMarkdownSafe('- [x] done');
    const out = DOMPurify.sanitize('<input type="text" name="q">', { ADD_TAGS: ['input'] });
    expect(out).toContain('<input');
    expect(out).toContain('type="text"');
  });
});

describe('renderMarkdownWithCustomEmojis', () => {
  const emojiTags = [
    ['emoji', 'nan', 'https://example.com/nan.webp'],
    ['emoji', 'wayo', 'https://example.com/wayo.webp']
  ];

  it('replaces emoji shortcodes in headings, bold, lists, and tables', async () => {
    const input = [
      '### :nan: **:nan:**',
      '',
      '- item 1:nan:',
      '',
      '| col1 | col2 |',
      '|:--|:--|',
      '| :wayo: | val |'
    ].join('\n');

    const html = await renderMarkdownWithCustomEmojis(input, emojiTags);
    expect(html).toContain('class="custom-emoji"');
    expect(html).toContain('src="https://example.com/nan.webp"');
    expect(html).toContain('src="https://example.com/wayo.webp"');
    expect(html).toContain('alt=":nan:"');
    expect(html).toContain('alt=":wayo:"');
  });

  it('does NOT replace emoji shortcodes inside code blocks or inline code', async () => {
    const input = [
      'Inline `code :nan:` here.',
      '',
      '```',
      'block :nan: here',
      '```'
    ].join('\n');

    const html = await renderMarkdownWithCustomEmojis(input, emojiTags);
    expect(html).toContain('<code>code :nan:</code>');
    expect(html).toContain('block :nan: here');
    expect(html).not.toContain('<img src="https://example.com/nan.webp"');
  });

  it('keeps unknown shortcodes as-is', async () => {
    const input = 'This is :unknown_emoji: here';
    const html = await renderMarkdownWithCustomEmojis(input, emojiTags);
    expect(html).toContain(':unknown_emoji:');
    expect(html).not.toContain('class="custom-emoji"');
  });
});

describe('truncateMarkdownTokens & renderArticleMarkdownPreviewSync', () => {
  it('truncates tokens at block boundaries without breaking reference links', async () => {
    const { marked } = await import('marked');
    const md = [
      '# First Heading',
      '',
      'First paragraph with [referenced link][1].',
      '',
      'Second paragraph that exceeds length '.repeat(20),
      '',
      'Third paragraph which must be dropped '.repeat(50),
      '',
      '[1]: https://example.com/ref-url'
    ].join('\n');

    const tokens = marked.lexer(md);
    const subset = truncateMarkdownTokens(tokens, 200);
    const html = marked.parser(subset);

    expect(html).toContain('<h1>First Heading</h1>');
    expect(html).toContain('<a href="https://example.com/ref-url">referenced link</a>');
    expect(html).toContain('Second paragraph');
    expect(html).not.toContain('Third paragraph');
  });

  it('keeps at least the first content block even if it exceeds maxChars', async () => {
    const { marked } = await import('marked');
    const longPara = 'Word '.repeat(500);
    const md = `${longPara}\n\nSecond paragraph`;
    const tokens = marked.lexer(md);
    const subset = truncateMarkdownTokens(tokens, 100);
    const html = marked.parser(subset);

    expect(html).toContain(longPara.slice(0, 100));
    expect(html).not.toContain('Second paragraph');
  });

  it('safely closes massive code blocks when truncating', async () => {
    const { marked } = await import('marked');
    const massiveCode = 'console.log("hello");\n'.repeat(100);
    const md = `\`\`\`javascript\n${massiveCode}\`\`\`\n\nFollowing paragraph`;
    const tokens = marked.lexer(md);
    const subset = truncateMarkdownTokens(tokens, 150);
    const html = marked.parser(subset);

    expect(html).toContain('<pre><code class="language-javascript">');
    expect(html).toContain('...');
    expect(html).not.toContain('Following paragraph');
  });

  it('converts markdown images to fallback links when inlineMedia is false, while preserving custom emojis', () => {
    const md = [
      '# Preview Title :nan:',
      '',
      'Here is an inline image: ![alt text](https://example.com/photo.png)',
      '',
      'And raw html image: <img src="https://example.com/raw.png" alt="raw alt">',
      '',
      ':nan: emoji in text'
    ].join('\n');

    const emojiTags = [['emoji', 'nan', 'https://example.com/nan.webp']];

    // inlineMedia: false
    const htmlNoMedia = renderArticleMarkdownPreviewSync(md, emojiTags, { inlineMedia: false });
    expect(htmlNoMedia).not.toContain('<img src="https://example.com/photo.png"');
    expect(htmlNoMedia).not.toContain('<img src="https://example.com/raw.png"');
    expect(htmlNoMedia).toContain('class="article-image-fallback"');
    expect(htmlNoMedia).toContain('href="https://example.com/photo.png"');
    expect(htmlNoMedia).toContain('href="https://example.com/raw.png"');
    expect(htmlNoMedia).toContain('[画像: alt text]');
    // カスタム絵文字は画像として保持される
    expect(htmlNoMedia).toContain('class="custom-emoji"');
    expect(htmlNoMedia).toContain('src="https://example.com/nan.webp"');

    // inlineMedia: true (デフォルト)
    const htmlWithMedia = renderArticleMarkdownPreviewSync(md, emojiTags, { inlineMedia: true });
    expect(htmlWithMedia).toContain('<img src="https://example.com/photo.png" alt="alt text">');
    expect(htmlWithMedia).toContain('class="custom-emoji"');
  });
});

