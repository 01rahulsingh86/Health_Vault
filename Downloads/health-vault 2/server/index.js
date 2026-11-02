const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');

const cfg = require('./config');
const db = require('./db');
const { encrypt, decrypt } = require('./crypto');
const ai = require('./ai');

const CATEGORIES = ['Blood test', 'Dental', 'Vision', 'Physical / GP', 'Imaging', 'Vaccination', 'Other'];
const COOKIE = 'hv_session';
const SESSION_DAYS = 7;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const app = express();
if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], objectSrc: ["'self'"],
    frameSrc: ["'self'"], frameAncestors: ["'self'"], baseUri: ["'self'"], formAction: ["'self'"],
  } },
  crossOriginEmbedderPolicy: false,
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (status, msg) => Object.assign(new Error(msg), { status, expose: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadMb * 1024 * 1024, files: 10 } });

function sniffMime(b) {
  if (b.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
const requireFile = (file) => {
  if (!file) throw bad(400, 'No file uploaded');
  const mime = sniffMime(file.buffer);
  if (!mime) throw bad(415, 'Unsupported file. Use PDF, JPG, PNG or WebP.');
  return mime;
};
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const cleanName = (n) => String(n || 'report').replace(/[^\w.\- ]+/g, '_').slice(0, 120);

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id, tv: user.token_version }, cfg.jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: cfg.cookieSecure, maxAge: SESSION_DAYS * 864e5, path: '/' });
}

const auth = (req, res, next) => {
  try {
    const p = jwt.verify(req.cookies[COOKIE] || '', cfg.jwtSecret);
    const u = db.prepare('SELECT id, email, token_version FROM users WHERE id = ?').get(p.sub);
    if (!u || u.token_version !== p.tv) throw 0;
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Please sign in' }); }
};

const stripe = cfg.stripeSecretKey ? new Stripe(cfg.stripeSecretKey) : null;
const stripeReady = () => !!(cfg.stripeSecretKey && cfg.stripePriceId);

const hasValidPublicAccessKey = (req) => {
  if (cfg.publicAccessMode !== 'required' || !cfg.publicAccessKey) return true;
  const provided = req.get('x-healthvault-key') || req.get('x-public-key') || req.get('x-app-key') || req.body?.access_key || req.query?.access_key;
  return provided === cfg.publicAccessKey;
};

// CSRF: SameSite=Strict cookie + required custom header + Origin check
app.use('/api', (req, res, next) => {
  if (req.path === '/app-config') return next();
  if (cfg.publicAccessMode === 'required' && !hasValidPublicAccessKey(req)) return res.status(403).json({ error: 'Public access key required' });
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'hv') return res.status(403).json({ error: 'Blocked' });
  const o = req.get('origin');
  if (o && new URL(o).host !== req.get('host')) return res.status(403).json({ error: 'Blocked' });
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60e3, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });
const aiLimiter = rateLimit({ windowMs: 60 * 60e3, limit: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user.id, message: { error: 'AI limit reached. Try again later.' } });

