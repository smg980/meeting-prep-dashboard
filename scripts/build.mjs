#!/usr/bin/env node
// Build the encrypted meeting dataset for the dashboard.
//
// Sources (all optional, combined):
//   1. Notion prep pages exported as markdown into .cache/notion/*.md  (gitignored)
//      — written by Grok Bot from the Notion connector each morning.
//   2. Notion REST API, if NOTION_TOKEN + NOTION_PREP_PARENT_ID are set (child pages of "Meeting Prep").
//   3. Outlook published calendar, if OUTLOOK_ICS_URL is set (times/attendees, + unprepped external meetings).
//
// Output: docs/data.enc.json  — AES-256-GCM, key = PBKDF2-SHA256(DASHBOARD_PASSPHRASE, random salt, 600k iters).
// Plaintext never touches the repo. Use --example to build a labeled EXAMPLE dataset into example/ (gitignored).

import { webcrypto as crypto, createHash } from 'node:crypto';
import { parseBlocks, sectionize } from './notion-blocks.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TZ = 'America/Chicago';
const ITERATIONS = 600_000;
const args = new Set(process.argv.slice(2));
const EXAMPLE = args.has('--example');
const DRY = args.has('--dry-run'); // print summary only (no titles), no write

// ---------- time helpers ----------
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function tzOffsetMinutes(date, tz = TZ) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).map(p => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUTC - date.getTime()) / 60000;
}
function zonedToUTC(y, m, d, h, min, tz = TZ) {
  let guess = new Date(Date.UTC(y, m, d, h, min));
  for (let i = 0; i < 2; i++) guess = new Date(Date.UTC(y, m, d, h, min) - tzOffsetMinutes(guess, tz) * 60000);
  return guess;
}
const to24 = (h, ap) => { h = +h; if (!ap) return h; ap = ap.toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0; return h; };

// ---------- markdown prep page parser ----------
function parseSections(md) {
  const sections = []; let cur = { heading: '', lines: [] };
  for (const line of md.split('\n')) {
    const m = line.match(/^#{1,3}\s+(.*)$/);
    if (m) { sections.push(cur); cur = { heading: m[1].trim(), lines: [] }; } else cur.lines.push(line);
  }
  sections.push(cur);
  return sections;
}
const unlink = s => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
const clean = s => unlink(s).replace(/\*\*/g, '').replace(/\*/g, '').replace(/\\\|/g, '|').trim();
const find = (secs, re) => secs.find(s => re.test(s.heading));
const items = sec => sec ? sec.lines.map(l => l.match(/^\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.*)$/)).filter(Boolean).map(m => clean(m[1])).filter(Boolean) : [];
const checks = sec => {
  const l = sec ? sec.lines.filter(x => /^\s*[-*]\s+\[[ xX]\]/.test(x)) : [];
  return { done: l.filter(x => /\[[xX]\]/.test(x)).length, total: l.length };
};
const paragraph = sec => sec ? clean(sec.lines.filter(l => l.trim() && !/^[\s<]|^[-*\d>]/.test(l)).join(' ')) : '';

// Opaque, stable route id (doesn't reveal the title; stable across rebuilds for deep links)
export const routeId = id => createHash('sha256').update('mpd-route-v1:' + id.replace(/-/g, '')).digest('base64url').slice(0, 12);

