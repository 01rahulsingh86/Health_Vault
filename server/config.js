const path = require('path');
const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';

function need(name) {
  const v = process.env[name];
  if (!v) {
    if (isProd) { console.error(`FATAL: ${name} is required in production`); process.exit(1); }
    return null;
  }
  return v;
}

// 32-byte key used to encrypt stored files. Generate: openssl rand -base64 32
let encKey = need('ENC_KEY');
encKey = encKey ? Buffer.from(encKey, 'base64') : crypto.randomBytes(32);
if (encKey.length !== 32) { console.error('FATAL: ENC_KEY must be 32 bytes, base64-encoded'); process.exit(1); }

const defaultDataDir = isProd ? '/data' : path.resolve(process.cwd(), 'data');

module.exports = {
  isProd,
  port: +process.env.PORT || 3000,
  dataDir: path.resolve(process.env.DATA_DIR || defaultDataDir),
  jwtSecret: need('JWT_SECRET') || crypto.randomBytes(32).toString('hex'),
  encKey,
  anthropicKey: process.env.ANTHROPIC_API_KEY || null,
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  maxUploadMb: +process.env.MAX_UPLOAD_MB || 15,
  trustProxy: process.env.TRUST_PROXY || (isProd ? '1' : false),
  freeRecordsLimit: +process.env.FREE_RECORD_LIMIT || 3,
  freeAiLimit: +process.env.FREE_AI_LIMIT || 5,
  proUpgradeCode: process.env.PRO_UPGRADE_CODE || 'pro-demo-2026',
  publicAccessMode: (process.env.PUBLIC_ACCESS_MODE || 'off').toLowerCase(),
  publicAccessKey: process.env.PUBLIC_ACCESS_KEY || null,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || null,
  stripePriceId: process.env.STRIPE_PRICE_ID || null,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
  stripeSuccessUrl: process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/?billing=success',
  stripeCancelUrl: process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/?billing=cancelled',
};
