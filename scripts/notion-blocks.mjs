// Parse Notion-flavored markdown (as returned by the Notion connector / produced by the REST exporter)
// into a structured block tree the dashboard can render. No content is invented or dropped:
// anything unrecognized is kept as a paragraph of its plain text and reported in `unrendered`.

const indentOf = l => (l.match(/^\t*/)[0].length) + Math.floor((l.match(/^\t*( *)/)[1].length) / 4);
const dedent = (l, n = 1) => { let s = l; for (let i = 0; i < n; i++) s = s.replace(/^(\t| {4})/, ''); return s; };

// Inline: keep a safe markdown subset (bold, italic, code, strike, links); convert Notion inline tags.
export function inline(s) {
  return String(s ?? '')
    .replace(/<mention-(?:page|database|link)[^>]*url="([^"]+)"[^>]*>(.*?)<\/mention-[a-z]+>/g, (_, u, t) => `[${t || 'Link'}](${u})`)
    .replace(/<mention-(?:page|database|link)[^>]*url="([^"]+)"[^>]*\/>/g, (_, u) => `[Linked Notion page](${u})`)
    .replace(/<mention-user[^>]*>(.*?)<\/mention-user>/g, '@$1')
    .replace(/<mention-date[^>]*start="([^"]+)"[^>]*\/?>(?:<\/mention-date>)?/g, '$1')
    .replace(/<\/?(span|u|br|color)[^>]*>/g, '')
    .replace(/\s*\{(?:color|toggle)="[^"]*"\}\s*$/, '')
    .replace(/\\\|/g, '|')
    .replace(/[ \t]+$/, '');
}

function collectContainer(lines, i, open, close) {
  // returns [innerLines, nextIndex]; handles nesting of the same tag
  const base = indentOf(lines[i]); let depth = 0; const inner = [];
  for (let j = i; j < lines.length; j++) {
    const t = lines[j].trim();
    const opens = (t.match(new RegExp(`<${open}[\\s>]`, 'g')) || []).length + (t === `<${open}>` ? 0 : 0);
    const closes = (t.match(new RegExp(`</${close}>`, 'g')) || []).length;
    depth += opens - closes;
    inner.push(lines[j]);
    if (depth <= 0 && j >= i) return [inner, j + 1, base];
  }
  return [inner, lines.length, base];
}

export function parseBlocks(md, unrendered = []) {
  const lines = md.replace(/\r/g, '').split('\n');
  return parseLines(lines, unrendered);
}