export function parsePrepPage({ id, title, url, last_edited, content, icon }) {
  const secs = parseSections(content);
  const full = content;
  // Date: from title "<Meeting> — October 20, 2026"
  const dm = (title + ' ' + full).match(new RegExp(`(${MONTHS.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
  const tm = full.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  let start = null, end = null;
  if (dm) {
    const [y, mo, d] = [+dm[3], MONTHS.indexOf(dm[1].toLowerCase()), +dm[2]];
    if (tm) {
      const ap1 = tm[3] || tm[6];
      start = zonedToUTC(y, mo, d, to24(tm[1], ap1), +(tm[2] || 0));
      end = zonedToUTC(y, mo, d, to24(tm[4], tm[6]), +(tm[5] || 0));
    } else start = zonedToUTC(y, mo, d, 9, 0);
  }
  const baseTitle = clean(title.replace(/\s+—\s+[A-Z][a-z]+ \d{1,2}, \d{4}\s*$/, '').replace(/\s*Meeting Prep\s*$/i, ''));
  const acctLine = (full.match(/\*\*Account:\*\*\s*(.+)/i) || [])[1];
  const parts = baseTitle.split(/\s+[—–-]\s+/);
  const account = acctLine ? clean(acctLine) : parts.length > 1 ? parts[0] : '';
  const attLine = full.match(/\*\*(?:Attendees|Participants?):\*\*\s*(.+)/gi) || [];
  const seen = new Map();
  for (const n of attLine.flatMap(l => clean(l.replace(/^.*?:\*\*/, '')).split(/,|;/).map(s => s.trim()).filter(Boolean))) {
    const k = n.replace(/\s*\(.*\)\s*$/, '').toLowerCase(); if (!seen.has(k) || n.length > seen.get(k).length) seen.set(k, n);
  }
  const attendees = [...seen.values()];
  const purpose = (full.match(/\*\*Purpose:\*\*\s*(.+)/i) || [])[1];
  const link = (full.match(/\*\*Location:\*\*\s*(.+)/i) || full.match(/\*\*Meeting link:\*\*\s*(.+)/i) || [])[1];
  const unrendered = [];
  const sections = sectionize(parseBlocks(content, unrendered));
  return {
    id: id.replace(/-/g, ''),
    rid: routeId(id),
    page: { icon: icon || '', sections, unrendered },
    title: baseTitle,
    account,
    start: start?.toISOString() || null,
    end: end?.toISOString() || null,
    attendees,
    location: link ? clean(link).replace(/^\((.*)\)$/, '$1') : '',
    purpose: purpose ? clean(purpose) : '',
    objective: paragraph(find(secs, /objective/i)),
    questions: items(find(secs, /question/i)).slice(0, 8),
    agenda: items(find(secs, /agenda/i)),
    prep: checks(find(secs, /prep checklist/i)),
    followup: checks(find(secs, /follow-?up checklist/i)),
    notionUrl: url,
    notionEditedAt: last_edited || null,
    hasPrep: true,
    source: 'notion',
  };
}

async function readNotionCache() {
  const dir = path.join(ROOT, '.cache', 'notion');
  let files = []; try { files = (await fs.readdir(dir)).filter(f => f.endsWith('.md')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(dir, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) continue;
    const meta = Object.fromEntries(m[1].split('\n').filter(l => l.includes(':')).map(l => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
    out.push(parsePrepPage({ ...meta, content: m[2] }));
  }
  return out;
}

// Optional: Notion REST API (needs an internal integration token shared with the "Meeting Prep" page).
async function readNotionApi() {
  const { NOTION_TOKEN: tok, NOTION_PREP_PARENT_ID: parent } = process.env;
  if (!tok || !parent) return [];
  const h = { Authorization: `Bearer ${tok}`, 'Notion-Version': '2022-06-28' };
  const get = async u => { const r = await fetch(`https://api.notion.com/v1/${u}`, { headers: h }); if (!r.ok) throw new Error(`Notion ${r.status}`); return r.json(); };
  const children = async id => { let res = [], c; do { const j = await get(`blocks/${id}/children?page_size=100${c ? `&start_cursor=${c}` : ''}`); res.push(...j.results); c = j.has_more ? j.next_cursor : null; } while (c); return res; };
  const txt = rt => (rt || []).map(t => { let x = t.plain_text; if (t.annotations?.code) x = '`' + x + '`'; if (t.annotations?.bold) x = `**${x}**`; if (t.annotations?.italic) x = `*${x}*`; if (t.href) x = `[${x}](${t.href})`; return x; }).join('');
  const toMd = async (id, depth = 0) => {
    const lines = [];
    for (const b of await children(id)) {
      const v = b[b.type] || {}; const pad = '  '.repeat(depth);
      if (b.type.startsWith('heading_')) lines.push(`${'#'.repeat(+b.type.slice(-1) + 1)} ${txt(v.rich_text)}`);
      else if (b.type === 'to_do') lines.push(`${pad}- [${v.checked ? 'x' : ' '}] ${txt(v.rich_text)}`);
      else if (b.type === 'bulleted_list_item') lines.push(`${pad}- ${txt(v.rich_text)}`);
      else if (b.type === 'numbered_list_item') lines.push(`${pad}1. ${txt(v.rich_text)}`);
      else if (b.type === 'paragraph') lines.push(pad + (txt(v.rich_text) || ''));
      else if (b.type === 'quote') lines.push(`${pad}> ${txt(v.rich_text)}`);
      else if (b.type === 'divider') lines.push(`${pad}---`);
      else if (b.type === 'code') lines.push(`${pad}\`\`\`${v.language || ''}`, ...txt(v.rich_text).split('\n').map(l => pad + l), `${pad}\`\`\``);
      else if (b.type === 'toggle') { lines.push(`${pad}<details>`, `${pad}<summary>${txt(v.rich_text)}</summary>`, await toMd(b.id, depth + 1), `${pad}</details>`); continue; }
      else if (b.type === 'callout') { lines.push(`${pad}<callout icon="${v.icon?.emoji || ''}">`, `${pad}\t${txt(v.rich_text)}`, b.has_children ? await toMd(b.id, depth + 1) : '', `${pad}</callout>`); continue; }
      else if (b.type === 'table') {
        const rows = await children(b.id);
        lines.push(`${pad}<table${v.has_column_header ? ' header-row="true"' : ''}>`, ...rows.map(r => `${pad}\t<tr>${r.table_row.cells.map(c => `<td>${txt(c)}</td>`).join('')}</tr>`), `${pad}</table>`); continue;
      }
      else if (b.type === 'child_page') lines.push(`${pad}<page url="https://www.notion.so/${b.id.replace(/-/g, '')}">${v.title}</page>`);
      else if (['bookmark', 'embed', 'link_preview'].includes(b.type)) lines.push(`${pad}<bookmark url="${v.url}">${v.url}</bookmark>`);
      else if (['image', 'file', 'pdf', 'video', 'audio'].includes(b.type)) lines.push(`${pad}<${b.type} url="${v.external?.url || v.file?.url || ''}">${txt(v.caption) || b.type}</${b.type}>`);
      else lines.push(`${pad}<unsupported type="${b.type}"/>`);
      if (b.has_children && b.type !== 'child_page') lines.push(await toMd(b.id, depth + 1));
    }
    return lines.join('\n');
  };
  const pages = (await children(parent)).filter(b => b.type === 'child_page');
  const out = [];
  for (const p of pages) {
    const meta = await get(`pages/${p.id}`);
    out.push(parsePrepPage({ id: p.id, title: p.child_page.title, url: meta.url, last_edited: meta.last_edited_time, icon: meta.icon?.emoji, content: await toMd(p.id) }));
  }
  return out;
}

// Optional: Outlook ICS feed.
function parseICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const evs = []; let e = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') e = { attendees: [] };
    else if (l === 'END:VEVENT') { evs.push(e); e = null; }
    else if (e) {
      const i = l.indexOf(':'); const [k, ...params] = l.slice(0, i).split(';'); const v = l.slice(i + 1);
      const p = Object.fromEntries(params.map(x => x.split('=')));
      if (k === 'DTSTART' || k === 'DTEND') e[k] = icsDate(v, p.TZID);
      else if (k === 'SUMMARY') e.summary = v.replace(/\\,/g, ',').replace(/\\;/g, ';');
      else if (k === 'LOCATION') e.location = v.replace(/\\,/g, ',');
      else if (k === 'UID') e.uid = v;
      else if (k === 'ATTENDEE') e.attendees.push({ name: p.CN?.replace(/"/g, ''), email: v.replace(/^mailto:/i, '') });
      else if (k === 'ORGANIZER') e.organizer = v.replace(/^mailto:/i, '');
    }
  }
  return evs;
}
const WIN_TZ = { 'Central Standard Time': 'America/Chicago', 'Eastern Standard Time': 'America/New_York', 'Pacific Standard Time': 'America/Los_Angeles', 'Mountain Standard Time': 'America/Denver', UTC: 'UTC' };
function icsDate(v, tzid) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/); if (!m) return null;
  if (m[7]) return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return zonedToUTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), WIN_TZ[tzid] || tzid || TZ);
}
async function readICS() {
  const url = process.env.OUTLOOK_ICS_URL; if (!url) return [];
  const r = await fetch(url); if (!r.ok) throw new Error(`ICS fetch failed: ${r.status}`);
  const now = Date.now(), horizon = now + 14 * 864e5;
  return parseICS(await r.text()).filter(e => e.DTSTART && e.DTSTART.getTime() >= now - 864e5 && e.DTSTART.getTime() <= horizon);
}

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function merge(prep, events) {
  const orgDomain = (process.env.ORG_EMAIL_DOMAIN || '').toLowerCase();
  const used = new Set();
  for (const m of prep) {
    const ev = events.find(e => !used.has(e) && m.start && Math.abs(e.DTSTART - new Date(m.start)) < 6 * 36e5 &&
      (norm(e.summary).includes(norm(m.account)) || norm(m.title).split(' ').filter(w => w.length > 3).some(w => norm(e.summary).includes(w))));
    if (!ev) continue;
    used.add(ev);
    m.start = ev.DTSTART.toISOString(); if (ev.DTEND) m.end = ev.DTEND.toISOString();
    if (ev.attendees.length) m.attendees = ev.attendees.map(a => a.name || a.email);
    if (ev.location) m.location = ev.location;
    m.source = 'notion+calendar';
  }
  // Calendar-only meetings: only surface external ones (likely need prep) when the org domain is known.
  const extra = orgDomain ? events.filter(e => !used.has(e) && e.attendees.some(a => a.email && !a.email.toLowerCase().endsWith('@' + orgDomain))) : [];
  return prep.concat(extra.map(e => ({
    id: routeId(e.uid || e.summary), rid: routeId(e.uid || e.summary), page: null, title: e.summary, account: '', start: e.DTSTART.toISOString(),
    end: e.DTEND?.toISOString() || null, attendees: e.attendees.map(a => a.name || a.email), location: e.location || '', purpose: '', objective: '',
    questions: [], agenda: [], prep: { done: 0, total: 0 }, followup: { done: 0, total: 0 }, notionUrl: null, hasPrep: false, source: 'calendar',
  })));
}

