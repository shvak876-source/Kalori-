'use strict';

/* =========================================================
   קלורי — מעקב קלוריות וחלבון
   כל הנתונים נשמרים מקומית בטלפון (localStorage).
   ========================================================= */

const KEY = 'kalori.v1';

const ACTIVITY = [
  { v: 1.2,   l: 'יושבני · כמעט בלי פעילות' },
  { v: 1.375, l: 'פעילות קלה · 1–3 אימונים בשבוע' },
  { v: 1.55,  l: 'פעילות בינונית · 3–5 אימונים בשבוע' },
  { v: 1.725, l: 'פעילות גבוהה · 6–7 אימונים בשבוע' },
  { v: 1.9,   l: 'גבוהה מאוד · עבודה פיזית + אימונים' },
];
const GOALS = [
  { v: 'lose',     l: 'ירידה במשקל' },
  { v: 'maintain', l: 'שמירה על המשקל' },
  { v: 'gain',     l: 'עלייה במסה' },
];
const DEFICITS = [200, 300, 400, 500];
const SURPLUS = 300;

/* ---------- state ---------- */
let S = load();
let tab = 'today';
let day = todayKey();
let lastAdded = null;  // for undo
let historyOpen = null;

function blank() {
  return { profile: null, override: null, products: [], log: {} };
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && typeof d === 'object') return Object.assign(blank(), d);
  } catch (e) { /* ignore */ }
  return blank();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('האחסון בטלפון מלא — נסו להסיר תמונות ממוצרים'); }
}

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('he-IL');
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString('he-IL');
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function keyToDate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function shiftDay(k, n) { const d = keyToDate(k); d.setDate(d.getDate() + n); return todayKey(d); }
function dayLabel(k) {
  const t = todayKey();
  if (k === t) return 'היום';
  if (k === shiftDay(t, -1)) return 'אתמול';
  return keyToDate(k).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
}
function longDate(k) {
  return keyToDate(k).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

const I = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  pulse: '<svg viewBox="0 0 24 24"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"/></svg>',
};

/* ---------- nutrition math ---------- */
function calc(p) {
  if (!p) return null;
  const bmr = Math.round(10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'f' ? -161 : 5));
  const tdee = Math.round(bmr * p.activity);
  let kcal = tdee;
  if (p.goal === 'lose') kcal = tdee - p.deficit;
  if (p.goal === 'gain') kcal = tdee + SURPLUS;
  kcal = Math.round(kcal / 5) * 5;
  const protein = Math.round(p.weight * (p.goal === 'gain' ? 1.8 : 1.6));
  return { bmr, tdee, kcal, protein };
}
function goals() {
  const c = calc(S.profile) || { kcal: 2000, protein: 100 };
  const o = S.override || {};
  return { kcal: o.kcal || c.kcal, protein: o.protein || c.protein };
}

/* entry / product values */
const isGram = x => x.mode === 'g';
function factor(x, qty) { return isGram(x) ? qty / 100 : qty; }
function entryKcal(e) { return e.kcal * factor(e, e.qty); }
function entryProt(e) { return (e.protein || 0) * factor(e, e.qty); }
function qtyLabel(x, qty) {
  if (isGram(x)) return `${fmt(qty)} ג׳`;
  return qty === 1 ? 'יחידה' : `${fmt1(qty)} יח׳`;
}
function perLabel(p) {
  const prot = p.protein ? ` · ${fmt1(p.protein)} ג׳ חלבון` : '';
  return isGram(p) ? `${fmt(p.kcal)} קק״ל ל־100 ג׳${prot}` : `${fmt(p.kcal)} קק״ל ליחידה${prot}`;
}
function dayEntries(k) { return S.log[k] || (S.log[k] = []); }
function dayTotals(k) {
  const es = S.log[k] || [];
  return es.reduce((a, e) => ({ kcal: a.kcal + entryKcal(e), protein: a.protein + entryProt(e) }), { kcal: 0, protein: 0 });
}
function initial(name) { return esc((name || '?').trim().charAt(0) || '?'); }
function photoStyle(url) { return url ? ` style="background-image:url('${url}')"` : ''; }
function productById(id) { return S.products.find(p => p.id === id); }

/* products sorted by how often & how recently they were used */
function rankedProducts() {
  const now = Date.now();
  return [...S.products].sort((a, b) => score(b) - score(a));
  function score(p) {
    const days = p.lastUsed ? (now - p.lastUsed) / 864e5 : 999;
    return (p.uses || 0) / (1 + days / 7);
  }
}

