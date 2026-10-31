const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.BIBICOIN_DATA || path.join(__dirname, "bibicoin-data.json");
const DIFFICULTY = 3;
const INITIAL_REWARD = 50;
const HALVING_INTERVAL = 210000;
const MAX_SUPPLY = 21_000_000;
const UNIT = 100_000_000n;
const PUBLIC_DIR = path.join(__dirname, "public");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}
function txPayload(tx) {
  return stable({ from: tx.from, to: tx.to, amount: tx.amount, timestamp: tx.timestamp, nonce: tx.nonce });
}
function rewardAt(height) {
  const halvings = Math.floor(height / HALVING_INTERVAL);
  if (halvings >= 53) return 0;
  return INITIAL_REWARD / (2 ** halvings);
}
function createGenesisState() {
  const genesis = {
    height: 0, timestamp: Date.now(), previousHash: "0".repeat(64),
    nonce: 0, miner: "GENESIS", reward: 0, transactions: []
  };
  genesis.hash = sha256(stable(genesis));
  return { chain: [genesis], pending: [], nextNonce: {} };
}
function validateChain(candidate) {
  if (!candidate || !Array.isArray(candidate.chain) || candidate.chain.length < 1 || !Array.isArray(candidate.pending)) throw new Error("Invalid ledger structure");
  const chain = candidate.chain;
  const seen = new Set();
  const balances = Object.create(null);
  let issued = 0n;
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i];
    if (!b || b.height !== i || !Number.isSafeInteger(b.timestamp) || !Number.isSafeInteger(b.nonce) || !Array.isArray(b.transactions)) throw new Error(`Invalid block structure at height ${i}`);
    if (i === 0) {
      if (b.previousHash !== "0".repeat(64) || b.miner !== "GENESIS" || b.reward !== 0 || b.transactions.length !== 0 || b.hash !== blockHash(b)) throw new Error("Invalid genesis block");
      continue;
    }
    const prev = chain[i - 1];
    if (b.previousHash !== prev.hash || b.hash !== blockHash(b) || !b.hash.startsWith("0".repeat(DIFFICULTY))) throw new Error(`Invalid block link, hash, or proof of work at height ${i}`);
    if (!validAddress(b.miner) || !Number.isFinite(b.reward) || b.reward < 0) throw new Error(`Invalid miner or reward at height ${i}`);
    const capLeft = BigInt(MAX_SUPPLY) * UNIT - issued;
    const expected = BigInt(Math.round(rewardAt(i) * 1e8)) > capLeft ? capLeft : BigInt(Math.round(rewardAt(i) * 1e8));
    const rewardUnits = BigInt(Math.round(b.reward * 1e8));
    if (rewardUnits !== expected) throw new Error(`Invalid subsidy at height ${i}`);
    issued += rewardUnits;
    const spent = Object.create(null);
    for (const tx of b.transactions) {
      if (!validTx(tx) || seen.has(tx.id)) throw new Error(`Invalid or duplicate transaction at height ${i}`);
      const expectedNonce = (balances[tx.from + ":nonce"] || 0);
      if (tx.nonce !== expectedNonce) throw new Error(`Invalid transaction nonce at height ${i}`);
      const amount = BigInt(tx.amount);
      if ((balances[tx.from] || 0n) - (spent[tx.from] || 0n) < amount) throw new Error(`Overspending transaction at height ${i}`);
      spent[tx.from] = (spent[tx.from] || 0n) + amount;
      balances[tx.from] = (balances[tx.from] || 0n) - amount;
      balances[tx.to] = (balances[tx.to] || 0n) + amount;
      balances[tx.from + ":nonce"] = expectedNonce + 1;
      seen.add(tx.id);
    }
    balances[b.miner] = (balances[b.miner] || 0n) + rewardUnits;
  }
  const pendingSpent = Object.create(null);
  const pendingNonce = Object.create(null);
  for (const tx of candidate.pending) {
    if (!validTx(tx) || seen.has(tx.id)) throw new Error("Invalid or duplicate pending transaction");
    if (pendingNonce[tx.from] === undefined) pendingNonce[tx.from] = chain.reduce((n,b) => n + b.transactions.filter(t => t.from === tx.from).length, 0);
    if (tx.nonce !== pendingNonce[tx.from]++) throw new Error("Invalid pending transaction nonce sequence");
    const amount = BigInt(tx.amount);
    if ((balances[tx.from] || 0n) - (pendingSpent[tx.from] || 0n) < amount) throw new Error("Pending transactions overspend wallet balance");
    pendingSpent[tx.from] = (pendingSpent[tx.from] || 0n) + amount;
    seen.add(tx.id);
  }
  if (issued > BigInt(MAX_SUPPLY) * UNIT) throw new Error("Maximum supply exceeded");
}
function readState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const s = JSON.parse(raw);
    validateChain(s);
    return s;
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Ledger file is present but invalid. Refusing to reset it:", err.message);
      throw new Error("Darkcoin ledger is invalid; refusing to overwrite existing data.");
    }
    const s = createGenesisState();
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2), { flag: "wx" });
    return s;
  }
}
let state = readState();
function save() {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  const fd = fs.openSync(tmp, "w", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, DATA_FILE);
}
function addressFromPublicKey(publicKeyPem) {
  return "DKC" + sha256(publicKeyPem).slice(0, 40).toUpperCase();
}
function chainBalances() {
  const b = Object.create(null);
  for (const block of state.chain) {
    if (block.miner && block.miner !== "GENESIS" && block.reward > 0) {
      b[block.miner] = (b[block.miner] || 0n) + BigInt(Math.round(block.reward * 1e8));
    }
    for (const tx of block.transactions || []) {
      const amount = BigInt(tx.amount);
      b[tx.from] = (b[tx.from] || 0n) - amount;
      b[tx.to] = (b[tx.to] || 0n) + amount;
    }
  }
  return b;
}
function pendingSpend(address) {
  return state.pending.filter(t => t.from === address)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n);
}
function balanceOf(address) {
  const b = chainBalances();
  return ((b[address] || 0n) - pendingSpend(address)).toString();
}
function totalIssued() {
  return state.chain.reduce((s, b) => s + BigInt(Math.round((b.reward || 0) * 1e8)), 0n);
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 256_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
function validAddress(a) { return typeof a === "string" && /^DKC[A-F0-9]{40}$/.test(a); }
function validTx(tx) {
  try {
    if (!tx || typeof tx !== "object" || Array.isArray(tx)) return false;
    const allowedKeys = ["amount", "from", "id", "nonce", "publicKey", "signature", "timestamp", "to"];
    if (Object.keys(tx).sort().join("|") !== allowedKeys.sort().join("|")) return false;
    if (!validAddress(tx.from) || !validAddress(tx.to) || tx.from === tx.to) return false;
    if (typeof tx.amount !== "string" || !/^[1-9][0-9]*$/.test(tx.amount) || BigInt(tx.amount) <= 0n) return false;
    if (!Number.isSafeInteger(tx.timestamp) || tx.timestamp < 0) return false;
    if (!Number.isSafeInteger(tx.nonce) || tx.nonce < 0) return false;
    if (typeof tx.publicKey !== "string" || tx.publicKey.length > 2048) return false;
    if (typeof tx.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(tx.signature)) return false;
    if (typeof tx.id !== "string" || !/^[a-f0-9]{64}$/.test(tx.id)) return false;
    if (addressFromPublicKey(tx.publicKey) !== tx.from) return false;
    const key = crypto.createPublicKey(tx.publicKey);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const signatureValid = crypto.verify(null, Buffer.from(txPayload(tx)), key, Buffer.from(tx.signature, "base64"));
    if (!signatureValid) return false;
    const unsignedIdPayload = { ...tx };
    delete unsignedIdPayload.id;
    return sha256(stable(unsignedIdPayload)) === tx.id;
  } catch { return false; }
}
function blockHash(block) {
  const copy = { ...block };
  delete copy.hash;
  return sha256(stable(copy));
}
function allTxIds() {
  const ids = new Set();
  for (const b of state.chain) for (const t of b.transactions || []) ids.add(t.id);
  for (const t of state.pending) ids.add(t.id);
  return ids;
}
function chainSummary() {
  return {
    name: "Darkcoin Testnet",
    symbol: "DKC",
    height: state.chain.length - 1,
    latestHash: state.chain[state.chain.length - 1].hash,
    difficulty: DIFFICULTY,
    reward: rewardAt(state.chain.length),
    halvingInterval: HALVING_INTERVAL,
    maxSupply: MAX_SUPPLY,
    issued: Number(totalIssued()) / 1e8,
    pendingTransactions: state.pending.length,
    peers: 1,
    mode: "single-hosted-node testnet"
  };
}
const rateBuckets = new Map();
function rateLimit(req, res, bucketName, limit, windowMs) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.socket.remoteAddress || "unknown";
  const key = bucketName + ":" + ip;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 10000) {
    for (const [k, v] of rateBuckets) if (now - v.start > windowMs * 2) rateBuckets.delete(k);
  }
  if (bucket.count > limit) {
    json(res, 429, { error: "Too many requests. Please wait and try again." });
    return false;
  }
  return true;
}
async function handle(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Cache-Control": "no-store", "Allow": "GET, POST, OPTIONS" });
    return res.end();
  }
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && u.pathname === "/api/status") return json(res, 200, chainSummary());
  if (req.method === "GET" && u.pathname === "/api/blocks") {
    const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") || 20)));
    return json(res, 200, state.chain.slice(-limit).reverse());
  }
  if (req.method === "GET" && u.pathname.startsWith("/api/block/")) {
    const height = Number(u.pathname.split("/").pop());
    const block = state.chain[height];
    return block ? json(res, 200, block) : json(res, 404, { error: "Block not found" });
  }
  if (req.method === "GET" && u.pathname === "/api/transactions") {
    const confirmed = [];
    for (const b of state.chain) for (const t of b.transactions || []) confirmed.push({ ...t, blockHeight: b.height });
    return json(res, 200, { confirmed: confirmed.slice(-100).reverse(), pending: state.pending.slice().reverse() });
  }
  if (req.method === "GET" && u.pathname.startsWith("/api/wallet/")) {
    const address = u.pathname.split("/").pop().toUpperCase();
    if (!validAddress(address)) return json(res, 400, { error: "Invalid wallet address" });
    const transactions = [];
    for (const b of state.chain) for (const t of b.transactions || []) {
      if (t.from === address || t.to === address) transactions.push({ ...t, blockHeight: b.height });
    }
    const confirmedNonce = state.chain.reduce((n, b) => n + b.transactions.filter(t => t.from === address).length, 0);
    const pendingNonces = state.pending.filter(t => t.from === address).map(t => t.nonce);
    const nextNonce = pendingNonces.length ? Math.max(confirmedNonce, ...pendingNonces) + 1 : confirmedNonce;
    return json(res, 200, { address, balance: balanceOf(address), nextNonce, transactions: transactions.reverse() });
  }
  if (req.method === "POST" && u.pathname === "/api/wallet/new") {
    if (!rateLimit(req, res, "wallet", 8, 60 * 60 * 1000)) return;
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const address = addressFromPublicKey(publicKey);
    // The server does not store the private key. It is returned once for this testnet demo.
    return json(res, 201, { address, publicKey, privateKey, warning: "Save this private key securely. It is shown once. This is an educational testnet, not real money." });
  }
  if (req.method === "POST" && u.pathname === "/api/transaction") {
    if (!rateLimit(req, res, "transaction", 30, 60 * 1000)) return;
    const tx = await readBody(req);
    if (state.pending.length >= 5000) return json(res, 429, { error: "Pending transaction pool is full. Try again later." });
    if (!validTx(tx)) return json(res, 400, { error: "Invalid signature or transaction fields" });
    if (allTxIds().has(tx.id)) return json(res, 409, { error: "Duplicate transaction" });
    const confirmedNonce = state.chain.reduce((n, b) => n + b.transactions.filter(t => t.from === tx.from).length, 0);
    const pendingFrom = state.pending.filter(t => t.from === tx.from).sort((a,b) => a.nonce-b.nonce);
    const expectedNonce = pendingFrom.length ? pendingFrom[pendingFrom.length - 1].nonce + 1 : confirmedNonce;
    if (tx.nonce !== expectedNonce) return json(res, 409, { error: `Invalid nonce. Expected ${expectedNonce}. Refresh wallet and retry.` });
    if (BigInt(balanceOf(tx.from)) < BigInt(tx.amount)) return json(res, 400, { error: "Insufficient available balance" });
    state.pending.push(tx);
    save();
    return json(res, 201, { accepted: true, transactionId: tx.id, status: "pending" });
  }
  if (req.method === "POST" && u.pathname === "/api/mine/template") {
    if (!rateLimit(req, res, "mine-template", 30, 60 * 1000)) return;
    const { miner } = await readBody(req);
    if (!validAddress(miner)) return json(res, 400, { error: "Invalid miner address" });
    const height = state.chain.length;
    const reward = rewardAt(height);
    const capLeft = BigInt(MAX_SUPPLY) * UNIT - totalIssued();
    const rewardUnits = BigInt(Math.round(reward * 1e8));
    const actualRewardUnits = rewardUnits > capLeft ? capLeft : rewardUnits;
    const txs = [];
    const running = chainBalances();
    const spent = Object.create(null);
    for (const tx of state.pending) {
      const amount = BigInt(tx.amount);
      const available = (running[tx.from] || 0n) - (spent[tx.from] || 0n);
      if (available >= amount && validTx(tx)) {
        txs.push(tx);
        spent[tx.from] = (spent[tx.from] || 0n) + amount;
      }
    }
    const previousHash = state.chain[state.chain.length - 1].hash;
    const candidate = {
      height, timestamp: Date.now(), previousHash, nonce: 0,
      miner, reward: Number(actualRewardUnits) / 1e8, transactions: txs
    };
    return json(res, 200, { candidate, difficulty: DIFFICULTY });
  }
  if (req.method === "POST" && u.pathname === "/api/mine/submit") {
    if (!rateLimit(req, res, "mine-submit", 20, 60 * 1000)) return;
    const { block } = await readBody(req);
    if (!block || block.height !== state.chain.length) return json(res, 409, { error: "Stale block: chain tip changed. Get a new template." });
    const previous = state.chain[state.chain.length - 1];
    if (block.previousHash !== previous.hash) return json(res, 400, { error: "Previous hash mismatch" });
    if (!validAddress(block.miner) || !Number.isSafeInteger(block.nonce) || block.nonce < 0 || !Number.isSafeInteger(block.timestamp) || block.timestamp < previous.timestamp || block.timestamp > Date.now() + 120000) return json(res, 400, { error: "Invalid miner, timestamp or nonce" });
    if (!Array.isArray(block.transactions) || block.transactions.length > 500) return json(res, 400, { error: "Invalid transaction list" });
    const expectedReward = rewardAt(block.height);
    const capLeft = BigInt(MAX_SUPPLY) * UNIT - totalIssued();
    const expectedUnits = BigInt(Math.round(expectedReward * 1e8)) > capLeft ? capLeft : BigInt(Math.round(expectedReward * 1e8));
    if (BigInt(Math.round(block.reward * 1e8)) !== expectedUnits) return json(res, 400, { error: "Invalid block reward" });
    if (block.hash !== blockHash(block) || !block.hash.startsWith("0".repeat(DIFFICULTY))) return json(res, 400, { error: "Proof of Work or block hash invalid" });
    const submittedIds = block.transactions.map(t => t.id);
    if (new Set(submittedIds).size !== submittedIds.length) return json(res, 400, { error: "Duplicate transactions in block" });
    const currentBalances = chainBalances();
    const spent = Object.create(null);
    const expectedNonces = Object.create(null);
    for (const tx of block.transactions) {
      const pendingTx = state.pending.find(p => p.id === tx.id);
      if (!pendingTx || stable(pendingTx) !== stable(tx) || !validTx(tx)) return json(res, 400, { error: "Block contains an unapproved transaction" });
      const amount = BigInt(tx.amount);
      if (expectedNonces[tx.from] === undefined) expectedNonces[tx.from] = state.chain.reduce((n,b) => n + b.transactions.filter(t => t.from === tx.from).length, 0);
      if (tx.nonce !== expectedNonces[tx.from]++) return json(res, 400, { error: "Invalid transaction nonce ordering" });
      const available = (currentBalances[tx.from] || 0n) - (spent[tx.from] || 0n);
      if (available < amount) return json(res, 400, { error: "Block contains overspending" });
      spent[tx.from] = (spent[tx.from] || 0n) + amount;
    }
    const accepted = { ...block };
    state.chain.push(accepted);
    const included = new Set(submittedIds);
    state.pending = state.pending.filter(t => !included.has(t.id));
    save();
    return json(res, 201, { accepted: true, height: accepted.height, hash: accepted.hash });
  }
  if (req.method === "GET") {
    let file = u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname.slice(1));
    const full = path.resolve(PUBLIC_DIR, file);
    if (!full.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return json(res, 404, { error: "Not found" });
    const ext = path.extname(full);
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    return fs.createReadStream(full).pipe(res);
  }
  return json(res, 404, { error: "Not found" });
}
const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "Server error" });
    else res.end();
  });
});
server.listen(PORT, "0.0.0.0", () => console.log(`Darkcoin Testnet listening on ${PORT}`));
