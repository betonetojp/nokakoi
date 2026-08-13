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

  it('handles empty input', async () => {
    await expect(parseMarkdownSafe()).resolves.toBe('');
  });
});