/* ---------- actions ---------- */
function addProduct(p, qty = p.defaultQty || (isGram(p) ? 100 : 1), k = day) {
  p.uses = (p.uses || 0) + 1;
  p.lastUsed = Date.now();
  // same product already logged that day → just bump the amount
  const same = dayEntries(k).find(e => e.pid === p.id && e.kcal === p.kcal && e.mode === p.mode && (e.protein || 0) === (p.protein || 0));
  if (same) {
    lastAdded = { k, id: same.id, pid: p.id, prevQty: same.qty };
    same.qty = Math.round((same.qty + qty) * 100) / 100;
    save();
    toast(`${p.name} · עכשיו ${qtyLabel(same, same.qty)}`, true);
    return same;
  }
  const e = { id: uid(), pid: p.id, name: p.name, mode: p.mode, kcal: p.kcal, protein: p.protein || 0, qty, t: Date.now() };
  dayEntries(k).push(e);
  save();
  lastAdded = { k, id: e.id, pid: p.id };
  toast(`נוסף: ${p.name} · ${fmt(entryKcal(e))} קק״ל`, true);
  return e;
}
function addOneOff({ name, kcal, protein }, k = day) {
  const e = { id: uid(), pid: null, name: name || 'אוכל', mode: 'u', kcal, protein: protein || 0, qty: 1, t: Date.now() };
  dayEntries(k).push(e);
  save();
  lastAdded = { k, id: e.id, pid: null };
  toast(`נוסף: ${e.name} · ${fmt(kcal)} קק״ל`, true);
}
function undo() {
  if (!lastAdded) return;
  const { k, id, pid, prevQty } = lastAdded;
  const ex = (S.log[k] || []).find(e => e.id === id);
  if (ex && prevQty != null) ex.qty = prevQty;
  else S.log[k] = (S.log[k] || []).filter(e => e.id !== id);
  const p = pid && productById(pid);
  if (p) p.uses = Math.max(0, (p.uses || 1) - 1);
  const sk = pid || '_once';
  if (addedInSheet[sk]) addedInSheet[sk]--;
  lastAdded = null;
  save();
  hideToast();
  render();
  if (openSheet) openSheet.refresh?.();
}
function stepSize(e, dir) {
  if (isGram(e)) return (dir < 0 ? e.qty <= 50 : e.qty < 50) ? 10 : 25;
  return (dir < 0 ? e.qty <= 1 : e.qty < 1) ? 0.5 : 1;
}
function removeEntry(id) {
  S.log[day] = dayEntries(day).filter(e => e.id !== id);
  save(); render();
}
function stepEntry(id, dir) {
  const e = dayEntries(day).find(x => x.id === id);
  if (!e) return;
  const next = e.qty + dir * stepSize(e, dir);
  if (next <= 0.01) return removeEntry(id);
  e.qty = Math.round(next * 100) / 100;
  save(); render();
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, withUndo = false) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${withUndo ? '<button data-act="undo">ביטול</button>' : ''}`;
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3200);
}
function hideToast() { $('#toast').hidden = true; }

/* =========================================================
   VIEWS
   ========================================================= */
function render() {
  document.body.classList.toggle('no-tabs', !S.profile);
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = $('#view');
  if (!S.profile) { v.innerHTML = viewOnboarding(); bindProfileForm(v, true); return; }
  if (tab === 'today') v.innerHTML = viewToday();
  if (tab === 'products') { v.innerHTML = viewProducts(); bindProductSearch(); }
  if (tab === 'history') v.innerHTML = viewHistory();
  if (tab === 'settings') { v.innerHTML = viewSettings(); bindProfileForm(v, false); }
}

/* ---------- TODAY ---------- */
function viewToday() {
  const g = goals();
  const t = dayTotals(day);
  const left = g.kcal - t.kcal;
  const pct = Math.min(1, t.kcal / g.kcal);
  const C = 2 * Math.PI * 54;
  const over = left < 0;
  const protPct = Math.min(100, (t.protein / g.protein) * 100);
  const es = [...dayEntries(day)].sort((a, b) => a.t - b.t);
  const quick = rankedProducts().slice(0, 10);
  const isToday = day === todayKey();

  return `
  <header class="top">
    <div>
      <h1>קלורי</h1>
      <div class="sub">${esc(longDate(day))}</div>
    </div>
    <div class="daynav">
      <button data-act="day" data-n="-1" aria-label="יום קודם">${I.right}</button>
      <span>${esc(dayLabel(day))}</span>
      <button data-act="day" data-n="1" aria-label="יום הבא" ${isToday ? 'disabled' : ''}>${I.left}</button>
    </div>
  </header>

  <section class="card">
    <div class="summary">
      <div class="ring ${over ? 'over' : ''}">
        <svg viewBox="0 0 132 132"><circle class="track" cx="66" cy="66" r="54"/>
          <circle class="bar" cx="66" cy="66" r="54" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
        <div class="center">
          <div class="big">${fmt(Math.abs(left))}</div>
          <div class="lbl">${over ? 'מעל היעד' : 'נשארו'}</div>
        </div>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="row"><span>קלוריות</span><span><b>${fmt(t.kcal)}</b> / ${fmt(g.kcal)}</span></div>
          <div class="pbar"><i style="width:${pct * 100}%;${over ? 'background:var(--orange)' : ''}"></i></div>
        </div>
        <div class="stat">
          <div class="row"><span>חלבון</span><span><b>${fmt(t.protein)}</b> / ${fmt(g.protein)} ג׳</span></div>
          <div class="pbar green"><i style="width:${protPct}%"></i></div>
        </div>
      </div>
    </div>
  </section>

  <section class="card">
    <div class="card-h"><h2>הוספה בלחיצה</h2><span class="meta">${S.products.length ? 'הנפוצים שלך' : ''}</span></div>
    ${quick.length ? `
    <div class="quick">
      ${quick.map(p => `
        <button class="qchip" data-act="quick" data-id="${p.id}">
          <div class="ph"${photoStyle(p.photo)}>${p.photo ? '' : initial(p.name)}</div>
          <span class="plus">${I.plus}</span>
          <div class="nm">${esc(p.name)}</div>
          <div class="kc">${fmt(p.kcal * factor(p, p.defaultQty || (isGram(p) ? 100 : 1)))} קק״ל</div>
        </button>`).join('')}
      <button class="qchip more" data-act="open-add">
        <div class="ph">${I.more}</div>
        <div class="nm">עוד…</div>
      </button>
    </div>` : `
    <div class="empty" style="padding:6px 0 4px">
      כאן יופיעו המוצרים שאתם אוכלים הכי הרבה — לחיצה אחת והם ביומן.
      <div style="margin-top:12px"><button class="btn soft" data-act="new-product">${I.plus} מוצר ראשון</button></div>
    </div>`}
  </section>

  <section class="card">
    <div class="card-h"><h2>${isToday ? 'מה אכלתי היום' : 'מה אכלתי'}</h2><span class="meta">${es.length ? `${es.length} פריטים` : ''}</span></div>
    ${es.length ? es.map(entryRow).join('') : `
      <div class="empty">היומן ריק.<br>לחצו על <b>+</b> למטה או על מוצר למעלה.</div>`}
  </section>`;
}

function entryRow(e) {
  const p = e.pid && productById(e.pid);
  const photo = p && p.photo;
  return `
  <div class="entry">
    <div class="thumb"${photoStyle(photo)}>${photo ? '' : initial(e.name)}</div>
    <div class="info">
      <div class="nm">${esc(e.name)}</div>
      <div class="sm">${fmt(entryKcal(e))} קק״ל${e.protein ? ` · ${fmt1(entryProt(e))} ג׳ חלבון` : ''}</div>
    </div>
    <div class="stepper">
      <button data-act="step" data-id="${e.id}" data-n="1" aria-label="עוד">${I.plus}</button>
      <button class="q" data-act="qty" data-id="${e.id}">${esc(isGram(e) ? fmt(e.qty) + 'ג׳' : fmt1(e.qty))}</button>
      <button data-act="step" data-id="${e.id}" data-n="-1" aria-label="פחות">${e.qty - stepSize(e, -1) <= 0.01 ? I.x : I.minus}</button>
    </div>
  </div>`;
}

/* ---------- PRODUCTS ---------- */
let productQuery = '';
function viewProducts() {
  return `
  <header class="top">
    <div><h1>המוצרים שלי</h1><div class="sub">${S.products.length} מוצרים שמורים</div></div>
    <button class="btn small" data-act="new-product">${I.plus} חדש</button>
  </header>
  <div class="search">${I.search}<input class="input" id="psearch" type="search" placeholder="חיפוש מוצר…" value="${esc(productQuery)}" autocomplete="off"></div>
  <div class="pgrid" id="pgrid">${productCards()}</div>`;
}
function productCards() {
  const q = productQuery.trim();
  const list = S.products.filter(p => !q || p.name.includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  if (!S.products.length) return `<div class="empty" style="grid-column:1/-1">עדיין אין מוצרים.<br>הוסיפו את מה שאתם אוכלים הרבה — עם תמונה זה הכי מהיר.</div>`;
  if (!list.length) return `<div class="empty" style="grid-column:1/-1">לא נמצא מוצר בשם הזה</div>`;
  return list.map(p => `
    <div class="pcard" data-act="edit-product" data-id="${p.id}" role="button">
      <div class="ph"${photoStyle(p.photo)}>${p.photo ? '' : initial(p.name)}</div>
      <button class="quickadd" data-act="quick" data-id="${p.id}" aria-label="הוסף להיום">${I.plus}</button>
      <div class="nm">${esc(p.name)}</div>
      <div class="sm">${esc(perLabel(p))}</div>
    </div>`).join('');
}
function bindProductSearch() {
  const i = $('#psearch');
  i.addEventListener('input', () => { productQuery = i.value; $('#pgrid').innerHTML = productCards(); });
}

/* ---------- HISTORY ---------- */
function viewHistory() {
  const g = goals();
  const keys = Object.keys(S.log).filter(k => (S.log[k] || []).length).sort().reverse();
  const last7 = [];
  for (let i = 1; i <= 7; i++) { const k = shiftDay(todayKey(), -i); if ((S.log[k] || []).length) last7.push(dayTotals(k)); }
  const avg = last7.length ? last7.reduce((a, t) => ({ kcal: a.kcal + t.kcal, protein: a.protein + t.protein }), { kcal: 0, protein: 0 }) : null;

  return `
  <header class="top"><div><h1>היסטוריה</h1><div class="sub">לחצו על יום כדי לראות ולהוסיף שוב</div></div></header>
  ${avg ? `
  <section class="card">
    <div class="card-h"><h2>ממוצע 7 ימים אחרונים</h2><span class="meta">${last7.length} ימים מתועדים</span></div>
    <div class="result" style="margin:0"><div class="twin">
      <div><div class="v">${fmt(avg.kcal / last7.length)}</div><div class="l">קק״ל ליום · יעד ${fmt(g.kcal)}</div></div>
      <div><div class="v">${fmt(avg.protein / last7.length)}</div><div class="l">ג׳ חלבון ליום · יעד ${fmt(g.protein)}</div></div>
    </div></div>
  </section>` : ''}
  ${keys.length ? keys.slice(0, 90).map(k => historyDay(k, g)).join('') : `<div class="card empty">עוד אין היסטוריה. ברגע שתוסיפו אוכל — הימים יופיעו כאן.</div>`}`;
}
function historyDay(k, g) {
  const t = dayTotals(k);
  const ok = t.kcal <= g.kcal;
  const open = historyOpen === k;
  const isToday = k === todayKey();
  return `
  <section class="card">
    <button class="hday" data-act="hist-toggle" data-k="${k}">
      <div class="row">
        <div><div class="d">${esc(dayLabel(k) === 'היום' || dayLabel(k) === 'אתמול' ? dayLabel(k) + ' · ' + longDate(k) : longDate(k))}</div>
          <div class="sm">${fmt(t.protein)} ג׳ חלבון · ${S.log[k].length} פריטים</div></div>
        <div class="k ${ok ? 'ok' : 'over'}">${fmt(t.kcal)} <span class="sm">/ ${fmt(g.kcal)}</span></div>
      </div>
      <div class="pbar"><i style="width:${Math.min(100, t.kcal / g.kcal * 100)}%;background:${ok ? 'var(--green)' : 'var(--orange)'}"></i></div>
    </button>
    ${open ? `
    <div class="hentries">
      ${S.log[k].map(e => `
        <div class="prow">
          <div class="info"><div class="nm">${esc(e.name)}</div>
            <div class="sm">${esc(qtyLabel(e, e.qty))} · ${fmt(entryKcal(e))} קק״ל${e.protein ? ` · ${fmt1(entryProt(e))} ג׳ חלבון` : ''}</div></div>
          ${isToday ? '' : `<button class="addbtn" data-act="readd" data-k="${k}" data-id="${e.id}" aria-label="הוסף להיום">${I.plus}</button>`}
        </div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:10px">
        ${isToday ? '' : `<button class="btn soft small" style="flex:1" data-act="copy-day" data-k="${k}">${I.redo} העתק את כל היום להיום</button>`}
        <button class="btn ghost small" style="flex:1" data-act="goto-day" data-k="${k}">עריכה</button>
      </div>
    </div>` : ''}
  </section>`;
}