// ---------- example data (clearly labeled, never committed) ----------
const EXAMPLE_MD = acct => `## Meeting prep checklist
- [x] EXAMPLE: Review calendar invite and description
- [x] EXAMPLE: Confirm attendee roles and recent context
- [x] EXAMPLE: Skim prior notes and opportunity record
- [ ] EXAMPLE: Identify top 3 outcomes for the call
- [ ] EXAMPLE: Prepare opening line and first status question
## Meeting details
- **EXAMPLE ${acct} — Discovery call**
- **Participant:** Example Person A (Example Co)
- **Purpose:** EXAMPLE DATA for design preview only.
## Objective
EXAMPLE objective: confirm status, stakeholders, milestones and next actions.
<callout icon="💡" color="blue_bg">
	EXAMPLE callout: this whole page is **sample content** for a design preview.
</callout>
## Priority questions
1. **Status:** EXAMPLE — where does the opportunity stand?
2. **Timing:** EXAMPLE — is the target close date realistic?
3. **Engagement:** EXAMPLE — who is the economic buyer?
## Agenda outline
- 0–5 min: EXAMPLE context and goals
- 5–20 min: EXAMPLE milestones and blockers
- 20–30 min: EXAMPLE owners, actions and dates
## Stakeholder map
<table header-row="true">
	<tr>
		<td>Name</td>
		<td>Role</td>
		<td>Stance</td>
	</tr>
	<tr>
		<td>Example Person A</td>
		<td>EXAMPLE champion</td>
		<td>Supportive</td>
	</tr>
	<tr>
		<td>Example Person B</td>
		<td>EXAMPLE economic buyer</td>
		<td>Unknown</td>
	</tr>
</table>
<details>
<summary>EXAMPLE toggle: background reading</summary>
	- EXAMPLE note inside a toggle with a [link](https://www.notion.so/)
</details>
## Live notes
- **Opening / context:**
- **Current status:**
- **Agreed next actions:**
	- Action: ___ | Owner: ___ | Due: ___
## Follow-up checklist
- [ ] EXAMPLE: Send recap email
- [ ] EXAMPLE: Update opportunity record
- [ ] EXAMPLE: Schedule next meeting
`;
function exampleData() {
  const t = (dh, h, m, dur = 30) => { const now = new Date(); const s = new Date(now); s.setDate(now.getDate() + dh); const y = s.getFullYear(), mo = s.getMonth(), d = s.getDate();
    const st = zonedToUTC(y, mo, d, h, m); return [st.toISOString(), new Date(st.getTime() + dur * 6e4).toISOString()]; };
  const mk = (i, acct, title, [start, end], extra = {}) => {
    const m = parsePrepPage({ id: 'example-' + i, title: `EXAMPLE — ${acct} — ${title}`, url: 'https://www.notion.so/', last_edited: new Date().toISOString(), icon: '📋', content: EXAMPLE_MD(acct) });
    return { ...m, account: `EXAMPLE ${acct}`, start, end, attendees: ['Example Person A (Example Co)', 'Example Person B (Example Co)', 'Steve (You)'], location: 'Teams', source: 'example', ...extra };
  };
  return [
    mk(1, 'Acme Corp', 'Opportunity review', t(0, 15, 30), { followup: { done: 1, total: 3 } }),
    mk(2, 'Globex', 'Discovery call', t(1, 10, 0, 45)),
    mk(3, 'Initech', 'Exec alignment', t(1, 14, 0, 60), { prep: { done: 0, total: 5 } }),
    { ...mk(4, 'Umbrella', 'External kickoff', t(2, 11, 0)), hasPrep: false, notionUrl: null, page: null, objective: '', purpose: 'EXAMPLE DATA for design preview only.', questions: [], agenda: [], prep: { done: 0, total: 0 }, followup: { done: 0, total: 0 }, source: 'calendar' },
    mk(5, 'Hooli', 'QBR (past)', t(-1, 13, 0), { prep: { done: 5, total: 5 }, followup: { done: 2, total: 3 } }),
  ];
}

