const escapeHtml = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// Only the report generator's headings, lists, links and bold text are supported.
// Listing text and CRM notes must never become raw HTML.
export function renderReport(markdown) {
  const inline = text => {
    const tokens = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*/g;
    let html = '', start = 0;
    for (const match of text.matchAll(tokens)) {
      html += escapeHtml(text.slice(start, match.index));
      html += match[1] !== undefined
        ? `<a href="${escapeHtml(match[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[1])}</a>`
        : `<strong>${escapeHtml(match[3])}</strong>`;
      start = match.index + match[0].length;
    }
    return html + escapeHtml(text.slice(start));
  };
  let html = '', paragraph = [], inList = false;
  const flushParagraph = () => {
    if (paragraph.length) html += `<p>${inline(paragraph.join(' '))}</p>`;
    paragraph = [];
  };
  const closeList = () => { if (inList) html += '</ul>'; inList = false; };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(/^(#{1,3}) (.+)$/);
    const item = line.match(/^- (.+)$/);
    if (item) {
      flushParagraph();
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(item[1])}</li>`;
    } else {
      closeList();
      if (heading || !line.trim()) flushParagraph();
      if (heading) html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
      else if (line.trim()) paragraph.push(line);
    }
  }
  flushParagraph(); closeList();
  return html;
}