/* ---------- SETTINGS / ONBOARDING ---------- */
function defaultProfile() {
  return { sex: 'm', age: 25, weight: 75, height: 172, activity: 1.375, goal: 'lose', deficit: 400 };
}
function profileForm(p) {
  return `
  <div class="seg" data-field="sex">
    <button type="button" data-v="m" class="${p.sex !== 'f' ? 'on' : ''}">זכר</button>
    <button type="button" data-v="f" class="${p.sex === 'f' ? 'on' : ''}">נקבה</button>
  </div>
  <div class="grid2">
    <label class="field"><span>גיל</span><input class="input" name="age" inputmode="numeric" value="${p.age}"></label>
    <label class="field"><span>גובה (ס״מ)</span><input class="input" name="height" inputmode="numeric" value="${p.height}"></label>
  </div>
  <label class="field"><span>משקל (ק״ג)</span><input class="input" name="weight" inputmode="decimal" value="${p.weight}"></label>
  <label class="field"><span>רמת פעילות</span>
    <select class="input" name="activity">${ACTIVITY.map(a => `<option value="${a.v}" ${a.v === p.activity ? 'selected' : ''}>${a.l}</option>`).join('')}</select></label>
  <div class="field"><span>המטרה שלי</span>
    <div class="seg" data-field="goal" style="margin:0">${GOALS.map(g => `<button type="button" data-v="${g.v}" class="${p.goal === g.v ? 'on' : ''}">${g.l.split(' ')[0]}</button>`).join('')}</div></div>
  <div class="field" id="deficit-field" ${p.goal === 'lose' ? '' : 'hidden'}><span>קצב ירידה (גירעון יומי בקק״ל)</span>
    <div class="chips" data-field="deficit" style="margin:0">${DEFICITS.map(d => `<button type="button" data-v="${d}" class="${p.deficit === d ? 'on' : ''}">${d}</button>`).join('')}</div>
    <input class="input" name="deficit" inputmode="numeric" value="${p.deficit}" style="margin-top:8px" aria-label="גירעון יומי">
    <div class="note">200–300 עדין, 400–500 מהיר יותר. ~500 ביום ≈ חצי ק״ג בשבוע.</div></div>
  <div id="result"></div>`;
}
function resultBox(p) {
  const c = calc(p);
  const minK = p.sex === 'f' ? 1200 : 1500;
  return `
  <div class="result">
    <div class="twin">
      <div><div class="v">${fmt(c.kcal)}</div><div class="l">קק״ל ביום</div></div>
      <div><div class="v">${c.protein}</div><div class="l">ג׳ חלבון ביום</div></div>
    </div>
    <div class="tiny">BMR ${fmt(c.bmr)} · שריפה יומית משוערת ${fmt(c.tdee)}</div>
  </div>
  ${c.kcal < minK ? `<div class="warn">היעד נמוך מ־${fmt(minK)} קק״ל. כדאי לבחור גירעון קטן יותר או להתייעץ עם איש מקצוע.</div>` : ''}`;
}