// ---------- crypto ----------
const b64 = u8 => Buffer.from(u8).toString('base64');
async function encrypt(obj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

// ---------- main ----------
async function main() {
  const pass = process.env.DASHBOARD_PASSPHRASE;
  if (!pass) { console.error('DASHBOARD_PASSPHRASE is not set.'); process.exit(1); }
  if (pass.length < 12) console.warn('Warning: passphrase shorter than 12 characters.');
  let meetings, sources;
  if (EXAMPLE) { meetings = exampleData(); sources = ['example']; }
  else {
    const byId = new Map();
    for (const m of [...await readNotionCache(), ...await readNotionApi()]) byId.set(m.id, m);
    const events = await readICS();
    meetings = merge([...byId.values()], events);
    sources = ['notion', ...(events.length || process.env.OUTLOOK_ICS_URL ? ['outlook-ics'] : [])];
  }
  meetings.sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
  const payload = { generatedAt: new Date().toISOString(), timezone: TZ, sources, example: EXAMPLE, meetings };
  console.log(`meetings: ${meetings.length} (with prep page: ${meetings.filter(m => m.hasPrep).length}); sources: ${sources.join(', ')}`);
  if (DRY) return;
  const outDir = EXAMPLE ? path.join(ROOT, 'example') : path.join(ROOT, 'docs');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'data.enc.json'), JSON.stringify(await encrypt(payload, pass)) + '\n');
  console.log(`wrote ${path.relative(ROOT, path.join(outDir, 'data.enc.json'))}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