const filesByRecord = (uid) => {
  const m = {};
  for (const f of db.prepare('SELECT f.* FROM record_files f JOIN records r ON r.id = f.record_id WHERE r.user_id = ? ORDER BY f.position').all(uid))
    (m[f.record_id] = m[f.record_id] || []).push({ id: f.id, name: f.name, mime: f.mime });
  return m;
};
const rowToRecord = (r, files = []) => ({
  id: r.id,
  title: r.title,
  category: r.category,
  date: r.date,
  summary: r.summary,
  notes: r.notes || '',
  doctor_name: r.doctor_name || '',
  lab_name: r.lab_name || '',
  facility_name: r.facility_name || '',
  facility_address: r.facility_address || '',
  metrics: JSON.parse(r.metrics),
  files,
});
const userRecords = (uid) => { const fm = filesByRecord(uid); return db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC, created_at DESC').all(uid).map((r) => rowToRecord(r, fm[r.id])); };
const getUserState = (user) => {
  const plan = user.plan || 'free';
  const recordsUsed = db.prepare('SELECT COUNT(*) AS c FROM records WHERE user_id = ?').get(user.id).c;
  const aiUsed = Number(user.ai_usage || 0);
  return {
    plan,
    recordsUsed,
    recordsLimit: plan === 'pro' ? null : cfg.freeRecordsLimit,
    aiUsed,
    aiLimit: plan === 'pro' ? null : cfg.freeAiLimit,
  };
};
const requirePlanAccess = (user, type) => {
  const state = getUserState(user);
  if (state.plan === 'pro') return state;
  if (type === 'record' && state.recordsUsed >= cfg.freeRecordsLimit) throw bad(402, 'Free plan limit reached. Upgrade to Pro to keep adding reports.');
  if (type === 'ai' && state.aiUsed >= cfg.freeAiLimit) throw bad(402, 'Free AI limit reached. Upgrade to Pro for unlimited reads.');
  return state;
};
const recordOf = (id, uid) => db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(id, uid) || (() => { throw bad(404, 'Not found'); })();
const filesOf = (id) => db.prepare('SELECT * FROM record_files WHERE record_id = ? ORDER BY position').all(id);
const MAX_FILES = 10, MAX_TOTAL = 40 * 1024 * 1024;
function requireFiles(list) {
  if (!list || !list.length) throw bad(400, 'No file uploaded');
  let total = 0;
  return list.map((f) => { total += f.size; if (total > MAX_TOTAL) throw bad(413, 'Total upload too large (max 40 MB)'); return { buf: f.buffer, mime: requireFile(f), name: f.originalname }; });
}
function storeFiles(recordId, files) {
  const pos = db.prepare('SELECT COUNT(*) c FROM record_files WHERE record_id = ?').get(recordId).c;
  if (pos + files.length > MAX_FILES) throw bad(400, `A record can have at most ${MAX_FILES} files`);
  files.forEach((f, i) => {
    const id = crypto.randomUUID(), p = path.join(cfg.dataDir, 'files', id + '.enc');
    fs.writeFileSync(p, encrypt(f.buf), { mode: 0o600 });
    db.prepare('INSERT INTO record_files (id, record_id, name, mime, path, position) VALUES (?,?,?,?,?,?)').run(id, recordId, cleanName(f.name), f.mime, p, pos + i);
  });
}
const rmFiles = (rows) => rows.forEach((r) => fs.rmSync(r.path, { force: true }));

// ---------- auth ----------
app.get('/healthz', (_q, res) => res.json({ ok: true }));

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  if (!cfg.allowRegistration) throw bad(403, 'Registration is closed');
  const email = String(req.body.email || '').trim().toLowerCase();
  const pw = String(req.body.password || '');
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email)) throw bad(400, 'Enter a valid email');
  if (pw.length < 10 || pw.length > 200) throw bad(400, 'Password must be 10–200 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad(409, 'An account with this email already exists');
  const user = { id: crypto.randomUUID(), email, token_version: 0 };
  db.prepare('INSERT INTO users (id, email, pw_hash, created_at) VALUES (?,?,?,?)').run(user.id, email, await bcrypt.hash(pw, 12), Date.now());
  setSession(res, user);
  res.status(201).json({ email });
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = await bcrypt.compare(String(req.body.password || ''), u ? u.pw_hash : DUMMY_HASH);
  if (!u || !ok) throw bad(401, 'Incorrect email or password');
  setSession(res, u);
  res.json({ email: u.email });
}));

app.post('/api/auth/logout', (_q, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

app.get('/api/app-config', (_req, res) => {
  res.json({
    publicAccessRequired: cfg.publicAccessMode === 'required' && !!cfg.publicAccessKey,
    publicAccessConfigured: !!cfg.publicAccessKey,
    publicAccessMode: cfg.publicAccessMode,
    freeRecordsLimit: cfg.freeRecordsLimit,
    freeAiLimit: cfg.freeAiLimit,
    proUpgradeCodeConfigured: !!cfg.proUpgradeCode,
    stripeEnabled: stripeReady(),
    billingProvider: stripeReady() ? 'stripe' : 'manual',
  });
});

app.get('/api/me', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const state = getUserState(u);
  res.json({ email: u.email, plan: state.plan, aiEnabled: ai.aiEnabled, categories: CATEGORIES, maxUploadMb: cfg.maxUploadMb, recordsUsed: state.recordsUsed, recordsLimit: state.recordsLimit, aiUsed: state.aiUsed, aiLimit: state.aiLimit, stripeEnabled: stripeReady(), billingProvider: stripeReady() ? 'stripe' : 'manual' });
});

app.get('/api/plan', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json(getUserState(u));
});