function viewOnboarding() {
  return `
  <div class="hero">
    <div class="logo">${I.pulse}</div>
    <h1>ברוכים הבאים לקלורי</h1>
    <p>כמה פרטים, ונחשב לכם יעד קלוריות וחלבון</p>
  </div>
  <section class="card" id="pform">${profileForm(S._draft || defaultProfile())}</section>
  <button class="btn" data-act="finish-onboarding">יאללה, מתחילים</button>
  <p class="note" style="text-align:center;margin-top:12px">אפשר לשנות הכל אחר כך בלשונית "יעדים"</p>`;
}

function viewSettings() {
  const c = calc(S.profile);
  const o = S.override || {};
  return `
  <header class="top"><div><h1>היעדים שלי</h1><div class="sub">כל שינוי נשמר אוטומטית</div></div></header>
  <section class="card" id="pform">
    <div class="card-h"><h2>הפרטים שלי</h2></div>
    ${profileForm(S.profile)}
  </section>

  <section class="card">
    <div class="card-h"><h2>יעד ידני</h2><span class="meta">לא חובה</span></div>
    <p class="note" style="margin:0 0 12px">אם דיאטנית נתנה לכם מספרים — כתבו אותם כאן והם יגברו על החישוב.</p>
    <div class="grid2">
      <label class="field"><span>קלוריות</span><input class="input" id="ov-kcal" inputmode="numeric" placeholder="${c.kcal}" value="${o.kcal || ''}"></label>
      <label class="field"><span>חלבון (ג׳)</span><input class="input" id="ov-prot" inputmode="numeric" placeholder="${c.protein}" value="${o.protein || ''}"></label>
    </div>
  </section>

  <section class="card">
    <div class="card-h"><h2>גיבוי</h2></div>
    <p class="note" style="margin:0 0 12px">הנתונים שמורים רק בטלפון הזה. כדאי לשמור גיבוי מדי פעם.</p>
    <div class="grid2">
      <button class="btn ghost" data-act="export">שמירת גיבוי</button>
      <label class="btn ghost" style="position:relative">טעינת גיבוי<input type="file" id="import" accept="application/json,.json" style="position:absolute;inset:0;opacity:0"></label>
    </div>
    <button class="btn danger" data-act="reset" style="margin-top:8px">מחיקת כל הנתונים</button>
  </section>`;
}

