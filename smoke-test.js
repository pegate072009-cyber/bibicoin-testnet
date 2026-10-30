const assert = require("assert");
const crypto = require("crypto");
const hash = s => crypto.createHash("sha256").update(s).digest("hex");
assert.equal(hash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
console.log("Basic SHA-256 smoke test passed. Start the server with: npm start");
