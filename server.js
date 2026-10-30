const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.BIBICOIN_DATA || path.join(__dirname, "bibicoin-data.json");
const DIFFICULTY = 3;
const INITIAL_REWARD = 50;
const HALVING_INTERVAL = 210000;
const MAX_SUPPLY = 30_000_000;
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
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(s.chain) || !Array.isArray(s.pending)) throw new Error("bad state");
    return s;
  } catch {
    const genesis = {
      height: 0, timestamp: Date.now(), previousHash: "0".repeat(64),
      nonce: 0, miner: "GENESIS", reward: 0, transactions: []
    };
    genesis.hash = sha256(stable(genesis));
    const s = { chain: [genesis], pending: [], nextNonce: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2));
    return s;
  }
}
let state = readState();
function save() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function addressFromPublicKey(publicKeyPem) {
  return "BBC" + sha256(publicKeyPem).slice(0, 40).toUpperCase();
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
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
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
function validAddress(a) { return typeof a === "string" && /^BBC[A-F0-9]{40}$/.test(a); }
function validTx(tx) {
  try {
    if (!tx || !validAddress(tx.from) || !validAddress(tx.to) || tx.from === tx.to) return false;
    if (!/^[1-9][0-9]*$/.test(String(tx.amount)) || BigInt(tx.amount) <= 0n) return false;
    if (!Number.isSafeInteger(tx.timestamp) || typeof tx.nonce !== "number") return false;
    if (typeof tx.publicKey !== "string" || typeof tx.signature !== "string") return false;
    if (addressFromPublicKey(tx.publicKey) !== tx.from) return false;
    const key = crypto.createPublicKey(tx.publicKey);
    return crypto.verify(null, Buffer.from(txPayload(tx)), key, Buffer.from(tx.signature, "base64"));
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
    name: "Bibicoin Testnet",
    symbol: "BBC",
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
async function handle(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
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
    return json(res, 200, { address, balance: balanceOf(address), transactions: transactions.reverse() });
  }
  if (req.method === "POST" && u.pathname === "/api/wallet/new") {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const address = addressFromPublicKey(publicKey);
    // The server does not store the private key. It is returned once for this testnet demo.
    return json(res, 201, { address, publicKey, privateKey, warning: "Save this private key securely. It is shown once. This is an educational testnet, not real money." });
  }
  if (req.method === "POST" && u.pathname === "/api/transaction") {
    const tx = await readBody(req);
    if (!validTx(tx)) return json(res, 400, { error: "Invalid signature or transaction fields" });
    if (allTxIds().has(tx.id)) return json(res, 409, { error: "Duplicate transaction" });
    if (BigInt(balanceOf(tx.from)) < BigInt(tx.amount)) return json(res, 400, { error: "Insufficient available balance" });
    state.pending.push(tx);
    save();
    return json(res, 201, { accepted: true, transactionId: tx.id, status: "pending" });
  }
  if (req.method === "POST" && u.pathname === "/api/mine/template") {
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
    const { block } = await readBody(req);
    if (!block || block.height !== state.chain.length) return json(res, 409, { error: "Stale block: chain tip changed. Get a new template." });
    const previous = state.chain[state.chain.length - 1];
    if (block.previousHash !== previous.hash) return json(res, 400, { error: "Previous hash mismatch" });
    if (!validAddress(block.miner) || !Number.isSafeInteger(block.nonce) || block.nonce < 0) return json(res, 400, { error: "Invalid miner or nonce" });
    if (!Array.isArray(block.transactions) || block.transactions.length > 500) return json(res, 400, { error: "Invalid transaction list" });
    const expectedReward = rewardAt(block.height);
    const capLeft = BigInt(MAX_SUPPLY) * UNIT - totalIssued();
    const expectedUnits = BigInt(Math.round(expectedReward * 1e8)) > capLeft ? capLeft : BigInt(Math.round(expectedReward * 1e8));
    if (BigInt(Math.round(block.reward * 1e8)) !== expectedUnits) return json(res, 400, { error: "Invalid block reward" });
    if (block.hash !== blockHash(block) || !block.hash.startsWith("0".repeat(DIFFICULTY))) return json(res, 400, { error: "Proof of Work or block hash invalid" });
    const pendingIds = new Set(state.pending.map(t => t.id));
    const expectedTxs = state.pending.filter(t => pendingIds.has(t.id) && validTx(t));
    const submittedIds = block.transactions.map(t => t.id);
    if (new Set(submittedIds).size !== submittedIds.length) return json(res, 400, { error: "Duplicate transactions in block" });
    const currentBalances = chainBalances();
    const spent = Object.create(null);
    for (const tx of block.transactions) {
      const pendingTx = state.pending.find(p => p.id === tx.id);
      if (!pendingTx || stable(pendingTx) !== stable(tx) || !validTx(tx)) return json(res, 400, { error: "Block contains an unapproved transaction" });
      const amount = BigInt(tx.amount);
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
server.listen(PORT, "0.0.0.0", () => console.log(`Bibicoin Testnet listening on ${PORT}`));