function bindProfileForm(root, onboarding) {
  const form = $('#pform', root);
  let p = { ...(onboarding ? (S._draft || defaultProfile()) : S.profile) };
  const update = () => {
    $('#result', form).innerHTML = resultBox(p);
    $('#deficit-field', form).hidden = p.goal !== 'lose';
    if (onboarding) S._draft = p;
    else { S.profile = p; save(); }
  };
  form.addEventListener('click', ev => {
    const b = ev.target.closest('[data-field] button');
    if (!b) return;
    const f = b.parentElement.dataset.field;
    p[f] = f === 'deficit' ? Number(b.dataset.v) : b.dataset.v;
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (f === 'deficit') form.querySelector('[name=deficit]').value = p.deficit;
    update();
  });
  form.addEventListener('input', ev => {
    const el = ev.target;
    if (!el.name) return;
    const v = num(el.value);
    if (el.name === 'activity') p.activity = v;
    else if (v > 0) p[el.name] = v;
    if (el.name === 'deficit') form.querySelectorAll('[data-field=deficit] button').forEach(x => x.classList.toggle('on', Number(x.dataset.v) === p.deficit));
    update();
  });
  form.addEventListener('change', ev => { if (ev.target.name === 'activity') { p.activity = num(ev.target.value); update(); } });
  update();

  if (!onboarding) {
    const ok = $('#ov-kcal'), op = $('#ov-prot');
    const ov = () => {
      const k = Math.round(num(ok.value)), pr = Math.round(num(op.value));
      S.override = (k || pr) ? { kcal: k || 0, protein: pr || 0 } : null;
      save();
    };
    ok.addEventListener('input', ov); op.addEventListener('input', ov);
    $('#import').addEventListener('change', importBackup);
  }
}

/* =========================================================
   SHEETS
   ========================================================= */
let openSheet = null;
function sheet({ title, body, footer, onMount, refresh }) {
  closeSheet(true);
  const root = $('#sheet-root');
  root.innerHTML = `
    <div class="backdrop" data-act="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="grab"></div>
      <div class="sh"><h3>${title}</h3><button class="x" data-act="close-sheet" aria-label="סגירה">${I.x}</button></div>
      <div class="sb">${body}</div>
      ${footer ? `<div class="sf">${footer}</div>` : ''}
    </div>`;
  document.body.classList.add('sheet-open');
  const el = $('.sheet', root);
  openSheet = { el, refresh };
  requestAnimationFrame(() => { $('.backdrop', root).classList.add('show'); el.classList.add('show'); });
  onMount && onMount(el);
  enableSwipeDown(el);
  return el;
}
function closeSheet(instant) {
  const root = $('#sheet-root');
  if (!openSheet) return;
  openSheet = null;
  document.body.classList.remove('sheet-open');
  if (document.activeElement) document.activeElement.blur();
  if (instant) { root.innerHTML = ''; return; }
  $('.sheet', root)?.classList.remove('show');
  $('.backdrop', root)?.classList.remove('show');
  setTimeout(() => { if (!openSheet) root.innerHTML = ''; }, 260);
  render();
}
function enableSwipeDown(el) {
  const grab = $('.grab', el), head = $('.sh', el);
  let y0 = null, dy = 0;
  const start = e => { y0 = e.touches[0].clientY; dy = 0; el.style.transition = 'none'; };
  const move = e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); el.style.transform = `translateY(${dy}px)`; };
  const end = () => { if (y0 == null) return; el.style.transition = ''; el.style.transform = ''; y0 = null; if (dy > 90) closeSheet(); };
  [grab, head].forEach(h => { h.addEventListener('touchstart', start, { passive: true }); h.addEventListener('touchmove', move, { passive: true }); h.addEventListener('touchend', end); });
}