app.get('/api/billing/config', auth, (_req, res) => {
  res.json({
    provider: stripeReady() ? 'stripe' : 'manual',
    stripeEnabled: stripeReady(),
    proUpgradeCodeConfigured: !!cfg.proUpgradeCode,
    priceId: cfg.stripePriceId || null,
  });
});

app.post('/api/billing/checkout', auth, wrap(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.plan === 'pro') return res.json({ ok: true, plan: 'pro', url: null });
  if (!stripeReady()) throw bad(501, 'Stripe checkout is not configured yet. Use the manual upgrade code instead.');
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: cfg.stripePriceId, quantity: 1 }],
    success_url: `${cfg.stripeSuccessUrl}${cfg.stripeSuccessUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${cfg.stripeCancelUrl}${cfg.stripeCancelUrl.includes('?') ? '&' : '?'}source=checkout_cancel`,
    customer_email: user.email,
    metadata: { user_id: user.id, plan: 'pro' },
    allow_promotion_codes: true,
  });
  res.json({ ok: true, plan: 'free', url: session.url });
}));

app.post('/api/billing/checkout/complete', auth, wrap(async (req, res) => {
  const sessionId = String(req.body.session_id || '').trim();
  if (!sessionId) throw bad(400, 'Missing Stripe session id');
  if (!stripeReady()) throw bad(501, 'Stripe checkout is not configured yet.');
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') throw bad(402, 'Payment has not been completed yet.');
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run('pro', req.user.id);
  res.json({ ok: true, plan: 'pro', sessionId: session.id });
}));

app.post('/api/billing/upgrade', auth, wrap(async (req, res) => {
  const code = String(req.body.code || '').trim();
  const isValid = code && code === cfg.proUpgradeCode;
  if (!isValid) throw bad(400, 'Invalid upgrade code');
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run('pro', req.user.id);
  res.json({ ok: true, plan: 'pro' });
}));

app.post('/api/auth/password', auth, authLimiter, wrap(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(String(req.body.current || ''), u.pw_hash))) throw bad(401, 'Current password is incorrect');
  const pw = String(req.body.next || '');
  if (pw.length < 10 || pw.length > 200) throw bad(400, 'New password must be 10–200 characters');
  db.prepare('UPDATE users SET pw_hash = ?, token_version = token_version + 1 WHERE id = ?').run(await bcrypt.hash(pw, 12), u.id);
  setSession(res, { id: u.id, token_version: u.token_version + 1 }); // signs out all other sessions
  res.json({ ok: true });
}));

app.delete('/api/me', auth, authLimiter, wrap(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(String(req.body.password || ''), u.pw_hash))) throw bad(401, 'Password is incorrect');
  rmFiles(db.prepare('SELECT f.path FROM record_files f JOIN records r ON r.id = f.record_id WHERE r.user_id = ?').all(u.id));
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

// ---------- records ----------
app.get('/api/records', auth, (req, res) => res.json(userRecords(req.user.id)));

function parseRecordFields(b) {
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) throw bad(400, 'Title is required');
  if (!CATEGORIES.includes(b.category)) throw bad(400, 'Invalid category');
  if (!validDate(b.date)) throw bad(400, 'Invalid date');
  let metrics = b.metrics;
  if (typeof metrics === 'string') { try { metrics = JSON.parse(metrics || '[]'); } catch { throw bad(400, 'Invalid metrics'); } }
  return {
    title,
    category: b.category,
    date: b.date,
    summary: String(b.summary || '').slice(0, 2000),
    notes: String(b.notes || '').slice(0, 8000),
    doctor_name: String(b.doctor_name || '').trim().slice(0, 200),
    lab_name: String(b.lab_name || '').trim().slice(0, 200),
    facility_name: String(b.facility_name || '').trim().slice(0, 200),
    facility_address: String(b.facility_address || '').trim().slice(0, 300),
    metrics: ai.sanitizeMetrics(metrics),
  };
}

app.post('/api/records', auth, upload.array('files', MAX_FILES), wrap(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  requirePlanAccess(user, 'record');
  const f = parseRecordFields(req.body);
  const files = req.files?.length ? requireFiles(req.files) : [];
  const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare('INSERT INTO records (id,user_id,title,category,date,summary,notes,doctor_name,lab_name,facility_name,facility_address,metrics,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, req.user.id, f.title, f.category, f.date, f.summary, f.notes, f.doctor_name, f.lab_name, f.facility_name, f.facility_address, JSON.stringify(f.metrics), Date.now());
    storeFiles(id, files);
  })();
  res.status(201).json({ id });
}));

