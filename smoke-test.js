const crypto = require('crypto');
const assert = require('assert');
const stable = value => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const tx = { from: 'BBC' + 'A'.repeat(40), to: 'BBC' + 'B'.repeat(40), amount: '100', timestamp: 1, nonce: 1, publicKey: publicKey.export({ type: 'spki', format: 'pem' }) };
const payload = stable({ from: tx.from, to: tx.to, amount: tx.amount, timestamp: tx.timestamp, nonce: tx.nonce });
tx.signature = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64');
tx.id = hash(stable(tx));
assert.match(tx.id, /^[a-f0-9]{64}$/);
const verify = crypto.verify(null, Buffer.from(payload), publicKey, Buffer.from(tx.signature, 'base64'));
assert.equal(verify, true);
const tampered = { ...tx, amount: '101' };
assert.notEqual(hash(stable(Object.fromEntries(Object.entries(tampered).filter(([k]) => k !== 'id')))), tampered.id);
console.log('Bibicoin security smoke tests passed: SHA-256, Ed25519 signature, transaction-ID tamper detection.');