/* ---------- ADD FOOD sheet: the main flow ---------- */
let addMode = 'mine';
let addedInSheet = {};
function openAdd(mode) {
  addMode = mode || (S.products.length ? 'mine' : 'once');
  addedInSheet = {};
  sheet({
    title: day === todayKey() ? 'מה אכלת?' : `הוספה ל${dayLabel(day)}`,
    body: `
      <div class="seg" id="addseg">
        <button data-mode="mine">מהמוצרים שלי</button>
        <button data-mode="once">חד־פעמי</button>
      </div>
      <div id="addbody"></div>`,
    footer: `<button class="btn" data-act="close-sheet" id="donebtn">סיום</button>`,
    onMount: el => {
      $('#addseg', el).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { addMode = b.dataset.mode; drawAdd(); } });
      drawAdd();
    },
    refresh: () => drawAdd(true),
  });
}
function drawAdd(keepSearch) {
  const el = openSheet && openSheet.el; if (!el) return;
  el.querySelectorAll('#addseg button').forEach(b => b.classList.toggle('on', b.dataset.mode === addMode));
  const body = $('#addbody', el);
  const n = Object.values(addedInSheet).reduce((a, b) => a + b, 0);
  $('#donebtn', el).textContent = n ? `סיום · נוספו ${n}` : 'סיום';

  if (addMode === 'mine') {
    const prev = keepSearch ? ($('#asearch', el)?.value || '') : '';
    body.innerHTML = `
      <div class="search">${I.search}<input class="input" id="asearch" type="search" placeholder="חיפוש…" autocomplete="off" value="${esc(prev)}"></div>
      <div class="card" id="alist"></div>`;
    const inp = $('#asearch', el);
    const draw = () => { $('#alist', el).innerHTML = addList(inp.value.trim()); };
    inp.addEventListener('input', draw);
    draw();
  } else {
    body.innerHTML = onceForm();
    const f = $('#onceform', el);
    const k = $('[name=kcal]', f);
    const sync = () => { $('#oncebtn', el).disabled = !(num(k.value) > 0); };
    f.addEventListener('input', sync); sync();
    f.addEventListener('submit', e => { e.preventDefault(); submitOnce(f); });
    setTimeout(() => k.focus(), 300);
  }
}
function addList(q) {
  const list = rankedProducts().filter(p => !q || p.name.includes(q));
  if (!S.products.length) return `<div class="empty">אין עדיין מוצרים שמורים.<br><button class="link" data-act="to-once">הוספה חד־פעמית</button> או <button class="link" data-act="new-product">יצירת מוצר</button></div>`;
  if (!list.length) return `<div class="empty">לא נמצא "${esc(q)}"<div style="margin-top:12px"><button class="btn soft" data-act="to-once" data-name="${esc(q)}">הוספת "${esc(q)}" כחד־פעמי</button></div></div>`;
  return list.map(p => {
    const c = addedInSheet[p.id];
    return `
    <button class="prow" data-act="sheet-add" data-id="${p.id}">
      <div class="thumb"${photoStyle(p.photo)}>${p.photo ? '' : initial(p.name)}</div>
      <div class="info"><div class="nm">${esc(p.name)}</div><div class="sm">${esc(perLabel(p))}</div></div>
      <span class="addbtn ${c ? 'done' : ''}">${c ? I.check : I.plus}${c > 1 ? `<span class="badge">${c}</span>` : ''}</span>
    </button>`;
  }).join('');
}
function onceForm(name = '') {
  return `
  <form id="onceform" class="card" autocomplete="off">
    <label class="field"><span>קלוריות *</span><input class="input" name="kcal" inputmode="numeric" placeholder="למשל 350"></label>
    <div class="grid2">
      <label class="field"><span>חלבון (ג׳)</span><input class="input" name="protein" inputmode="decimal" placeholder="לא חובה"></label>
      <label class="field"><span>שם</span><input class="input" name="name" placeholder="לא חובה" value="${esc(name)}"></label>
    </div>
    <label class="check"><input type="checkbox" name="keep"> לשמור גם במוצרים שלי</label>
    <button class="btn" id="oncebtn" type="submit">${I.plus} הוספה</button>
  </form>
  <p class="note" style="text-align:center">רק המספר חובה. מושלם לארוחה במסעדה או משהו שאוכלים פעם אחת.</p>`;
}
function submitOnce(f) {
  const kcal = Math.round(num(f.kcal.value));
  if (!(kcal > 0)) return;
  const protein = num(f.protein.value);
  const name = f.name.value.trim();
  if (f.keep.checked) {
    const p = { id: uid(), name: name || `מוצר ${S.products.length + 1}`, mode: 'u', kcal, protein, defaultQty: 1, photo: '', uses: 0 };
    S.products.push(p);
    addProduct(p);
    addedInSheet[p.id] = 1;
  } else {
    addOneOff({ name, kcal, protein });
    addedInSheet._once = (addedInSheet._once || 0) + 1;
  }
  f.reset();
  $('#oncebtn').disabled = true;
  const n = Object.values(addedInSheet).reduce((a, b) => a + b, 0);
  $('#donebtn').textContent = `סיום · נוספו ${n}`;
  render();
}