app.put('/api/records/:id', auth, wrap(async (req, res) => {
  const f = parseRecordFields(req.body); recordOf(req.params.id, req.user.id);
  db.prepare('UPDATE records SET title=?, category=?, date=?, summary=?, notes=?, doctor_name=?, lab_name=?, facility_name=?, facility_address=?, metrics=? WHERE id=? AND user_id=?')
    .run(f.title, f.category, f.date, f.summary, f.notes, f.doctor_name, f.lab_name, f.facility_name, f.facility_address, JSON.stringify(f.metrics), req.params.id, req.user.id);
  res.json({ ok: true });
}));

app.delete('/api/records/:id', auth, (req, res) => {
  recordOf(req.params.id, req.user.id);
  rmFiles(filesOf(req.params.id));
  db.prepare('DELETE FROM records WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.post('/api/records/:id/files', auth, upload.array('files', MAX_FILES), wrap(async (req, res) => {
  recordOf(req.params.id, req.user.id);
  storeFiles(req.params.id, requireFiles(req.files));
  res.status(201).json({ files: filesOf(req.params.id).map((f) => ({ id: f.id, name: f.name, mime: f.mime })) });
}));

app.delete('/api/records/:id/files/:fid', auth, (req, res) => {
  recordOf(req.params.id, req.user.id);
  const f = db.prepare('SELECT * FROM record_files WHERE id = ? AND record_id = ?').get(req.params.fid, req.params.id);
  if (!f) throw bad(404, 'Not found');
  rmFiles([f]); db.prepare('DELETE FROM record_files WHERE id = ?').run(f.id);
  res.json({ ok: true });
});

app.get('/api/records/:id/files/:fid', auth, (req, res) => {
  recordOf(req.params.id, req.user.id);
  const f = db.prepare('SELECT * FROM record_files WHERE id = ? AND record_id = ?').get(req.params.fid, req.params.id);
  if (!f) throw bad(404, 'Not found');
  res.set({ 'Content-Type': f.mime, 'Content-Disposition': `inline; filename="${cleanName(f.name)}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(decrypt(fs.readFileSync(f.path)));
});

app.get('/api/export', auth, (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="health-vault-export.json"');
  res.json({ exportedAt: new Date().toISOString(), records: userRecords(req.user.id) });
});

// ---------- AI ----------
app.post('/api/extract', auth, aiLimiter, upload.array('files', MAX_FILES), wrap(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  requirePlanAccess(user, 'ai');
  const files = requireFiles(req.files);
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Other';
  try {
    const payload = await ai.extract(files, category);
    db.prepare('UPDATE users SET ai_usage = ai_usage + 1 WHERE id = ?').run(req.user.id);
    res.json(payload);
  }
  catch (e) { if (e.status === 503) throw bad(503, e.message); console.error('extract failed:', e.message); throw bad(502, 'Could not read these files. You can enter the values manually.'); }
}));

app.post('/api/ask', auth, aiLimiter, wrap(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  requirePlanAccess(user, 'ai');
  const q = String(req.body.question || '').trim();
  if (!q) throw bad(400, 'Ask a question');
  const recs = userRecords(req.user.id);
  if (!recs.length) return res.json({ answer: 'You have no saved records yet. Add a report first.' });
  try {
    const answer = await ai.ask(q, recs);
    db.prepare('UPDATE users SET ai_usage = ai_usage + 1 WHERE id = ?').run(req.user.id);
    res.json({ answer });
  }
  catch (e) { if (e.status === 503) throw bad(503, e.message); console.error('ask failed:', e.message); throw bad(502, 'The AI could not answer right now.'); }
}));

// ---------- static + errors ----------
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '0',
  setHeaders: (r, p) => {
    if (p.endsWith('index.html') || p.endsWith('sw.js') || p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.svg') || p.endsWith('.json'))
      r.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));
app.use('/api', (_q, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: `Up to ${MAX_FILES} files at a time` });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (max ${cfg.maxUploadMb} MB)` });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request' });
  if (!err.expose) console.error(err);
  res.status(err.expose ? err.status : 500).json({ error: err.expose ? err.message : 'Something went wrong' });
});

if (require.main === module) {
  const server = app.listen(cfg.port, () => console.log(`Health Vault on :${cfg.port} (AI ${ai.aiEnabled ? 'on' : 'off'})`));
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
module.exports = app;
