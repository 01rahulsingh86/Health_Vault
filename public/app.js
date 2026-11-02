(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { me: null, records: [], tab: 'trends', mode: 'login', chat: [], rcat: '', tcat: '', draft: null, publicAccessRequired: false, publicAccessKey: localStorage.getItem('hv_access_key') || '' };
const MAX_FILES = 10;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3400); }
async function api(path, opts = {}) {
  const o = { method: 'GET', credentials: 'same-origin', headers: {}, ...opts };
  if (S.publicAccessKey) o.headers['X-HealthVault-Key'] = S.publicAccessKey;
  if (o.method !== 'GET') o.headers['X-Requested-With'] = 'hv';
  if (o.json) {
    o.headers['Content-Type'] = 'application/json';
    o.json = { ...o.json, ...(S.publicAccessKey && !('access_key' in o.json) ? { access_key: S.publicAccessKey } : {}) };
    o.body = JSON.stringify(o.json);
  }
  const r = await fetch('/api' + path, o);
  if (r.status === 401 && S.me && !path.startsWith('/auth')) { S.me = null; renderAuth('Your session expired. Please sign in again.'); throw new Error('Session expired'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const busy = (b, on, label) => { b.disabled = on; b.innerHTML = on ? `<span class="spinner"></span>${esc(label)}` : b.dataset.l; };
const fmtDate = (d, o = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', o);
const cleanRecordTitle = (title) => {
  const t = String(title || '').trim();
  return !t ? 'Report' : t.length > 32 ? 'Report' : t;
};
const num = (x) => (x === '' || x == null || isNaN(Number(x)) ? null : Number(x));
const fmt = (n) => (Math.abs(n) >= 100 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100);
function formatAiText(text) {
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const sections = String(text || '').trim().split(/\n{2,}/).filter(Boolean);
  return sections.map((section) => {
    const lines = section.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^[-*]\s+/.test(l))) {
      return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('') + '</ul>';
    }
    if (lines.length && /^#{1,3}\s+/.test(lines[0])) {
      const heading = lines.shift();
      return `<h3>${inline(heading.replace(/^#{1,3}\s+/, ''))}</h3>${lines.length ? '<p>' + inline(lines.join(' ')) + '</p>' : ''}`;
    }
    return '<p>' + inline(lines.join(' ')) + '</p>';
  }).join('');
}
function compactText(s, max = 220) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd() + '…';
}
function formatClinicalNotes(text) {
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sentences = String(text || '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const signposts = sentences.filter((sentence) => /(out of range|high|low|abnormal|equivocal|flagged|critical|result|indicated|duplicate|previous results|not in the files)/i.test(sentence));
  const items = signposts.length ? signposts.slice(0, 3) : sentences.slice(0, 2);
  const chips = items.map((sentence) => {
    const short = compactText(sentence, 120);
    const kind = /(high|abnormal|critical|flagged|equivocal)/i.test(sentence) ? 'warn' : 'info';
    return `<span class="note-badge ${kind}">${escapeHtml(short)}</span>`;
  });
  const body = items.map((sentence) => `<p>${escapeHtml(sentence)}</p>`).join('');
  return `${chips.length ? `<div class="note-summary">${chips.join('')}</div>` : ''}${body}`;
}

const ICON = {
  records: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  trends: '<path d="M3 17l6-6 4 4 8-8M14 7h7v7"/>',
  ask: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

// ---------- plain-language glossary (fallback when a report has no explanation) ----------
const GLOSSARY = [
  [/hba1c|a1c|glycated|glycosylated/, 'Your average blood sugar over the past ~3 months. Higher values mean sugar has been running high.'],
  [/glucose|blood sugar/, 'Sugar in your blood at the time of the test — your body’s main fuel. Fasting levels are most telling.'],
  [/\bldl\b/, '“Bad” cholesterol. It can build up in artery walls, so lower is generally better.'],
  [/\bhdl\b/, '“Good” cholesterol. It helps clear other cholesterol from your blood, so higher is generally better.'],
  [/triglycerid/, 'A type of fat in your blood. High levels, often from sugar, alcohol or excess calories, raise heart-health risk.'],
  [/cholesterol/, 'A waxy fat your body needs in small amounts. Too much can clog arteries over time.'],
  [/hemoglobin|haemoglobin|\bhgb\b|\bhb\b/, 'The protein in red blood cells that carries oxygen. Low levels can mean anaemia and tiredness.'],
  [/hematocrit|haematocrit|\bhct\b/, 'The percentage of your blood made up of red blood cells.'],
  [/\bwbc\b|white blood|leuk/, 'White blood cells fight infection. High or low counts can point to infection or immune changes.'],
  [/\brbc\b|red blood cell/, 'Red blood cells carry oxygen around your body.'],
  [/platelet|\bplt\b/, 'Tiny cells that help your blood clot after an injury.'],
  [/creatinine/, 'A waste product filtered by your kidneys. Higher levels can suggest the kidneys are working less well.'],
  [/egfr|gfr/, 'An estimate of how well your kidneys filter blood. Higher is better.'],
  [/\balt\b|sgpt|\bast\b|sgot|\bggt\b/, 'Liver enzymes. Raised levels can mean the liver is irritated or stressed.'],
  [/bilirubin/, 'A yellow pigment made when red blood cells break down; processed by the liver.'],
  [/\btsh\b/, 'Thyroid-stimulating hormone — tells you how hard your brain is pushing your thyroid. Out of range can mean an under- or over-active thyroid.'],
  [/vitamin d/, 'Supports bones, muscles and immunity. Most of it comes from sunlight.'],
  [/b12|cobalamin/, 'Needed for nerves and making red blood cells.'],
  [/ferritin|iron/, 'Reflects your body’s iron stores. Low can cause fatigue; high can have other causes.'],
  [/sodium/, 'An electrolyte controlling fluid balance, nerves and muscles.'],
  [/potassium/, 'An electrolyte vital for heart rhythm and muscle function.'],
  [/calcium/, 'Important for bones, nerves and muscles.'],
  [/uric/, 'A waste product that can form crystals in joints (gout) when too high.'],
  [/crp/, 'A marker of inflammation in the body.'],
  [/\bbmi\b/, 'Body-mass index: weight relative to height. A rough guide, not a diagnosis.'],
  [/systolic/, 'Blood pressure when your heart beats (top number).'],
  [/diastolic/, 'Blood pressure when your heart rests between beats (bottom number).'],
  [/sphere|\bsph\b/, 'Eye prescription strength. Negative = short-sighted (blurry far away); positive = long-sighted.'],
  [/cylinder|\bcyl\b/, 'Corrects astigmatism (uneven curve of the eye). 0 means none.'],
  [/\baxis\b/, 'The angle (0–180°) at which your astigmatism correction is applied.'],
  [/\badd\b|addition/, 'Extra magnification for reading or close work (varifocals/bifocals).'],
  [/\bpd\b|pupil/, 'Distance between your pupils in mm; used to centre lenses correctly.'],
  [/iop|intraocular|eye pressure/, 'Pressure inside the eye. Persistently high pressure is a risk factor for glaucoma.'],
  [/pocket|probing/, 'Gum pocket depth in mm. Deeper pockets (4 mm+) can signal gum disease.'],
];
const aboutFor = (m) => m.about || (GLOSSARY.find(([re]) => re.test(String(m.name).toLowerCase())) || [])[1] || '';
const sourceMeta = (r = {}) => [
  r.date ? `Date: ${fmtDate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })}` : '',
  r.doctor_name ? `Doctor: ${r.doctor_name}` : '',
  r.lab_name ? `Lab: ${r.lab_name}` : '',
  r.facility_name ? `Facility: ${r.facility_name}` : '',
  r.facility_address ? `Address: ${r.facility_address}` : '',
].filter(Boolean);

// ---------- status / gauge ----------
function statusOf(m) {
  const v = typeof m.value === 'number' ? m.value : num(m.value);
  if (v == null) return '';
  if (m.high != null && v > m.high) return 'high';
  if (m.low != null && v < m.low) return 'low';
  return m.low != null || m.high != null ? 'ok' : '';
}
const LABEL = { ok: 'In range', high: 'High', low: 'Low' };
const pill = (s) => (s ? `<span class="pill ${s}">${LABEL[s]}</span>` : '');
function gauge(m) {
  const v = num(m.value); if (v == null || (m.low == null && m.high == null)) return '';
  const { low: lo, high: hi } = m; let a, b, zl, zh;
  if (lo != null && hi != null) { const sp = hi - lo || 1; a = lo - sp * 0.8; b = hi + sp * 0.8; zl = lo; zh = hi; }
  else if (hi != null) { a = Math.min(0, v); b = Math.max(hi * 1.5, v * 1.1); zl = a; zh = hi; }
  else { a = Math.min(lo * 0.5, v * 0.9); b = Math.max(lo * 1.8, v * 1.1); zl = lo; zh = b; }
  a = Math.min(a, v - 0.01); b = Math.max(b, v + 0.01);
  const P = (x) => Math.max(3, Math.min(97, ((x - a) / (b - a)) * 100));
  const s = statusOf(m) || 'na';
  return `<svg class="gauge" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="Result ${esc(v)} on a scale; normal range ${esc(lo ?? '')} to ${esc(hi ?? '')}"><rect class="trk" x="0" y="3.5" width="100" height="3" rx="1.5"/><rect class="zone" x="${P(zl)}" y="2.2" width="${Math.max(2, P(zh) - P(zl))}" height="5.6" rx="2.8"/><circle class="dot ${s}" cx="${P(v)}" cy="5" r="3.4"/></svg>
  <div class="rng"><span>${lo != null ? 'Normal from ' + esc(lo) : ''}</span><span>${hi != null ? (lo != null ? 'to ' : 'Normal up to ') + esc(hi) : ''}</span></div>`;
}
function tile(m) {
  const s = statusOf(m), ab = aboutFor(m), g = gauge(m);
  return `<details class="tile"><summary><span class="nm">${esc(m.name)}</span><span class="vl ${s === 'high' ? 'hi' : s === 'low' ? 'lo' : ''}">${esc(m.value)} <span class="un">${esc(m.unit)}</span></span>${pill(s)}<span class="chev" aria-hidden="true">›</span></summary>
  <div class="body">${g ? g + '<p class="mut" style="margin:6px 0 0">The green zone is the normal range; the dot is your result.</p>' : ''}${ab ? `<div class="about"><strong>What is this?</strong> ${esc(ab)}</div>` : ''}${!g && !ab ? '<p class="mut">No range or explanation was recorded for this item.</p>' : ''}</div></details>`;
}

// ---------- auth ----------
function renderAuth(msg = '') {
  const reg = S.mode === 'register';
  const keyField = S.publicAccessRequired ? `<label for="pubkey">Public access key</label><input id="pubkey" type="password" autocomplete="off" value="${esc(S.publicAccessKey)}" placeholder="Enter the shared site key">` : '';
  const authCard = `
    <div class="glass auth-card">
      <div class="auth-header">
        <div class="brand-mini"><img class="logo" src="/icon.svg" alt=""><span>Health Vault</span></div>
        <div class="mini-badge">${reg ? 'Create account' : 'Welcome back'}</div>
      </div>
      <form id="f" novalidate>
        ${keyField}
        <label for="em">Email</label><input id="em" type="email" autocomplete="email" required>
        <label for="pw">Password${reg ? ' · 10+ characters' : ''}</label><input id="pw" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required>
        <p class="err" id="err" role="alert">${esc(msg)}</p>
        <button id="go" class="full" data-l="${reg ? 'Create account' : 'Sign in'}">${reg ? 'Create account' : 'Sign in'}</button>
      </form>
      <p class="auth-switch"><button class="ghost" id="sw">${reg ? 'Have an account? Sign in' : 'New here? Create an account'}</button></p>
    </div>
  `;

  app.innerHTML = `
    <div class="landing-shell">
      <section class="landing-hero glass">
        <div class="hero-copy">
          <div class="eyebrow">Private health tracking for real people</div>
          <h1>Organize reports, track trends, and finally understand your health.</h1>
          <p class="sub">Upload test results, dental records, imaging, and GP notes. We keep them secure, readable, and charted over time.</p>
          <div class="hero-actions">
            <button id="cta-main">${reg ? 'Create your free account' : 'Start free'}</button>
            <button class="sec" id="cta-secondary">Already have an account</button>
          </div>
          <div class="trust-row">
            <span>Encrypted at rest</span>
            <span>AI summaries</span>
            <span>Trend tracking</span>
            <span>Free forever</span>
          </div>
        </div>
        <div class="hero-panel">
          ${authCard}
        </div>
      </section>

      <section class="free-only-panel glass">
        <div class="free-only-copy">
          <span class="tier-label">Current plan</span>
          <h3>Free access, no pricing yet</h3>
          <p class="mut">We’re keeping this experience free while we learn how people use it. When the product is proven, we can add a premium tier later.</p>
        </div>
      </section>
    </div>
  `;

  $('#cta-main').onclick = () => { S.mode = 'register'; renderAuth(); };
  $('#cta-secondary').onclick = () => { S.mode = 'login'; renderAuth(); };
  $('#sw').onclick = () => { S.mode = reg ? 'login' : 'register'; renderAuth(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    if (S.publicAccessRequired) {
      const key = $('#pubkey')?.value.trim() || '';
      if (!key) return ($('#err').textContent = 'Enter the public access key.');
      S.publicAccessKey = key;
      localStorage.setItem('hv_access_key', key);
    }
    const b = $('#go'); busy(b, true, 'Please wait…');
    try { await api('/auth/' + (reg ? 'register' : 'login'), { method: 'POST', json: { email: $('#em').value, password: $('#pw').value } }); await boot(); }
    catch (er) { $('#err').textContent = er.message; busy(b, false); }
  };
}

// ---------- shell ----------
const TABS = [['trends', 'Trends'], ['records', 'Records'], ['add', 'Add'], ['ask', 'Ask AI'], ['account', 'Account']];
const AI_DISABLED_COPY = 'AI is turned off on this server. To enable it, the app owner needs to add an Anthropic API key on the server. You cannot enable it from your account or browser-only settings.';

function render() {
  app.innerHTML = `<header class="page-header">
    <div class="brand-block">
      <h1>Health</h1>
      <p class="page-meta">${S.records.length} report${S.records.length === 1 ? '' : 's'} saved</p>
    </div>
  </header>
  <nav class="tabs glass" aria-label="Main">${TABS.map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}" ${S.tab === k ? 'aria-current="page"' : ''}>${icon(k)}${l}</button>`).join('')}</nav>
  <main id="view"></main>`;
  app.querySelectorAll('nav button').forEach((b) => (b.onclick = () => { if (S.tab === 'add' && b.dataset.t !== 'add' && S.draft?.id) S.draft = null; S.tab = b.dataset.t; render(); window.scrollTo(0, 0); }));
  ({ records: viewRecords, add: viewAdd, trends: viewTrends, ask: viewAsk, account: viewAccount })[S.tab]();
}
async function loadRecords() { S.records = await api('/records'); }
async function boot() {
  try {
    const config = await api('/app-config');
    S.publicAccessRequired = !!config.publicAccessRequired;
    if (S.publicAccessRequired && !S.publicAccessKey) { renderAuth(); return; }
    S.me = await api('/me');
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    if (sessionId) {
      try {
        const result = await api('/billing/checkout/complete', { method: 'POST', json: { session_id: sessionId } });
        S.me = { ...S.me, plan: result.plan };
        window.history.replaceState({}, '', window.location.pathname);
        toast('Pro activated successfully');
      } catch (er) {
        toast(er.message);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
    S.tab = 'trends'; await loadRecords(); render();
  } catch {
    S.me = null; renderAuth();
  }
}
const go = (tab) => { S.tab = tab; render(); window.scrollTo(0, 0); };

// ---------- records ----------
function viewRecords() {
  const v = $('#view');
  if (!S.records.length) { v.innerHTML = `<div class="glass card empty"><div class="big">🩺</div><h2>Start your health timeline</h2><p class="mut">Snap photos or upload PDFs of any report. We’ll read the numbers, explain them, and chart them over time.</p><button id="first">Add your first report</button></div>`; $('#first').onclick = () => go('add'); return; }
  const cats = [...new Set(S.records.map((r) => r.category))];
  v.innerHTML = `<div class="chips" role="group" aria-label="Filter">${['', ...cats].map((c) => `<button class="chip ${S.rcat === c ? 'on' : ''}" data-c="${esc(c)}">${c ? esc(c) : 'All'}</button>`).join('')}</div><div id="list"></div>`;
  v.querySelectorAll('.chip').forEach((b) => (b.onclick = () => { S.rcat = b.dataset.c; viewRecords(); }));
  $('#list').innerHTML = S.records.filter((r) => !S.rcat || r.category === S.rcat).map((r) => {
    const bad = r.metrics.filter((m) => ['high', 'low'].includes(statusOf(m))).length;
    const metaTiles = [
      r.doctor_name ? `<div class="meta-tile"><span class="meta-label">Doctor</span><strong>${esc(r.doctor_name)}</strong></div>` : '',
      r.lab_name ? `<div class="meta-tile"><span class="meta-label">Lab</span><strong>${esc(r.lab_name)}</strong></div>` : '',
      `<div class="meta-tile"><span class="meta-label">Date</span><strong>${esc(fmtDate(r.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</strong></div>`,
    ].filter(Boolean);
    const titleText = cleanRecordTitle(r.title);
    return `<article class="glass card rec"><div class="rec-layout"><div class="rec-side">${metaTiles.length ? `<div class="meta-stack">${metaTiles.join('')}</div>` : ''}</div><div class="rec-main"><div class="between"><div><h3>${esc(titleText)}</h3><span class="pill">${esc(r.category)}</span>${bad ? ` <span class="pill high">${bad} to review</span>` : ''}</div>
    <div class="row" style="flex:0 0 auto"><button class="sec sm" data-e="${esc(r.id)}">Edit</button><button class="danger sm" data-d="${esc(r.id)}">Delete</button></div></div>
    ${r.files.length ? `<div class="files">${r.files.map((f) => `<a class="file" href="/api/records/${esc(r.id)}/files/${esc(f.id)}" target="_blank" rel="noopener">${f.mime === 'application/pdf' ? '📄' : '🖼️'}<span>${esc(f.name)}</span></a>`).join('')}</div>` : ''}
    ${r.metrics.length ? `<div>${r.metrics.map(tile).join('')}</div><p class="mut" style="margin:8px 0 0">Tap any result to see what it means.</p>` : ''}</div></div></article>`;
  }).join('') || '<p class="mut">Nothing in this category.</p>';
  $('#list').querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => { const r = S.records.find((x) => x.id === b.dataset.e); S.draft = { id: r.id, existing: [...r.files], files: [], metrics: r.metrics.map((m) => ({ ...m })), notes: r.notes, rec: r, unclear: [], notice: '' }; go('add'); }));
  $('#list').querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this report and all its files? This cannot be undone.')) return;
    try { await api('/records/' + b.dataset.d, { method: 'DELETE' }); await loadRecords(); render(); toast('Deleted'); } catch (e) { toast(e.message); }
  }));
}

// ---------- add / edit ----------
async function prepFile(f) {
  if (!f.type.startsWith('image/')) return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    return new File([blob], (f.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; }
}
const mrow = (m = {}) => `<div class="mrow" data-about="${esc(m.about || '')}"><input class="nm" aria-label="Name" placeholder="Name" value="${esc(m.name)}"><input aria-label="Value" placeholder="Value" value="${esc(m.value)}"><input aria-label="Unit" placeholder="Unit" value="${esc(m.unit)}"><input aria-label="Low" inputmode="decimal" placeholder="Low" value="${esc(m.low)}"><input aria-label="High" inputmode="decimal" placeholder="High" value="${esc(m.high)}"><button class="ghost x" type="button" aria-label="Remove" data-x>✕</button></div>`;
function readRows() {
  return [...document.querySelectorAll('#rows .mrow')].map((r) => {
    const i = [...r.querySelectorAll('input')].map((x) => x.value.trim());
    return { name: i[0], value: i[1] !== '' && !isNaN(Number(i[1])) ? Number(i[1]) : i[1], unit: i[2], low: num(i[3]), high: num(i[4]), about: r.dataset.about || '' };
  }).filter((m) => m.name && m.value !== '');
}
function drawThumbs() {
  const d = S.draft, box = $('#thumbs'); if (!box) return;
  const ex = d.existing.map((f) => `<div class="th">${f.mime === 'application/pdf' ? '📄<br>' : '🖼️<br>'}${esc(f.name.slice(0, 16))}<button type="button" data-rx="${esc(f.id)}" aria-label="Remove file">✕</button></div>`);
  const nw = d.files.map((f, i) => `<div class="th">${f.type.startsWith('image/') ? `<img alt="" src="${URL.createObjectURL(f)}">` : '📄<br>' + esc(f.name.slice(0, 16))}<button type="button" data-rn="${i}" aria-label="Remove file">✕</button></div>`);
  box.innerHTML = [...ex, ...nw].join('');
  $('#fcount').textContent = ex.length + nw.length ? `${ex.length + nw.length} file${ex.length + nw.length === 1 ? '' : 's'} · all are read together as one report` : 'No files yet';
  box.querySelectorAll('[data-rn]').forEach((b) => (b.onclick = () => { d.files.splice(+b.dataset.rn, 1); drawThumbs(); }));
  box.querySelectorAll('[data-rx]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove this saved file from the report?')) return;
    try { await api(`/records/${d.id}/files/${b.dataset.rx}`, { method: 'DELETE' }); d.existing = d.existing.filter((f) => f.id !== b.dataset.rx); await loadRecords(); drawThumbs(); } catch (e) { toast(e.message); }
  }));
}
function drawNotice() {
  const d = S.draft, n = $('#notice'); if (!n) return;
  n.innerHTML = d.notice ? `<div class="notice" role="status">${esc(d.notice)}</div>` : '';
  if (d.unclear?.length) n.innerHTML += `<div class="notice warn" role="status"><strong>Some parts weren’t clear</strong> — please check these against your report:<ul>${d.unclear.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>`;
}
function viewAdd() {
  if (!S.draft) S.draft = { files: [], existing: [], metrics: [], notes: '', unclear: [], notice: '' };
  const d = S.draft, r = d.rec || {}, edit = !!d.id, v = $('#view');
  v.innerHTML = `<div class="glass card"><h2>${edit ? 'Edit report' : 'Add a report'}</h2>
  <div class="drop"><p style="margin:0 0 12px" class="mut">Report on several pages? Add every page or photo — they’re combined into one report.</p>
  <div class="row"><button type="button" id="cam">📷 Take photo</button><button type="button" class="sec" id="pick">📁 Choose files</button></div>
  <input type="file" id="camIn" class="hide" accept="image/*" capture="environment"><input type="file" id="pickIn" class="hide" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" multiple>
  <p class="mut" id="fcount" style="margin:12px 0 0"></p><div class="thumbs" id="thumbs"></div></div>
  ${S.me.aiEnabled ? `<button class="full" id="ai" style="margin-top:14px" data-l="✨ Read ${edit ? 'new files' : 'report'} with AI">✨ Read ${edit ? 'new files' : 'report'} with AI</button><p class="mut" style="margin:8px 0 0">Files are sent to Anthropic’s API to be read. Always double-check the numbers.</p>` : `<div class="notice warn" role="status"><strong>AI is off right now.</strong><br>${esc(AI_DISABLED_COPY)}</div><p class="mut" style="margin:8px 0 0">You can continue by entering the details manually below.</p>`}
  <div id="notice"></div>
  <div class="row"><div><label for="title">Title</label><input id="title" maxlength="200" placeholder="e.g. Annual blood test" value="${esc(r.title)}"></div>
  <div><label for="cat">Category</label><select id="cat">${S.me.categories.map((c) => `<option ${r.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
  <div><label for="date">Report date</label><input id="date" type="date" value="${esc(r.date || new Date().toISOString().slice(0, 10))}"></div></div>
  <div class="row">
    <div><label for="doctor_name">Doctor</label><input id="doctor_name" placeholder="Dr. Patel" value="${esc(r.doctor_name || '')}"></div>
    <div><label for="lab_name">Lab</label><input id="lab_name" placeholder="LabCorp" value="${esc(r.lab_name || '')}"></div>
  </div>
  <div class="row">
    <div><label for="facility_name">Facility</label><input id="facility_name" placeholder="City Family Clinic" value="${esc(r.facility_name || '')}"></div>
    <div><label for="facility_address">Address</label><input id="facility_address" placeholder="18 Oak St, Denver, CO" value="${esc(r.facility_address || '')}"></div>
  </div>
  <label for="sum">Summary</label><textarea id="sum" rows="2" maxlength="2000">${esc(r.summary)}</textarea>
  <label for="notes">Findings &amp; notes</label><textarea id="notes" rows="3" maxlength="8000" placeholder="Doctor’s comments, dental notes, follow-ups…">${esc(d.notes)}</textarea>
  <label>Results</label><div class="mhead"><span>Name</span><span>Value</span><span>Unit</span><span>Low</span><span>High</span><span></span></div>
  <div id="rows">${(d.metrics.length ? d.metrics : [{}]).map(mrow).join('')}</div>
  <button class="sec sm" id="addrow" type="button">＋ Add result</button><p class="err" id="err" role="alert"></p>
  <div class="row"><button id="save" data-l="${edit ? 'Save changes' : 'Save report'}">${edit ? 'Save changes' : 'Save report'}</button>${edit ? '<button class="ghost" id="cancel">Cancel</button>' : ''}</div></div>`;
  drawThumbs(); drawNotice();
  const add = async (list) => {
    const room = MAX_FILES - d.files.length - d.existing.length;
    if (list.length > room) toast(`A report can have up to ${MAX_FILES} files`);
    for (const f of [...list].slice(0, Math.max(0, room))) d.files.push(await prepFile(f));
    drawThumbs();
  };
  $('#cam').onclick = () => $('#camIn').click(); $('#pick').onclick = () => $('#pickIn').click();
  $('#camIn').onchange = async (e) => { await add(e.target.files); e.target.value = ''; };
  $('#pickIn').onchange = async (e) => { await add(e.target.files); e.target.value = ''; };
  $('#rows').onclick = (e) => { if (e.target.dataset.x !== undefined) e.target.closest('.mrow').remove(); };
  $('#addrow').onclick = () => $('#rows').insertAdjacentHTML('beforeend', mrow());
  if (edit) $('#cancel').onclick = () => { S.draft = null; go('records'); };
  const aiBtn = $('#ai');
  if (aiBtn) aiBtn.onclick = async () => {
    if (!d.files.length) return ($('#err').textContent = 'Add at least one photo or PDF first.');
    if (S.me.plan !== 'pro' && S.me.aiUsed >= S.me.aiLimit) {
      $('#err').textContent = 'Free plan AI limit reached. Upgrade to Pro for unlimited reads.';
      return;
    }
    $('#err').textContent = ''; busy(aiBtn, true, `Reading ${d.files.length} file${d.files.length > 1 ? 's' : ''}… up to a minute`);
    try {
      const fd = new FormData(); d.files.forEach((f) => fd.append('files', f)); fd.append('category', $('#cat').value);
      const x = await api('/extract', { method: 'POST', body: fd });
      if (x.title && !$('#title').value) $('#title').value = x.title;
      if (x.date) $('#date').value = x.date;
      if (x.summary) $('#sum').value = x.summary;
      if (x.doctor_name) $('#doctor_name').value = x.doctor_name;
      if (x.lab_name) $('#lab_name').value = x.lab_name;
      if (x.facility_name) $('#facility_name').value = x.facility_name;
      if (x.facility_address) $('#facility_address').value = x.facility_address;
      if (x.notes) $('#notes').value = ($('#notes').value ? $('#notes').value + '\n' : '') + x.notes;
      const cur = readRows(), seen = new Set(cur.map((m) => `${m.name}|${m.value}`.toLowerCase()));
      d.metrics = [...cur, ...x.metrics.filter((m) => !seen.has(`${m.name}|${m.value}`.toLowerCase()))];
      $('#rows').innerHTML = (d.metrics.length ? d.metrics : [{}]).map(mrow).join('');
      d.unclear = x.unclear; d.notice = `✓ Read ${x.fileCount} file${x.fileCount > 1 ? 's' : ''}: found ${x.metrics.length} result${x.metrics.length === 1 ? '' : 's'}${x.notes ? ' plus written findings' : ''}. Review below before saving.`;
      drawNotice();
    } catch (er) { $('#err').textContent = er.message; }
    busy(aiBtn, false);
  };
  $('#save').onclick = async () => {
    const title = $('#title').value.trim(); if (!title) return ($('#err').textContent = 'Please add a title.');
    if (S.me.plan !== 'pro' && S.me.recordsUsed >= S.me.recordsLimit) {
      $('#err').textContent = 'Free plan limit reached. Upgrade to Pro to save more reports.';
      return;
    }
    const b = $('#save'); busy(b, true, 'Saving…');
    const body = {
      title,
      category: $('#cat').value,
      date: $('#date').value,
      summary: $('#sum').value,
      notes: $('#notes').value,
      doctor_name: $('#doctor_name').value.trim(),
      lab_name: $('#lab_name').value.trim(),
      facility_name: $('#facility_name').value.trim(),
      facility_address: $('#facility_address').value.trim(),
      metrics: readRows(),
    };
    try {
      if (edit) {
        await api('/records/' + d.id, { method: 'PUT', json: body });
        if (d.files.length) { const fd = new FormData(); d.files.forEach((f) => fd.append('files', f)); await api(`/records/${d.id}/files`, { method: 'POST', body: fd }); }
      } else {
        const fd = new FormData(); Object.entries({ ...body, metrics: JSON.stringify(body.metrics) }).forEach(([k, x]) => fd.append(k, x));
        d.files.forEach((f) => fd.append('files', f)); await api('/records', { method: 'POST', body: fd });
      }
      S.draft = null; await loadRecords(); go('trends'); toast('Saved — see your trends');
    } catch (er) { $('#err').textContent = er.message; busy(b, false); }
  };
}

// ---------- trends ----------
function trendIndex() {
  const m = {};
  [...S.records].sort((a, b) => a.date.localeCompare(b.date)).forEach((r) => r.metrics.forEach((x) => {
    const v = num(x.value); if (v == null) return;
    const k = x.name.trim().toLowerCase(), e = (m[k] = m[k] || { key: k, name: x.name, unit: x.unit, cat: r.category, about: '', pts: [] });
    e.unit = x.unit || e.unit; e.cat = r.category; if (x.about) e.about = x.about;
    e.pts.push({
      date: r.date,
      value: v,
      low: x.low,
      high: x.high,
      title: r.title,
      doctor_name: r.doctor_name,
      lab_name: r.lab_name,
      facility_name: r.facility_name,
      facility_address: r.facility_address,
    });
  }));
  Object.values(m).forEach((e) => { e.pts.forEach((p) => (p.s = statusOf(p))); e.last = e.pts[e.pts.length - 1]; e.prev = e.pts[e.pts.length - 2]; e.s = e.last.s; e.source = e.last || {}; if (!e.about) e.about = aboutFor(e); });
  return Object.values(m);
}
let gid = 0;
function chart(e, big) {
  const p = e.pts, W = big ? 640 : 300, H = big ? 250 : 96, px = big ? 34 : 10, top = big ? 26 : 14, bot = big ? 30 : 20, id = 'g' + ++gid, L = e.last;
  const t = p.map((x) => Date.parse(x.date)), t0 = t[0], t1 = t[t.length - 1] || t0 + 1;
  const vs = p.map((x) => x.value).concat([L.low, L.high].filter((x) => x != null));
  let mn = Math.min(...vs), mx = Math.max(...vs); const pad = (mx - mn || Math.abs(mx) || 1) * 0.15; mn -= pad; mx += pad;
  const X = (i) => px + ((t[i] - t0) / (t1 - t0 || 1)) * (W - 2 * px), Y = (v) => top + (1 - (v - mn) / (mx - mn)) * (H - top - bot);
  const pts = p.map((x, i) => `${X(i).toFixed(1)},${Y(x.value).toFixed(1)}`);
  const band = L.low != null || L.high != null ? (() => { const y1 = Y(L.high ?? mx), y2 = Y(L.low ?? mn); return `<rect class="band" x="${px}" y="${y1.toFixed(1)}" width="${W - 2 * px}" height="${Math.max(2, y2 - y1).toFixed(1)}" rx="4"/>`; })() : '';
  const showAll = big && p.length <= 12;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(e.name)} over time, ${p.length} readings"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop class="sa" offset="0"/><stop class="sb" offset="1"/></linearGradient></defs>${band}
  <polygon fill="url(#${id})" points="${X(0).toFixed(1)},${H - bot} ${pts.join(' ')} ${X(p.length - 1).toFixed(1)},${H - bot}"/><polyline class="ln" points="${pts.join(' ')}"/>
  ${p.map((x, i) => (showAll || i === p.length - 1 ? `<text class="vl" x="${X(i).toFixed(1)}" y="${(Y(x.value) - 9).toFixed(1)}" text-anchor="${i === 0 && p.length > 1 ? 'start' : i === p.length - 1 && p.length > 1 ? 'end' : 'middle'}">${fmt(x.value)}</text>` : '')).join('')}
  ${p.map((x, i) => `<circle class="pt ${x.s || 'na'}" cx="${X(i).toFixed(1)}" cy="${Y(x.value).toFixed(1)}" r="${i === p.length - 1 ? (big ? 6 : 5) : big ? 4.5 : 3}"/>`).join('')}
  <text class="ax" x="${px}" y="${H - 6}" text-anchor="start">${esc(fmtDate(p[0].date))}</text><text class="ax" x="${W - px}" y="${H - 6}" text-anchor="end">${esc(fmtDate(L.date))}</text></svg>`;
}
const deltaTxt = (e) => {
  if (!e.prev) return 'First reading — add another report to see a trend';
  const d = e.last.value - e.prev.value, pc = e.prev.value ? (d / Math.abs(e.prev.value)) * 100 : 0;
  return `${d > 0 ? '▲' : d < 0 ? '▼' : '＝'} ${d > 0 ? '+' : ''}${fmt(d)} (${d > 0 ? '+' : ''}${pc.toFixed(1)}%) since ${fmtDate(e.prev.date)}`;
};
function card(e) {
  const L = e.last, sourceBits = sourceMeta(L || e.source || {});
  return `<button class="trend" data-k="${esc(e.key)}"><div class="t1"><b>${esc(e.name)}</b>${pill(e.s)}</div><div class="big ${e.s === 'high' ? 'hi' : e.s === 'low' ? 'lo' : ''}">${fmt(L.value)} <span class="un mut" style="font-size:.9rem;font-weight:500">${esc(e.unit)}</span></div>
  ${e.pts.length > 1 ? chart(e, false) : gauge({ value: L.value, low: L.low, high: L.high }) || '<div style="height:10px"></div>'}${sourceBits.length ? `<div class="source-strip compact">${sourceBits.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}<div class="delta">${esc(deltaTxt(e))}</div></button>`;
}
function openDetail(e) {
  const dlg = document.createElement('dialog'), L = e.last, sourceBits = sourceMeta(L || e.source || {});
  dlg.innerHTML = `<div class="sheet"><div class="between"><h2 style="margin:0">${esc(e.name)}</h2><button class="sec sm" id="x" aria-label="Close">Close</button></div>
  <div class="big ${e.s === 'high' ? 'hi' : e.s === 'low' ? 'lo' : ''}" style="font-size:2.2rem;font-weight:700;margin:6px 0">${fmt(L.value)} <span class="mut" style="font-size:1rem">${esc(e.unit)}</span> ${pill(e.s)}</div>
  <p class="mut" style="margin:0 0 8px">${esc(deltaTxt(e))}</p>${sourceBits.length ? `<div class="source-strip">${sourceBits.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}${e.pts.length > 1 ? chart(e, true) + '<p class="mut">Shaded band = normal range from your latest report.</p>' : gauge({ value: L.value, low: L.low, high: L.high })}
  ${e.about ? `<div class="about"><strong>What is this?</strong> ${esc(e.about)}</div>` : ''}
  <h3 style="margin-top:16px">History</h3><table class="hist">${[...e.pts].reverse().map((p) => `<tr><td>${esc(fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' }))}<br><span class="mut">${esc(p.title)}</span></td><td><strong class="${p.s === 'high' ? 'hi' : p.s === 'low' ? 'lo' : ''}">${fmt(p.value)} ${esc(e.unit)}</strong> ${pill(p.s)}</td></tr>`).join('')}</table></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  dlg.querySelector('#x').onclick = () => dlg.close();
  dlg.onclick = (ev) => { if (ev.target === dlg) dlg.close(); };
  dlg.onclose = () => dlg.remove();
}
function viewTrends() {
  const v = $('#view'), all = trendIndex();
  if (!all.length) { v.innerHTML = `<div class="glass card empty"><div class="big">📈</div><h2>Your trends appear here</h2><p class="mut">Save reports with numeric results and each measurement gets its own chart automatically. Add new reports whenever you like — monthly or yearly.</p><button id="first">Add a report</button></div>`; $('#first').onclick = () => go('add'); return; }
  const cats = [...new Set(all.map((e) => e.cat))];
  if (S.tcat && !cats.includes(S.tcat)) S.tcat = '';
  const list = all.filter((e) => !S.tcat || e.cat === S.tcat);
  const att = list.filter((e) => e.s === 'high' || e.s === 'low').sort((a, b) => b.pts.length - a.pts.length);
  const rest = list.filter((e) => !att.includes(e)).sort((a, b) => b.pts.length - a.pts.length || a.name.localeCompare(b.name));
  const multi = list.filter((e) => e.pts.length > 1).length;
  v.innerHTML = `<div class="chips" role="group" aria-label="Filter">${['', ...cats].map((c) => `<button class="chip ${S.tcat === c ? 'on' : ''}" data-c="${esc(c)}">${c ? esc(c) : 'All'}</button>`).join('')}</div>
  <div class="stats"><div class="glass stat"><b>${list.length}</b><span>TRACKED</span></div><div class="glass stat"><b class="${att.length ? 'hi' : 'ok'}">${att.length}</b><span>NEED A LOOK</span></div><div class="glass stat"><b>${multi}</b><span>WITH HISTORY</span></div></div>
  ${att.length ? `<div class="sec-t">Needs attention</div><div class="grid">${att.map(card).join('')}</div>` : ''}
  ${rest.length ? `<div class="sec-t">${att.length ? 'Everything else' : 'All results'}</div><div class="grid">${rest.map(card).join('')}</div>` : ''}
  <p class="disclaimer">Out-of-range values are worth discussing with your clinician; they aren’t a diagnosis. Tap a card for its full history and an explanation.</p>`;
  v.querySelectorAll('.chip').forEach((b) => (b.onclick = () => { S.tcat = b.dataset.c; viewTrends(); }));
  v.querySelectorAll('.trend').forEach((b) => (b.onclick = () => openDetail(all.find((e) => e.key === b.dataset.k))));
}

// ---------- ask ----------
const SUGGEST = ['What’s out of range, in simple terms?', 'What changed since my last report?', 'Summarise my latest results'];
async function ask(q) {
  S.chat.push({ q }); viewAsk(true);
  try { S.chat.push({ a: (await api('/ask', { method: 'POST', json: { question: q } })).answer }); } catch (er) { S.chat.push({ a: er.message }); }
  viewAsk();
}
function viewAsk(pending) {
  const v = $('#view'), on = S.me.aiEnabled;
  v.innerHTML = `<div class="glass card"><h2>Ask about your records</h2><p class="mut">Answers use only the reports you’ve saved.</p>
  ${S.chat.length ? '' : `<div class="chips">${SUGGEST.map((s) => `<button class="chip" data-s="${esc(s)}" ${on ? '' : 'disabled'}>${esc(s)}</button>`).join('')}</div>`}
  <div aria-live="polite">${S.chat.map((c) => `<div class="chat ${c.q ? 'me' : 'ai'}">${c.q ? esc(c.q) : formatAiText(c.a)}</div>`).join('')}${pending ? '<div class="chat ai"><span class="spinner"></span></div>' : ''}</div>
  <form id="qf" class="row" style="margin-top:14px"><input id="q" maxlength="1000" placeholder="Ask anything about your results…" aria-label="Question" style="flex:4 1 220px" ${on ? '' : 'disabled'}><button style="flex:1 1 90px" ${on ? '' : 'disabled'}>Ask</button></form>
  <p class="disclaimer">${on ? 'Information only — not medical advice.' : AI_DISABLED_COPY}</p></div>`;
  v.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => ask(b.dataset.s)));
  $('#qf').onsubmit = (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) ask(q); };
}

// ---------- account ----------
function viewAccount() {
  const plan = S.me.plan || 'free';
  const current = plan === 'pro' ? 'Pro plan' : 'Free plan';
  const usage = plan === 'pro' ? 'Unlimited AI reads and reports' : `${S.me.recordsUsed || 0}/${S.me.recordsLimit || 0} reports · ${S.me.aiUsed || 0}/${S.me.aiLimit || 0} AI reads`;
  $('#view').innerHTML = `<div class="glass card"><h2>Account</h2><p class="mut">Signed in as ${esc(S.me.email)}</p><div class="plan-card"><strong>${esc(current)}</strong><span>${esc(usage)}</span></div><div class="row"><a class="btn sec" href="/api/export" download>Export my data</a><button class="sec" id="out">Sign out</button></div></div>
  <div class="glass card"><h2>AI status</h2>${S.me.aiEnabled ? '<p class="mut">AI is enabled on this server. Your uploaded files can be read with Anthropic.</p>' : `<div class="notice warn" role="status"><strong>AI is off.</strong><br>${esc(AI_DISABLED_COPY)}</div>`}<p class="mut" style="margin-top:10px">If you want AI summaries for your reports, the app owner must add the server key in the deployment settings.</p></div>
  <div class="glass card"><h2>Change password</h2><form id="pf"><label for="cur">Current password</label><input id="cur" type="password" autocomplete="current-password"><label for="nw">New password · 10+ characters</label><input id="nw" type="password" autocomplete="new-password"><p class="err" id="perr" role="alert"></p><button data-l="Update password">Update password</button></form></div>
  <div class="glass card"><h2>Delete account</h2><p class="mut">Permanently erases your account, reports and files.</p><label for="dp">Confirm password</label><input id="dp" type="password" autocomplete="current-password"><p class="err" id="derr" role="alert"></p><button class="danger" id="del">Delete everything</button></div>`;
  $('#out').onclick = async () => { await api('/auth/logout', { method: 'POST' }); S.me = null; S.records = []; S.chat = []; S.draft = null; renderAuth(); };
  $('#pf').onsubmit = async (e) => { e.preventDefault(); try { await api('/auth/password', { method: 'POST', json: { current: $('#cur').value, next: $('#nw').value } }); $('#cur').value = $('#nw').value = ''; $('#perr').textContent = ''; toast('Password updated; other devices signed out'); } catch (er) { $('#perr').textContent = er.message; } };
  $('#del').onclick = async () => { if (!confirm('Delete your account and ALL data? This cannot be undone.')) return; try { await api('/me', { method: 'DELETE', json: { password: $('#dp').value } }); S.me = null; S.records = []; renderAuth('Account deleted.'); } catch (er) { $('#derr').textContent = er.message; } };
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister()))).catch(() => {});
}
boot();
})();
