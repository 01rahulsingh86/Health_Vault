// End-to-end smoke test: boots the app on a temp dir and exercises auth, isolation, encryption and CSRF.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-'));
process.env.PUBLIC_ACCESS_MODE = 'required';
process.env.PUBLIC_ACCESS_KEY = 'demo-public-key';
const app = require('../server/index.js');
const ai = require('../server/ai.js');

const H = { 'X-Requested-With': 'hv' };
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('SECRET-PLAINTEXT-MARKER')]);

(async () => {
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (p, o = {}, cookie) => {
    const headers = { ...(o.headers || {}), ...(process.env.PUBLIC_ACCESS_KEY ? { 'X-HealthVault-Key': process.env.PUBLIC_ACCESS_KEY } : {}), ...(cookie ? { cookie } : {}) };
    const r = await fetch(base + p, { ...o, headers });
    return { r, body: await r.clone().json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  const json = (b) => ({ method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const ok = (n) => console.log('  ✓', n);

  assert.strictEqual((await call('/healthz')).r.status, 200); ok('health');
  assert.strictEqual((await call('/api/app-config')).r.status, 200); ok('public config available');
  assert.strictEqual((await call('/api/billing/checkout', { method: 'POST', headers: H }, 'bad-cookie')).r.status, 401); ok('checkout requires login');
  assert.strictEqual((await call('/api/records')).r.status, 401); ok('unauthenticated blocked');
  assert.strictEqual((await call('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).r.status, 403); ok('CSRF header required');
  assert.strictEqual((await call('/api/auth/register', json({ email: 'a@x.com', password: 'short' }))).r.status, 400); ok('weak password rejected');

  const a = await call('/api/auth/register', json({ email: 'A@x.com', password: 'correct horse battery' })); assert.strictEqual(a.r.status, 201);
  assert.ok(/HttpOnly/i.test(a.r.headers.get('set-cookie')) && /SameSite=Strict/i.test(a.r.headers.get('set-cookie'))); ok('register + secure cookie');
  assert.strictEqual((await call('/api/auth/register', json({ email: 'a@x.com', password: 'correct horse battery' }))).r.status, 409); ok('duplicate email');
  assert.strictEqual((await call('/api/auth/login', json({ email: 'a@x.com', password: 'wrong-password-1' }))).r.status, 401); ok('bad login rejected');

  const fd = new FormData();
  fd.append('title', 'Blood test'); fd.append('category', 'Blood test'); fd.append('date', '2025-03-01'); fd.append('summary', 's');
  fd.append('doctor_name', 'Dr. S. Patel'); fd.append('lab_name', 'LabCorp'); fd.append('facility_name', 'City Family Clinic'); fd.append('facility_address', '18 Oak St, Denver, CO');
  fd.append('metrics', JSON.stringify([{ name: 'LDL', value: '118', unit: 'mg/dL', low: null, high: 100 }, { name: '', value: 1 }]));
  fd.append('files', new Blob([png], { type: 'image/png' }), 'r.png'); fd.append('files', new Blob([Buffer.from('%PDF-1.4 second page')], { type: 'application/pdf' }), 'p2.pdf');
  const c = await call('/api/records', { method: 'POST', headers: H, body: fd }, a.cookie); assert.strictEqual(c.r.status, 201);
  const rec = (await call('/api/records', {}, a.cookie)).body[0];
  assert.strictEqual(rec.metrics.length, 1); assert.strictEqual(rec.files.length, 2);
  assert.strictEqual(rec.doctor_name, 'Dr. S. Patel'); assert.strictEqual(rec.lab_name, 'LabCorp'); ok('record created with 2 files, metrics sanitized and report metadata kept');
  const fid = rec.files[0].id;

  const f = await call(`/api/records/${c.body.id}/files/${fid}`, {}, a.cookie); assert.strictEqual(f.r.status, 200);
  assert.ok(Buffer.from(await f.r.arrayBuffer()).equals(png)); ok('file round-trips');
  const enc = fs.readFileSync(path.join(process.env.DATA_DIR, 'files', fid + '.enc'));
  assert.ok(!enc.includes('SECRET-PLAINTEXT-MARKER')); ok('file encrypted at rest');

  const bad = new FormData(); bad.append('title', 't'); bad.append('category', 'Other'); bad.append('date', '2025-01-01');
  bad.append('files', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  assert.strictEqual((await call('/api/records', { method: 'POST', headers: H, body: bad }, a.cookie)).r.status, 415); ok('fake image rejected (magic bytes)');

  const b = await call('/api/auth/register', json({ email: 'b@x.com', password: 'another long password' }));
  assert.deepStrictEqual((await call('/api/records', {}, b.cookie)).body, []); ok('users isolated (list)');
  assert.strictEqual((await call(`/api/records/${c.body.id}/files/${fid}`, {}, b.cookie)).r.status, 404); ok('users isolated (file)');
  assert.strictEqual((await call(`/api/records/${c.body.id}`, { method: 'DELETE', headers: H }, b.cookie)).r.status, 404); ok('cannot delete others’ record');
  assert.ok(ai.SHAPE.includes('doctor_name') && ai.SHAPE.includes('lab_name') && ai.SHAPE.includes('facility_name') && ai.SHAPE.includes('facility_address'));
  assert.ok(ai.EXTRACT_PROMPT('Blood test', 2).includes('doctor_name') && ai.EXTRACT_PROMPT('Blood test', 2).includes('lab_name') && ai.EXTRACT_PROMPT('Blood test', 2).includes('facility_name') && ai.EXTRACT_PROMPT('Blood test', 2).includes('facility_address'));
  assert.strictEqual((await call('/api/ask', json({ question: 'hi' }), a.cookie)).r.status, 503); ok('AI degrades gracefully without key');

  const add = new FormData(); add.append('files', new Blob([png], { type: 'image/png' }), 'more.png');
  const ad = await call(`/api/records/${c.body.id}/files`, { method: 'POST', headers: H, body: add }, a.cookie);
  assert.strictEqual(ad.body.files.length, 3); ok('add another photo to existing record');
  assert.strictEqual((await call(`/api/records/${c.body.id}/files/${fid}`, { method: 'DELETE', headers: H }, a.cookie)).r.status, 200);
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'files', fid + '.enc'))); ok('remove single file from record');
  const many = new FormData(); for (let i = 0; i < 11; i++) many.append('files', new Blob([png], { type: 'image/png' }), i + '.png');
  assert.strictEqual((await call('/api/extract', { method: 'POST', headers: H, body: many }, a.cookie)).r.status, 400); ok('more than 10 files rejected');

  const pw = await call('/api/auth/password', json({ current: 'correct horse battery', next: 'brand new passphrase' }), a.cookie); assert.strictEqual(pw.r.status, 200);
  assert.strictEqual((await call('/api/records', {}, a.cookie)).r.status, 401); ok('password change revokes old sessions');

  const login = await call('/api/auth/login', json({ email: 'a@x.com', password: 'brand new passphrase' })); assert.strictEqual(login.r.status, 200);
  assert.strictEqual((await call(`/api/records/${c.body.id}`, { method: 'DELETE', headers: H }, login.cookie)).r.status, 200);
  assert.strictEqual(fs.readdirSync(path.join(process.env.DATA_DIR, 'files')).length, 0); ok('delete removes all files from disk');
  const del = await call('/api/me', { ...json({ password: 'brand new passphrase' }), method: 'DELETE' }, login.cookie); assert.strictEqual(del.r.status, 200); ok('account deletion');

  const page = await call('/'); assert.ok(page.r.headers.get('content-security-policy').includes("script-src 'self'")); ok('CSP set');
  console.log('\nAll checks passed'); srv.close(); process.exit(0);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
