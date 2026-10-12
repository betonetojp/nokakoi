// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { parseMarkdownSafe } from './markdown.js';

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
      '<a href="javascript:alert(1)">unsafe</a>'
    ].join('\n'));

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
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
});
