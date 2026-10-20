'use strict';
(() => {
  const TZ = 'America/Chicago';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (typeof u === 'string' && /^https:\/\/([a-z0-9-]+\.)*notion\.(so|com)\//i.test(u)) ? u : null;
  const ICON = {
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  };

  // ---------- theme ----------
  const applyTheme = t => { document.documentElement.dataset.theme = t; $('#theme-btn').innerHTML = t === 'dark' ? ICON.sun : ICON.moon; };
  applyTheme(localStorage.getItem('mpd-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#theme-btn').addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('mpd-theme', t); applyTheme(t); });

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
  function status(m) {
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
  function notionBtn(m, cls = 'btn sm') {
    const u = safeUrl(m.notionUrl);
    return u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${ICON.ext}Open prep in Notion</a>` : '';
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
        <div class="bars">${bar('Prep checklist', m.prep)}${ended ? bar('Follow-up', m.followup) : ''}</div>
        ${hasMore ? `<details class="more"><summary>Questions &amp; agenda</summary><div class="more-grid">
          ${(m.questions || []).length ? `<div><h4>Priority questions</h4><ol>${m.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol></div>` : ''}
          ${(m.agenda || []).length ? `<div><h4>Agenda</h4><ul>${m.agenda.map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
        </div></details>` : ''}
      </div>
      <div class="side"><span class="status ${sc}">${esc(st)}</span>${notionBtn(m)}</div>
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
    hero.className = 'hero';
    hero.innerHTML = `<div><div class="eyebrow">${current ? '<span class="live">In progress</span>' : 'Next meeting'}</div>
      <h2>${esc(m.title)}</h2>
      <div class="meta"><span>${ICON.clock}${esc(dayLabel(m.s))}, ${esc(fmt(m.s, { month: 'short', day: 'numeric' }))} · ${esc(timeStr(m.s))}–${esc(timeStr(m.e))} ${esc(tzAbbr(m.s))}</span>
        ${(m.attendees || []).length ? `<span>${ICON.users}${esc(m.attendees.length)} attendee${m.attendees.length > 1 ? 's' : ''}</span>` : ''}
        ${m.location ? `<span>${ICON.pin}${esc(m.location)}</span>` : ''}</div>
      <div class="actions">${notionBtn(m, 'btn')}${m.hasPrep ? `<span class="btn ghost" aria-disabled="false">Prep ${m.prep.done}/${m.prep.total}</span>` : ''}</div></div>
      ${current ? '' : `<div class="countdown" id="countdown"></div>`}`;
    if (!current) tick(m.s);
  }
  function tick(target) {
    const el = $('#countdown'); if (!el) return;
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
    $('#foot').innerHTML = `<span>Sources: ${esc((DATA.sources || []).join(' + '))} · All times Central (${esc(tzAbbr(now))})</span><span>Encrypted client-side · AES-256-GCM</span>`;
    $('#example-banner').hidden = !DATA.example;
    document.querySelectorAll('.fill[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
  }

  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b)); RANGE = b.dataset.range; render();
  }));

  // ---------- lock / unlock ----------
  const SS = 'mpd-pass';
  async function unlock(pass, remember) {
    const blob = await fetchBlob();
    DATA = await decrypt(blob, pass);
    if (remember) sessionStorage.setItem(SS, pass);
    $('#lock').hidden = true; $('#app').hidden = false; $('#pass').value = '';
    render();
    clearInterval(timer);
    timer = setInterval(() => {
      if (new Date().getSeconds() === 0) return render();
      const nx = meetings().find(m => m.s > new Date());
      if (nx && $('#countdown')) tick(nx.s);
    }, 1000);
  }
  function lock() {
    DATA = null; clearInterval(timer); sessionStorage.removeItem(SS);
    ['#hero', '#stats', '#timeline', '#past'].forEach(s => $(s).innerHTML = '');
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