/* ---------- quantity sheet ---------- */
function openQty(id) {
  const e = dayEntries(day).find(x => x.id === id);
  if (!e) return;
  const g = isGram(e);
  const presets = g ? [30, 50, 100, 150, 200, 250] : [0.5, 1, 1.5, 2, 3, 4];
  sheet({
    title: esc(e.name),
    body: `
      <div class="card">
        <label class="field"><span>${g ? 'כמה גרם?' : 'כמה יחידות?'}</span>
          <input class="input" id="qinput" inputmode="decimal" value="${e.qty}"></label>
        <div class="chips">${presets.map(v => `<button type="button" data-v="${v}">${g ? v + ' ג׳' : fmt1(v)}</button>`).join('')}</div>
        <div class="note" id="qprev"></div>
      </div>
      <button class="btn danger" data-act="del-entry" data-id="${e.id}">הסרה מהיומן</button>`,
    footer: `<button class="btn" id="qsave">שמירה</button>`,
    onMount: el => {
      const inp = $('#qinput', el);
      const prev = () => { const q = num(inp.value); $('#qprev', el).textContent = q > 0 ? `${fmt(e.kcal * factor(e, q))} קק״ל · ${fmt1((e.protein || 0) * factor(e, q))} ג׳ חלבון` : ''; };
      inp.addEventListener('input', prev); prev();
      $('.chips', el).addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) { inp.value = b.dataset.v; prev(); } });
      $('#qsave', el).addEventListener('click', () => { const q = num(inp.value); if (q > 0) { e.qty = q; save(); } closeSheet(); });
    },
  });
}

/* ---------- product editor ---------- */
function openProduct(id) {
  const ex = id && productById(id);
  const p = ex ? { ...ex } : { id: uid(), name: '', mode: 'u', kcal: '', protein: '', defaultQty: 1, photo: '', uses: 0 };
  const draw = el => {
    const g = isGram(p);
    $('#pqlabel', el).textContent = g ? 'כמה גרם בדרך כלל אוכלים?' : 'כמה יחידות בדרך כלל?';
    $('#pkl', el).textContent = g ? 'קלוריות ל־100 ג׳' : 'קלוריות ליחידה';
    $('#ppl', el).textContent = g ? 'חלבון ל־100 ג׳' : 'חלבון ליחידה';
  };
  sheet({
    title: ex ? 'עריכת מוצר' : 'מוצר חדש',
    body: `
      <form id="pform2" autocomplete="off">
        <label class="photo ${p.photo ? 'has' : ''}" id="pphoto"${photoStyle(p.photo)}>
          <span id="pphoto-l">${p.photo ? '' : I.camera + '<br>תמונה'}</span>
          <input type="file" accept="image/*" id="pfile">
        </label>
        <div class="card">
          <label class="field"><span>שם המוצר</span><input class="input" name="name" value="${esc(p.name)}" placeholder="למשל: יוגורט חלבון"></label>
          <div class="seg" data-field="mode">
            <button type="button" data-v="u" class="${!isGram(p) ? 'on' : ''}">לפי יחידה</button>
            <button type="button" data-v="g" class="${isGram(p) ? 'on' : ''}">לפי 100 גרם</button>
          </div>
          <div class="grid2">
            <label class="field"><span id="pkl"></span><input class="input" name="kcal" inputmode="decimal" value="${p.kcal}"></label>
            <label class="field"><span id="ppl"></span><input class="input" name="protein" inputmode="decimal" value="${p.protein}" placeholder="0"></label>
          </div>
          <label class="field"><span id="pqlabel"></span><input class="input" name="defaultQty" inputmode="decimal" value="${p.defaultQty}"></label>
          <p class="note" style="margin:0">זו הכמות שתתווסף בלחיצה אחת. תמיד אפשר לשנות ביומן.</p>
        </div>
        ${ex ? `<button type="button" class="btn danger" data-act="del-product" data-id="${p.id}">מחיקת המוצר</button>` : ''}
      </form>`,
    footer: `<div class="grid2">
      <button class="btn ghost" id="psave">שמירה</button>
      <button class="btn" id="psaveadd">שמירה + הוספה</button></div>`,
    onMount: el => {
      draw(el);
      const f = $('#pform2', el);
      f.addEventListener('click', ev => {
        const b = ev.target.closest('[data-field] button'); if (!b) return;
        const was = p.mode; p.mode = b.dataset.v;
        b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        if (was !== p.mode) f.defaultQty.value = isGram(p) ? 100 : 1;
        draw(el);
      });
      $('#pfile', el).addEventListener('change', async ev => {
        const file = ev.target.files[0]; if (!file) return;
        try {
          p.photo = await shrinkImage(file, 320);
          const ph = $('#pphoto', el);
          ph.style.backgroundImage = `url('${p.photo}')`; ph.classList.add('has'); $('#pphoto-l', el).innerHTML = '';
        } catch (e) { toast('לא הצלחתי לטעון את התמונה'); }
      });
      const commit = andAdd => {
        const name = f.name.value.trim();
        const kcal = num(f.kcal.value);
        if (!name) { f.name.focus(); toast('חסר שם למוצר'); return; }
        if (!(kcal >= 0) || f.kcal.value === '') { f.kcal.focus(); toast('חסרות קלוריות'); return; }
        Object.assign(p, { name, kcal, protein: num(f.protein.value), defaultQty: num(f.defaultQty.value) || (isGram(p) ? 100 : 1) });
        if (ex) Object.assign(ex, p); else S.products.push(p);
        save();
        closeSheet();
        if (andAdd) { addProduct(ex || p); render(); } else toast(ex ? 'המוצר עודכן' : 'המוצר נשמר');
      };
      $('#psave', el).addEventListener('click', () => commit(false));
      $('#psaveadd', el).addEventListener('click', () => commit(true));
      if (!ex) setTimeout(() => f.name.focus(), 300);
    },
  });
}

