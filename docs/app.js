'use strict';
(() => {
  const TZ = 'America/Chicago';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const httpUrl = u => (typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u)) ? u : null;
  const safeUrl = u => (typeof u === 'string' && /^https:\/\/([a-z0-9-]+\.)*notion\.(so|com)\//i.test(u)) ? u : null;
  const ICON = {
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4 4L19 7"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
    target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
    help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/></svg>',
    agenda: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    notes: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  };

  // ---------- crypto ----------
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function fetchBlob() { const r = await fetch('data.enc.json', { cache: 'no-store' }); if (!r.ok) throw new Error('Could not load encrypted data.'); return r.json(); }
  async function decrypt(blob, pass) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(blob.salt), iterations: blob.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // ---------- formatting (Central time) ----------
  const fmt = (d, o) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).format(d);
  const dayKey = d => fmt(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeStr = d => fmt(d, { hour: 'numeric', minute: '2-digit' });
  const tzAbbr = d => fmt(d, { timeZoneName: 'short' }).split(' ').pop();
  function dayLabel(d) {
    const now = new Date(), k = dayKey(d);
    if (k === dayKey(now)) return 'Today';
    if (k === dayKey(new Date(now.getTime() + 864e5))) return 'Tomorrow';
    if (k === dayKey(new Date(now.getTime() - 864e5))) return 'Yesterday';
    return fmt(d, { weekday: 'long' });
  }
  const initials = n => n.replace(/\(.*?\)/g, '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const pct = c => c.total ? Math.round(100 * c.done / c.total) : 0;
  const SOON = 15 * 6e4;
  const startingSoon = m => { const d = m.s - new Date(); return d > 0 && d <= SOON; };
  function status(m) {
    if (startingSoon(m)) return ['urgent', `Starts in ${Math.max(1, Math.ceil((m.s - new Date()) / 6e4))} min`];
    if (!m.hasPrep) return ['none', 'No prep page'];
    if (m.prep.total && m.prep.done === m.prep.total) return ['ready', 'Ready'];
    if (m.prep.done > 0) return ['progress', `Prep ${pct(m.prep)}%`];
    return ['todo', 'Prep not started'];
  }

  // ---------- render ----------
  let DATA = null, RANGE = '48', timer = null;
  const meetings = () => (DATA.meetings || []).filter(m => m.start).map(m => ({ ...m, s: new Date(m.start), e: m.end ? new Date(m.end) : new Date(new Date(m.start).getTime() + 30 * 6e4) }));

  function bar(label, c) {
    if (!c.total) return '';
    return `<div class="bar ${c.done === c.total ? 'done' : ''}"><div class="lbl"><span>${label}</span><span>${c.done}/${c.total}</span></div><div class="track"><div class="fill" data-w="${pct(c)}"></div></div></div>`;
  }
  function notionBtn(m, cls = 'btn sm', label = 'Open in Notion') {
    const u = safeUrl(m.notionUrl);
    return u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${ICON.ext}${label}</a>` : '';
  }
  const routeOf = m => '#/meeting/' + encodeURIComponent(m.rid || '');
  function viewBtn(m, cls = 'btn primary sm') {
    return m.page && m.rid ? `<a class="${cls}" href="${routeOf(m)}">View prep${ICON.arrow}</a>` : '';
  }
  function card(m, isNext) {
    const [sc, st] = status(m);
    const people = (m.attendees || []).slice(0, 6).map(p => `<span class="chip"><i>${esc(initials(p))}</i>${esc(p)}</span>`).join('');
    const extra = (m.attendees || []).length > 6 ? `<span class="chip">+${m.attendees.length - 6}</span>` : '';
    const hasMore = (m.questions || []).length || (m.agenda || []).length;
    const ended = m.e < new Date();
    return `<article class="card ${isNext ? 'next' : ''}">
      <div class="time"><b>${esc(timeStr(m.s))}</b><small>– ${esc(timeStr(m.e))} ${esc(tzAbbr(m.s))}</small></div>
      <div>
        <div class="title-row">${m.account ? `<span class="acct">${esc(m.account)}</span>` : ''}<h3>${esc(m.title)}</h3></div>
        ${m.objective || m.purpose ? `<p class="objective">${esc(m.objective || m.purpose)}</p>` : ''}
        ${people || extra ? `<div class="people">${people}${extra}</div>` : ''}
        <div class="bars">${bar('Prep checklist', m.prep)}${m.nextActions ? bar('Next actions', m.nextActions) : ''}${ended ? bar('Follow-up', m.followup) : ''}</div>
        ${hasMore ? `<details class="more"><summary>Questions &amp; agenda</summary><div class="more-grid">
          ${(m.questions || []).length ? `<div><h4>Priority questions</h4><ol>${m.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol></div>` : ''}
          ${(m.agenda || []).length ? `<div><h4>Agenda</h4><ul>${m.agenda.map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
        </div></details>` : ''}
      </div>
      <div class="side"><span class="status ${sc}">${esc(st)}</span>${viewBtn(m)}${notionBtn(m, 'btn ghost sm icon-only', 'Notion')}</div>
    </article>`;
  }
  function groupByDay(list, nextId) {
    const groups = new Map();
    for (const m of list) { const k = dayKey(m.s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    return [...groups.values()].map(ms => `<div class="day"><div class="day-label">${esc(dayLabel(ms[0].s))}<small>${esc(fmt(ms[0].s, { month: 'short', day: 'numeric' }))}</small></div>
      <div class="cards">${ms.map(m => card(m, m.id === nextId)).join('')}</div></div>`).join('');
  }
  function emptyState(title, body) {
    return `<div class="empty-state"><div class="ill">${ICON.cal}</div><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
  }

  function renderHero(next, current) {
    const hero = $('#hero');
    const m = current || next;
    if (!m) {
      hero.className = 'hero empty';
      hero.innerHTML = `<div><div class="eyebrow">Next meeting</div><h2>You're all clear</h2><div class="meta"><span>No upcoming meetings need prep right now. New prep pages appear here after the next morning refresh.</span></div></div>`;
      return;
    }
    hero.className = 'hero' + (!current && startingSoon(m) ? ' urgent' : '');
    hero.innerHTML = `<div><div class="eyebrow">${current ? '<span class="live">In progress</span>' : 'Next meeting'}</div>
      <h2>${esc(m.title)}</h2>
      <div class="meta"><span>${ICON.clock}${esc(dayLabel(m.s))}, ${esc(fmt(m.s, { month: 'short', day: 'numeric' }))} · ${esc(timeStr(m.s))}–${esc(timeStr(m.e))} ${esc(tzAbbr(m.s))}</span>
        ${(m.attendees || []).length ? `<span>${ICON.users}${esc(m.attendees.length)} attendee${m.attendees.length > 1 ? 's' : ''}</span>` : ''}
        ${m.location ? `<span>${ICON.pin}${esc(m.location)}</span>` : ''}</div>
      <div class="actions">${viewBtn(m, 'btn primary')}${notionBtn(m, 'btn ghost')}${m.hasPrep ? `<span class="pill-stat">Prep ${m.prep.done}/${m.prep.total}</span>` : ''}</div></div>
      ${current ? '' : `<div class="countdown" id="countdown"></div>`}`;
    if (!current) tick(m.s);
  }
  const fillBars = root => root.querySelectorAll('.fill[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
  function tick(target, el = $('#countdown')) {
    if (!el) return;
    let d = Math.max(0, target - new Date()); const days = Math.floor(d / 864e5); d -= days * 864e5;
    const h = Math.floor(d / 36e5); d -= h * 36e5; const mi = Math.floor(d / 6e4); const s = Math.floor((d - mi * 6e4) / 1000);
    const cells = days ? [[days, 'days'], [h, 'hrs'], [mi, 'min']] : [[h, 'hrs'], [mi, 'min'], [s, 'sec']];
    el.innerHTML = cells.map(([v, l]) => `<div class="cd"><b>${String(v).padStart(2, '0')}</b><small>${l}</small></div>`).join('');
  }

  function render() {
    const now = new Date(), all = meetings();
    const upcoming = all.filter(m => m.e >= now);
    const current = upcoming.find(m => m.s <= now);
    const next = upcoming.find(m => m.s > now);
    const past = all.filter(m => m.e < now).sort((a, b) => b.s - a.s).slice(0, 10);
    renderHero(next, current);

    const in48 = upcoming.filter(m => m.s - now <= 48 * 36e5);
    const withPrep = upcoming.filter(m => m.hasPrep);
    const totals = withPrep.reduce((a, m) => ({ done: a.done + m.prep.done, total: a.total + m.prep.total }), { done: 0, total: 0 });
    const ready = withPrep.filter(m => m.prep.total && m.prep.done === m.prep.total).length;
    const fuOpen = past.filter(m => m.followup.total && m.followup.done < m.followup.total).length;
    $('#stats').innerHTML = [
      ['Next 48 hours', in48.length, in48.length === 1 ? 'meeting' : 'meetings'],
      ['Prep pages', withPrep.length, `${ready} ready · ${withPrep.length - ready} to finish`],
      ['Prep progress', totals.total ? pct(totals) + '%' : '—', totals.total ? `${totals.done} of ${totals.total} checklist items` : 'No checklists yet'],
      ['Open follow-ups', fuOpen, fuOpen ? 'recent meetings with open items' : 'all caught up'],
    ].map(([k, v, s]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('');

    const inRange = RANGE === 'all' ? upcoming : upcoming.filter(m => m.s - now <= +RANGE * 36e5);
    $('#timeline').innerHTML = inRange.length ? groupByDay(inRange, (current || next)?.id)
      : emptyState(upcoming.length ? 'Nothing in this window' : 'No upcoming prep yet',
        upcoming.length ? 'Try a wider range to see later meetings.' : 'When a sales call, account review, or external meeting is on the calendar, its Notion prep page will show up here.');
    $('#past-panel').hidden = !past.length;
    if (past.length) { $('#past').innerHTML = groupByDay(past); $('#past-count').textContent = `${past.length} meeting${past.length > 1 ? 's' : ''}`; }

    const gen = new Date(DATA.generatedAt);
    $('#subtitle').textContent = `Updated ${fmt(gen, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ${tzAbbr(gen)}`;
    $('#foot').textContent = `Sources: ${(DATA.sources || []).join(' + ')} · All times Central (${tzAbbr(now)}) · Encrypted client-side, AES-256-GCM`;
    $('#example-banner').hidden = !DATA.example;
    fillBars(document);
  }

  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b)); RANGE = b.dataset.range; render();
  }));

  // ---------- inline markdown (safe subset) ----------
  function md(src) {
    const ph = []; const hold = html => `\u0000${ph.push(html) - 1}\u0000`;
    let s = String(src ?? '');
    s = s.replace(/\\([\\`*_[\]()#+\-.!|~>$])/g, (_, c) => hold(esc(c)));
    s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
    s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_, t, u) => { const url = httpUrl(u); const inner = fmtInline(esc(t || u));
      return hold(url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner); });
    s = fmtInline(esc(s));
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => ph[+i]);
  }
  function fmtInline(h) {
    return h
      .replace(/(\*{3,}|_{3,})/g, '<span class="blank-field" aria-label="blank"></span>')
      .replace(/\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<s>$1</s>');
  }
  const LABEL_RE = /^\*\*([^*]+?):\*\*\s*(.*)$/;
  const isBlank = t => !String(t || '').replace(/\*\*[^*]*\*\*/g, '').replace(/[\w /&]+:/g, '').replace(/[\s*_|—–\-.]/g, '');
  const deepBlank = b => isBlank(b.text) && (b.children || []).every(deepBlank);

  // ---------- detail view ----------
  const NEXT_ACTIONS_RE = /^(?:\W*\s*)?(?:next\s+(?:actions?|steps)|action\s+items)\b/i;
  const KINDS = [[NEXT_ACTIONS_RE, 'actions'], [/prep checklist|pre-?meeting checklist|prep list/i, 'prep'], [/follow-?up/i, 'followup'], [/live notes|during[- ]meeting|meeting notes|^notes$/i, 'notes'],
    [/question/i, 'questions'], [/agenda/i, 'agenda'], [/objective|goal/i, 'objective'], [/details|logistics/i, 'details'], [/look for|watch for|signals/i, 'signals']];
  const kindOf = t => (KINDS.find(([re]) => re.test(t || '')) || [])[1] || '';
  const KIND_ICON = { actions: ICON.arrow, prep: ICON.check, followup: ICON.flag, notes: ICON.notes, questions: ICON.help, agenda: ICON.agenda, objective: ICON.target, details: ICON.info, signals: ICON.list };
  const countTodos = blocks => blocks.reduce((a, b) => { const c = countTodos(b.children || []); return { done: a.done + c.done + (b.type === 'todo' && b.checked ? 1 : 0), total: a.total + c.total + (b.type === 'todo' ? 1 : 0) }; }, { done: 0, total: 0 });
  const progressBar = (label, c) => c.total ? `<div class="bar ${c.done === c.total ? 'done' : ''}"><div class="lbl"><span>${esc(label)}</span><span>${c.done}/${c.total} · ${pct(c)}%</span></div><div class="track"><div class="fill" data-w="${pct(c)}"></div></div></div>` : '';

  // Next-action items: pull trailing "Owner: …; timing/due: …" into tags (text is otherwise unchanged).
  function actionText(text) {
    const m = String(text || '').match(/^(.*?[.;]?)\s*\bOwner:\s*([^;]+?)\s*(?:[;,]\s*(?:timing|due|when|by):\s*(.+?))?\.?\s*$/i);
    if (!m || !m[1].trim()) return md(text);
    return `${md(m[1].trim().replace(/;$/, ''))}<span class="act-meta"><span class="act-tag">${ICON.users}<span>Owner</span>${md(m[2])}</span>${m[3] ? `<span class="act-tag">${ICON.clock}<span>Timing</span>${md(m[3])}</span>` : ''}</span>`;
  }
  function renderBlocks(blocks, kind) {
    let html = '', i = 0, k = kind;
    while (i < blocks.length) {
      const b = blocks[i];
      const group = type => { const g = []; while (i < blocks.length && blocks[i].type === type) g.push(blocks[i++]); return g; };
      if (b.type === 'heading') { k = kindOf(b.text) || kind; html += `<h3 class="d-sub">${md(b.text)}</h3>${renderBlocks(b.children || [], k)}`; i++; continue; }
      if (b.type === 'todo') {
        const g = group('todo'); const c = countTodos(g);
        html += `${k === 'prep' || k === 'followup' || k === 'actions' ? '' : `<div class="mini-progress">${progressBar('Checklist', c)}</div>`}<ul class="checklist ${k === 'actions' ? 'action-list' : ''}">${g.map(t => `<li class="${t.checked ? 'done' : ''}"><span class="cb" role="img" aria-label="${t.checked ? 'Done' : 'Not done'}">${t.checked ? ICON.check : ''}</span><span class="ct">${k === 'actions' ? actionText(t.text) : md(t.text)}${t.children?.length ? renderBlocks(t.children, k) : ''}</span></li>`).join('')}</ul>`;
        continue;
      }
      if (b.type === 'bullet') {
        const g = group('bullet');
        if (g.every(x => !x.text.trim() && !(x.children || []).length) && k !== 'notes') { html += `<div class="empty-mini">No entries yet in Notion</div>`; continue; }
        if (k === 'agenda') {
          html += `<ol class="agenda-tl">${g.map(x => { const m = x.text.match(/^((?:\d+\s*[–-]\s*)?\d+\s*(?:min|mins|minutes|m)\b\.?)\s*[:—–-]?\s*(.*)$/i);
            return `<li><span class="tl-dot"></span>${m ? `<span class="tl-time">${esc(m[1])}</span><span class="tl-text">${md(m[2])}</span>` : `<span class="tl-text">${md(x.text)}</span>`}${x.children?.length ? renderBlocks(x.children, k) : ''}</li>`; }).join('')}</ol>`;
          continue;
        }
        if (k === 'notes') {
          html += `<div class="note-fields">${g.map(x => { const m = x.text.match(LABEL_RE); const val = m ? m[2] : x.text;
            return `<div class="note-field">${m ? `<div class="nf-label">${md(m[1])}</div>` : ''}<div class="nf-value">${val.trim() ? md(val) : (x.children || []).length ? '' : '<span class="ph">—</span>'}${x.children?.length ? renderBlocks(x.children, '') : ''}</div></div>`; }).join('')}</div>`;
          continue;
        }
        html += `<ul class="d-list ${k === 'details' ? 'kv-list' : ''}">${g.map(x => { const m = x.text.match(LABEL_RE);
          const body = x.text === '' ? '<span class="ph">—</span>' : m ? `<span class="kv-k">${md(m[1])}</span><span class="kv-v">${md(m[2]) || '<span class="ph">—</span>'}</span>` : md(x.text);
          return `<li class="${m ? 'kv' : ''}">${body}${x.children?.length ? renderBlocks(x.children, k) : ''}</li>`; }).join('')}</ul>`;
        continue;
      }
      if (b.type === 'numbered') {
        const g = group('numbered');
        if (k === 'questions') {
          html += `<ol class="q-list">${g.map((x, n) => { const m = x.text.match(LABEL_RE);
            return `<li><span class="q-num">${n + 1}</span><div class="q-body">${m ? `<span class="q-tag">${md(m[1])}</span>` : ''}<div class="q-text">${md(m ? m[2] : x.text)}</div>${x.children?.length ? renderBlocks(x.children, k) : ''}</div></li>`; }).join('')}</ol>`;
        } else html += `<ol class="d-list">${g.map(x => `<li>${md(x.text)}${x.children?.length ? renderBlocks(x.children, k) : ''}</li>`).join('')}</ol>`;
        continue;
      }
      if (b.type === 'paragraph') {
        const g = []; while (i < blocks.length && blocks[i].type === 'paragraph' && LABEL_RE.test(blocks[i].text)) g.push(blocks[i++]);
        if (g.length) { html += `<dl class="kv-grid">${g.map(x => { const m = x.text.match(LABEL_RE); return `<dt>${md(m[1])}</dt><dd>${md(m[2]) || '<span class="ph">—</span>'}</dd>`; }).join('')}</dl>`; continue; }
        html += `<p class="${k === 'objective' ? 'lead' : ''}">${md(b.text)}</p>`; i++; continue;
      }
      i++;
      if (b.type === 'toggle') html += `<details class="d-toggle"><summary>${md(b.text)}</summary><div class="d-toggle-body">${renderBlocks(b.children || [], k)}</div></details>`;
      else if (b.type === 'callout') html += `<div class="d-callout">${b.icon ? `<span class="co-icon">${esc(b.icon)}</span>` : ICON.info}<div>${renderBlocks(b.children || [], k)}</div></div>`;
      else if (b.type === 'table') {
        const rows = b.rows || []; const head = b.header && rows.length ? rows[0] : null; const body = head ? rows.slice(1) : rows;
        html += `<div class="table-wrap"><table>${head ? `<thead><tr>${head.map(c => `<th>${md(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${body.map(r => `<tr>${r.map(c => `<td>${md(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
      else if (b.type === 'quote') html += `<blockquote>${md(b.text)}${renderBlocks(b.children || [], k)}</blockquote>`;
      else if (b.type === 'divider') html += '<hr>';
      else if (b.type === 'code') html += `<pre><code>${esc(b.text)}</code></pre>`;
      else if (b.type === 'link') { const u = httpUrl(b.url); html += u ? `<a class="link-block" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${ICON.doc}<span>${md(b.text)}</span><small>${esc(b.kind)}</small>${ICON.ext}</a>` : `<p>${md(b.text)}</p>`; }
      else html += `<p class="muted">[Unsupported block: ${esc(b.type)}]</p>`;
    }
    return html;
  }

  function sectionHtml(sec, idx) {
    const k = kindOf(sec.heading);
    const c = (k === 'prep' || k === 'followup' || k === 'actions') ? countTodos(sec.blocks) : null;
    const allBlank = k === 'notes' && sec.blocks.every(b => b.type === 'bullet' ? deepBlank(b) : (b.type === 'paragraph' ? isBlank(b.text) : false));
    return `<section class="d-sec kind-${k || 'generic'}" id="sec-${idx}"${k === 'actions' ? ' aria-label="Next actions"' : ''}>
      ${sec.heading ? `<header class="d-sec-head"><span class="d-ico">${KIND_ICON[k] || ICON.doc}</span><h2>${md(sec.heading)}</h2>${c && c.total ? `<span class="d-count">${c.done}/${c.total}</span>` : ''}</header>` : ''}
      ${c ? progressBar(k === 'prep' ? 'Prep progress' : k === 'actions' ? 'Actions complete' : 'Follow-up progress', c) : ''}
      ${allBlank ? `<div class="empty-mini notes-empty">${ICON.notes}<span>No live notes captured yet. The note template from Notion is below.</span></div>` : ''}
      <div class="d-body ${allBlank ? 'dim' : ''}">${renderBlocks(sec.blocks, k) || '<div class="empty-mini">This section is empty in Notion</div>'}</div>
    </section>`;
  }

  function attendeeChip(p) {
    const m = p.match(/^(.*?)\s*\(([^)]+)\)\s*$/); const name = m ? m[1] : p;
    return `<span class="chip lg"><i>${esc(initials(name))}</i><span class="chip-name">${esc(name)}</span>${m ? `<span class="co">${esc(m[2])}</span>` : ''}</span>`;
  }

  function renderDetail(rid) {
    const view = $('#view-detail');
    const m = meetings().find(x => x.rid === rid);
    if (!m) { view.innerHTML = `<nav class="crumbs"><a href="#/">${ICON.back}All meetings</a></nav><div class="panel">${emptyState('Meeting not found', 'This link may be from an older refresh. Go back to the dashboard to see current meetings.')}</div>`; return; }
    const now = new Date(); const [sc, st] = status(m);
    const live = m.s <= now && m.e >= now, ended = m.e < now;
    const dur = Math.round((m.e - m.s) / 6e4);
    const secs = (m.page?.sections || []).map((s, i) => ({ s, i, k: kindOf(s.heading) }));
    const sideSecs = secs.filter(x => x.k === 'prep' || x.k === 'followup');
    const mainSecs = secs.filter(x => !(x.k === 'prep' || x.k === 'followup'));
    const actSec = secs.find(x => x.k === 'actions');
    const edited = m.notionEditedAt ? new Date(m.notionEditedAt) : null;
    view.innerHTML = `
      <nav class="crumbs no-print"><a href="#/">${ICON.back}All meetings</a></nav>
      <header class="d-hero hero ${!live && !ended && startingSoon(m) ? 'urgent' : ''}">
        <div>
          <div class="eyebrow">${live ? '<span class="live">In progress</span>' : ended ? 'Past meeting' : 'Meeting prep'}${m.account ? ` <span class="acct on-hero">${esc(m.account)}</span>` : ''}</div>
          <h1>${m.page?.icon ? `<span class="d-emoji">${esc(m.page.icon)}</span>` : ''}${esc(m.title)}</h1>
          <div class="meta">
            <span>${ICON.clock}${esc(fmt(m.s, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))} · ${esc(timeStr(m.s))}–${esc(timeStr(m.e))} ${esc(tzAbbr(m.s))} <span class="tz-label">Central</span></span>
            <span>${ICON.agenda}${dur} min</span>
            ${m.location ? `<span>${ICON.pin}${esc(m.location)}</span>` : ''}
          </div>
          ${(m.attendees || []).length ? `<div class="people d-people">${m.attendees.map(attendeeChip).join('')}</div>` : ''}
          <div class="actions no-print">${notionBtn(m, 'btn ghost')}<button class="btn ghost" type="button" data-action="print">${ICON.print}Print</button></div>
        </div>
        <div class="d-hero-side">
          <span class="status ${sc}">${esc(st)}</span>
          ${!live && !ended ? '<div class="countdown" id="d-countdown"></div>' : ''}
        </div>
      </header>
      ${m.page ? `<div class="d-grid">
        <div class="d-main">${mainSecs.map(x => sectionHtml(x.s, x.i)).join('')}</div>
        <aside class="d-side">
          <section class="d-sec glance"><header class="d-sec-head"><span class="d-ico">${ICON.info}</span><h2>At a glance</h2></header>
            ${progressBar('Prep checklist', m.prep)}${progressBar('Next actions', m.nextActions || {})}${progressBar('Follow-up checklist', m.followup)}
            ${actSec ? `<a class="btn sm jump-actions no-print" href="#sec-${actSec.i}" data-jump="sec-${actSec.i}">${ICON.arrow}Jump to Next Actions</a>` : ''}
            <dl class="kv-grid compact">
              <dt>When</dt><dd>${esc(dayLabel(m.s))}, ${esc(timeStr(m.s))} ${esc(tzAbbr(m.s))}</dd>
              <dt>Attendees</dt><dd>${(m.attendees || []).length}</dd>
              <dt>Source</dt><dd>${esc(m.source || '')}</dd>
              ${edited ? `<dt>Notion edited</dt><dd>${esc(fmt(edited, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} ${esc(tzAbbr(edited))}</dd>` : ''}
            </dl>
            <p class="fine-print">Read-only mirror of the Notion page. Edit in Notion; changes appear after the next refresh.</p>
          </section>
          ${sideSecs.map(x => sectionHtml(x.s, x.i)).join('')}
        </aside>
      </div>` : `<div class="panel">${emptyState('No Notion prep page yet', 'This meeting came from the calendar and has no prep page. Ask for prep and it will appear here after the next refresh.')}</div>`}`;
    fillBars(view);
    if (!live && !ended) tick(m.s, $('#d-countdown'));
  }

  // ---------- router ----------
  let VIEW = 'list';
  function route() {
    if (!DATA) return;
    const m = location.hash.match(/^#\/meeting\/([A-Za-z0-9_-]+)/);
    const prev = VIEW;
    if (m) { VIEW = m[1]; $('#view-list').hidden = true; $('#view-detail').hidden = false; renderDetail(m[1]); }
    else { VIEW = 'list'; $('#view-detail').hidden = true; $('#view-detail').innerHTML = ''; $('#view-list').hidden = false; render(); }
    if (prev !== VIEW) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('click', e => { const p = e.target.closest('[data-action="print"]'); if (p) window.print();
    const j = e.target.closest('[data-jump]'); if (j) { e.preventDefault(); document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  window.addEventListener('beforeprint', () => document.querySelectorAll('#view-detail details').forEach(d => { d.open = true; }));

  // ---------- lock / unlock ----------
  const SS = 'mpd-pass';
  async function unlock(pass, remember) {
    const blob = await fetchBlob();
    DATA = await decrypt(blob, pass);
    if (remember) sessionStorage.setItem(SS, pass);
    $('#lock').hidden = true; $('#app').hidden = false; $('#pass').value = '';
    render(); route();
    clearInterval(timer);
    timer = setInterval(() => {
      if (new Date().getSeconds() === 0 && VIEW === 'list') return render();
      const nx = meetings().find(m => m.s > new Date());
      if (nx && $('#countdown') && VIEW === 'list') tick(nx.s);
      if (VIEW !== 'list') { const dm = meetings().find(m => m.rid === VIEW); if (dm && $('#d-countdown')) tick(dm.s, $('#d-countdown')); }
    }, 1000);
  }
  function lock() {
    DATA = null; clearInterval(timer); sessionStorage.removeItem(SS);
    ['#hero', '#stats', '#timeline', '#past', '#view-detail'].forEach(s => $(s).innerHTML = ''); VIEW = 'list';
    $('#app').hidden = true; $('#lock').hidden = false; $('#pass').focus();
  }
  $('#unlock-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#unlock-btn'), err = $('#lock-error');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Unlocking…';
    try { await unlock($('#pass').value, $('#remember').checked); }
    catch (x) { err.textContent = x.name === 'OperationError' ? 'Incorrect passphrase. Try again.' : (x.message || 'Unable to unlock.'); err.hidden = false; }
    finally { btn.disabled = false; btn.textContent = 'Unlock'; }
  });
  $('#lock-btn').addEventListener('click', lock);
  const saved = sessionStorage.getItem(SS);
  if (saved) unlock(saved, true).catch(() => sessionStorage.removeItem(SS));
})();
