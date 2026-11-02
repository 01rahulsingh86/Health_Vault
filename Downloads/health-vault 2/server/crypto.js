const crypto = require('crypto');
const { encKey } = require('./config');

// Layout: iv(12) | authTag(16) | ciphertext  (AES-256-GCM)
exports.encrypt = (buf) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
};

exports.decrypt = (buf) => {
  const d = crypto.createDecipheriv('aes-256-gcm', encKey, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
};