function shrinkImage(file, max) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = rej;
    img.src = url;
  });
}

/* ---------- backup ---------- */
function exportBackup() {
  const data = { ...S }; delete data._draft;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kalori-backup-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importBackup(ev) {
  const file = ev.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.products) || typeof d.log !== 'object') throw 0;
      if (!confirm('הגיבוי יחליף את כל הנתונים הנוכחיים. להמשיך?')) return;
      S = Object.assign(blank(), d); save(); render(); toast('הגיבוי נטען');
    } catch (e) { toast('הקובץ לא תקין'); }
  };
  r.readAsText(file);
}

/* =========================================================
   EVENTS
   ========================================================= */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-tab],[data-act]');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; historyOpen = null; hideToast(); if (tab === 'today') day = todayKey(); render(); window.scrollTo(0, 0); return; }
  const a = t.dataset.act, id = t.dataset.id;
  switch (a) {
    case 'open-add': openAdd(); break;
    case 'close-sheet': closeSheet(); break;
    case 'undo': undo(); break;
    case 'day': {
      const nd = shiftDay(day, Number(t.dataset.n));
      if (nd <= todayKey()) { day = nd; render(); }
      break;
    }
    case 'quick': {
      ev.stopPropagation();
      const p = productById(id); if (p) { addProduct(p); render(); }
      break;
    }
    case 'sheet-add': {
      const p = productById(id); if (!p) break;
      addProduct(p);
      addedInSheet[id] = (addedInSheet[id] || 0) + 1;
      drawAdd(true);
      break;
    }
    case 'to-once': {
      addMode = 'once'; drawAdd();
      if (t.dataset.name) $('#onceform [name=name]').value = t.dataset.name;
      break;
    }
    case 'step': stepEntry(id, Number(t.dataset.n)); break;
    case 'qty': openQty(id); break;
    case 'del-entry': removeEntry(id); closeSheet(); break;
    case 'new-product': openProduct(); break;
    case 'edit-product': openProduct(id); break;
    case 'del-product': {
      if (!confirm('למחוק את המוצר? (מה שכבר ביומן יישאר)')) break;
      S.products = S.products.filter(p => p.id !== id); save(); closeSheet(); toast('המוצר נמחק');
      break;
    }
    case 'hist-toggle': historyOpen = historyOpen === t.dataset.k ? null : t.dataset.k; render(); break;
    case 'readd': {
      const e = (S.log[t.dataset.k] || []).find(x => x.id === id); if (!e) break;
      const c = { ...e, id: uid(), t: Date.now() };
      dayEntries(todayKey()).push(c); save();
      lastAdded = { k: todayKey(), id: c.id, pid: null };
      toast(`נוסף להיום: ${e.name}`, true);
      break;
    }
    case 'copy-day': {
      const src = S.log[t.dataset.k] || [];
      const tk = todayKey();
      src.forEach(e => dayEntries(tk).push({ ...e, id: uid(), t: Date.now() }));
      save(); toast(`${src.length} פריטים הועתקו להיום`);
      break;
    }
    case 'goto-day': day = t.dataset.k; tab = 'today'; render(); window.scrollTo(0, 0); break;
    case 'finish-onboarding': {
      S.profile = S._draft || defaultProfile(); delete S._draft; save();
      tab = 'today'; render();
      break;
    }
    case 'export': exportBackup(); break;
    case 'reset': {
      if (!confirm('למחוק את כל המוצרים, היומן וההגדרות? אי אפשר לבטל.')) break;
      S = blank(); save(); tab = 'today'; render();
      break;
    }
  }
});

/* new day while app stays open in background */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tab === 'today' && !openSheet) render();
});

render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
