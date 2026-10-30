# Bibicoin Testnet — Security Update 1.1

Educational cryptocurrency test network. BBC has no monetary value. Do not use real funds, real payment credentials, or keys reused elsewhere.

## Run

- Node.js 18 or newer
- `npm start`
- Open `http://localhost:3000`
- Run the basic cryptographic smoke tests with `npm test`

## Deploying

Deploy as a Node.js Web Service. Build command: `npm install` (there are no third-party runtime dependencies). Start command: `npm start`. The app serves its frontend from `public/index.html`.

## Security improvements in 1.1

- Transaction IDs are recomputed by the server from the signed transaction fields and signature. Altered transaction data or a forged transaction ID is rejected.
- Ed25519 key type, signature format, address, amount, timestamp, and nonce are validated.
- The browser renders explorer and transaction data using DOM text nodes rather than interpolating untrusted values into HTML.
- Basic per-IP rate limits protect wallet creation, transaction submission, and mining endpoints.
- Pending transaction pool has a size cap and JSON request bodies are limited to 256 KB.
- Existing malformed ledger files now cause a startup error instead of silently creating a new genesis ledger and overwriting the prior state.
- Basic browser security headers are sent with responses.

## Important limitations

This remains a single-server educational testnet, not a decentralized blockchain and not suitable for real money. Private keys are still stored in this demo browser's localStorage; anyone with access to the browser profile or a future same-origin script compromise may be able to access them. Use a newly created test wallet only, and never reuse a real-world password or private key.

The ledger is stored in a local JSON file. Hosting providers may use ephemeral filesystems, so the chain can be lost after a restart or redeploy unless persistent storage is configured. Configure a persistent disk or a proper database before relying on continuity. Back up test data separately.

Rate limiting is in-memory and per process; it is not a substitute for an API gateway or distributed abuse protection. The project has no independent peer nodes, consensus fork choice, validator set, formal audit, or production-grade key management.
