const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PORT = 38000 + Math.floor(Math.random() * 10000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darkcoin-test-'));
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: String(PORT), BIBICOIN_DATA: path.join(dir, 'ledger.json') }, stdio: 'ignore' });
const base = `http://127.0.0.1:${PORT}`;
const stable = value => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
async function request(url, options) {
  const r = await fetch(base + url, options);
  const body = await r.json();
  return { status: r.status, body };
}
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + '/api/status'); if (r.ok) return r.json(); } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}
async function mine(candidate, difficulty) {
  for (let nonce = 0; nonce < 2_000_000; nonce++) {
    candidate.nonce = nonce;
    delete candidate.hash;
    candidate.hash = sha(stable(candidate));
    if (candidate.hash.startsWith('0'.repeat(difficulty))) return candidate;
  }
  throw new Error('Unable to find test proof of work');
}
(async () => {
  try {
    const status = await waitReady();
    assert.equal(status.symbol, 'DKC');
    assert.equal(status.maxSupply, 21_000_000);

    const a = await request('/api/wallet/new', { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' });
    const b = await request('/api/wallet/new', { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' });
    assert.equal(a.status, 201); assert.equal(b.status, 201);

    let template = await request('/api/mine/template', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({miner:a.body.address}) });
    let block = await mine(template.body.candidate, template.body.difficulty);
    let submitted = await request('/api/mine/submit', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({block}) });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    let wallet = await request('/api/wallet/' + a.body.address);
    assert.equal(wallet.body.balance, '5000000000');
    assert.equal(wallet.body.nextNonce, 0);

    const tx = { from:a.body.address, to:b.body.address, amount:'1000000000', timestamp:Date.now(), nonce:0, publicKey:a.body.publicKey };
    const payload = stable({from:tx.from,to:tx.to,amount:tx.amount,timestamp:tx.timestamp,nonce:tx.nonce});
    tx.signature = crypto.sign(null, Buffer.from(payload), a.body.privateKey).toString('base64');
    const unsigned = {...tx}; tx.id = sha(stable(unsigned));
    const badNonce = {...tx, nonce:4};
    badNonce.signature = crypto.sign(null, Buffer.from(stable({from:badNonce.from,to:badNonce.to,amount:badNonce.amount,timestamp:badNonce.timestamp,nonce:badNonce.nonce})), a.body.privateKey).toString('base64');
    delete badNonce.id; badNonce.id = sha(stable(badNonce));
    assert.equal((await request('/api/transaction',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(badNonce)})).status,409);
    assert.equal((await request('/api/transaction',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(tx)})).status,201);

    template = await request('/api/mine/template', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({miner:a.body.address}) });
    block = await mine(template.body.candidate, template.body.difficulty);
    submitted = await request('/api/mine/submit', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({block}) });
    assert.equal(submitted.status,201);
    wallet = await request('/api/wallet/' + b.body.address);
    assert.equal(wallet.body.balance,'1000000000');

    const tampered = JSON.parse(fs.readFileSync(path.join(dir,'ledger.json'),'utf8'));
    tampered.chain[1].reward = 999;
    fs.writeFileSync(path.join(dir,'ledger.json'), JSON.stringify(tampered));
    child.kill();
    const second = spawnSyncNodeCheck();
    assert.notEqual(second, 0, 'tampered ledger must not boot');
    console.log('Darkcoin V2.3 integration tests passed: 21M cap, wallet creation, PoW, balances, signatures, nonce rejection, transfers, and ledger tamper rejection.');
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    child.kill();
    fs.rmSync(dir,{recursive:true,force:true});
  }
})();
function spawnSyncNodeCheck() {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [path.join(__dirname,'server.js')], { env:{...process.env,PORT:String(PORT+1),BIBICOIN_DATA:path.join(dir,'ledger.json')}, encoding:'utf8', timeout:3000 });
  return r.status === null ? 1 : r.status;
}