function parseLines(lines, unrendered) {
  const out = []; let i = 0;
  const base = Math.min(...lines.filter(l => l.trim()).map(indentOf), 99);
  const norm = lines.map(l => dedent(l, base === 99 ? 0 : base));
  while (i < norm.length) {
    const raw = norm[i], line = raw.trimEnd(), t = line.trim();
    if (!t) { i++; continue; }
    if (indentOf(line) > 0) { // orphan indented content: attach to previous block as children
      const kids = []; while (i < norm.length && (indentOf(norm[i]) > 0 || !norm[i].trim())) kids.push(norm[i++]);
      const prev = out[out.length - 1];
      const parsed = parseLines(kids, unrendered);
      if (prev && 'children' in prev) prev.children.push(...parsed); else out.push(...parsed);
      continue;
    }
    // fenced code
    if (t.startsWith('```')) {
      const lang = t.slice(3).trim(); const body = []; i++;
      while (i < norm.length && !norm[i].trim().startsWith('```')) body.push(norm[i++]);
      i++; out.push({ type: 'code', lang, text: body.join('\n') }); continue;
    }
    // toggle
    if (/^<details\b/.test(t)) {
      const [inner, next] = collectContainer(norm, i, 'details', 'details'); i = next;
      const joined = inner.join('\n');
      const summary = (joined.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || '';
      const body = joined.replace(/^[\s\S]*?<\/summary>\n?/, '').replace(/<\/details>\s*$/, '');
      out.push({ type: 'toggle', text: inline(summary.trim()), children: parseLines(body.split('\n'), unrendered) }); continue;
    }
    // callout
    if (/^<callout\b/.test(t)) {
      const [inner, next] = collectContainer(norm, i, 'callout', 'callout'); i = next;
      const joined = inner.join('\n');
      const icon = (joined.match(/<callout[^>]*icon="([^"]*)"/) || [])[1] || '';
      const color = (joined.match(/<callout[^>]*color="([^"]*)"/) || [])[1] || '';
      const body = joined.replace(/^\s*<callout[^>]*>\n?/, '').replace(/<\/callout>\s*$/, '');
      out.push({ type: 'callout', icon, color, children: parseLines(body.split('\n'), unrendered) }); continue;
    }
    // table
    if (/^<table\b/.test(t)) {
      const [inner, next] = collectContainer(norm, i, 'table', 'table'); i = next;
      const joined = inner.join('\n');
      const header = /header-row="true"/.test(joined);
      const rows = [...joined.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => inline(c[1].trim().replace(/\s*\n\s*/g, ' '))));
      out.push({ type: 'table', header, rows }); continue;
    }
    // columns: flatten children in order
    if (/^<\/?columns?\b/.test(t)) { i++; continue; }
    if (/^<empty-block\s*\/?>/.test(t)) { i++; continue; }
    // child pages / databases / media → link blocks
    let m;
    if ((m = t.match(/^<(page|database|image|file|video|audio|pdf|embed|bookmark)\b[^>]*(?:url|src|source)="([^"]+)"[^>]*>(.*?)(?:<\/\1>)?$/))) {
      out.push({ type: 'link', kind: m[1], url: m[2], text: inline(m[3].replace(/<[^>]+>/g, '')) || m[1] }); i++; continue;
    }
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
      const block = { type: 'heading', level: m[1].length, text: inline(m[2]), children: [] };
      out.push(block); i++; continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { out.push({ type: 'divider' }); i++; continue; }
    if ((m = t.match(/^[-*+]\s+\[([ xX])\]\s?(.*)$/))) { out.push({ type: 'todo', checked: m[1] !== ' ', text: inline(m[2]), children: [] }); i++; continue; }
    if ((m = t.match(/^[-*+](?:\s+(.*))?$/))) { out.push({ type: 'bullet', text: inline(m[1] || ''), children: [] }); i++; continue; }
    if ((m = t.match(/^(\d+)[.)]\s+(.*)$/))) { out.push({ type: 'numbered', n: +m[1], text: inline(m[2]), children: [] }); i++; continue; }
    if ((m = t.match(/^>\s?(.*)$/))) { out.push({ type: 'quote', text: inline(m[1]), children: [] }); i++; continue; }
    if (/^<\/?[a-z-]+[^>]*>$/.test(t)) { unrendered.push(t.slice(0, 40)); i++; continue; } // stray structural tag
    if (/^<[a-z-]+\b/.test(t)) unrendered.push(t.replace(/>.*$/, '>').slice(0, 40));
    out.push({ type: 'paragraph', text: inline(t.replace(/<[^>]+>/g, '')) }); i++;
  }
  return out;
}

// Group top-level blocks into sections at the shallowest heading level present.
export function sectionize(blocks) {
  const levels = blocks.filter(b => b.type === 'heading').map(b => b.level);
  const top = levels.length ? Math.min(...levels) : 0;
  const sections = []; let cur = { heading: '', level: 0, blocks: [] };
  for (const b of blocks) {
    if (b.type === 'heading' && b.level === top) {
      if (cur.heading || cur.blocks.length) sections.push(cur);
      cur = { heading: b.text, level: b.level, blocks: [...(b.children || [])] };
    } else cur.blocks.push(b);
  }
  if (cur.heading || cur.blocks.length) sections.push(cur);
  return sections;
}
