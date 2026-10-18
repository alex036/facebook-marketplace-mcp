import assert from 'node:assert/strict';
import test from 'node:test';
import { renderReport } from '../src/tracker/public/report-format.js';

test('report renders headings, paragraphs, separate lists, links and asking prices', () => {
  const html = renderReport('# Donor watch\r\n\r\nFirst line\r\ncontinued.\r\n\r\n## Price drops\r\n\r\n- [Jetta](https://www.facebook.com/marketplace/item/123/): **$900**\r\n- Golf\r\n\r\n### Coverage\r\n\r\n- Partial scan');
  assert.equal(html, '<h1>Donor watch</h1><p>First line continued.</p><h2>Price drops</h2><ul><li><a href="https://www.facebook.com/marketplace/item/123/" target="_blank" rel="noopener noreferrer">Jetta</a>: <strong>$900</strong></li><li>Golf</li></ul><h3>Coverage</h3><ul><li>Partial scan</li></ul>');
});

test('provider HTML, quoted attributes, and executable link schemes stay inert', () => {
  const html = renderReport('# <img src=x onerror=alert(1)>\n\n- [<script>](https://example.com/"onmouseover="x)\n- [Bad](javascript:alert(1))\n- **<svg/onload=alert(1)>**');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('href="https://example.com/&quot;onmouseover=&quot;x"'));
  assert.ok(html.includes('&lt;script&gt;</a>'));
  assert.ok(html.includes('[Bad](javascript:alert(1))'));
  assert.ok(html.includes('<strong>&lt;svg/onload=alert(1)&gt;</strong>'));
  assert.doesNotMatch(html, /<img|<script|<svg|href="javascript:| onmouseover="/);
});
