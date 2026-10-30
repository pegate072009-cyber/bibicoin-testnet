# Bibicoin Testnet MVP

This is an educational **public testnet starter**, not a real-money cryptocurrency and not yet a decentralized peer-to-peer blockchain.

## What is included
- Node.js HTTP server with a persistent JSON ledger (`bibicoin-data.json`)
- Browser-created wallets (Ed25519 key pair; server returns the private key once and does not store it)
- Signed BBC transfers
- SHA-256 proof-of-work browser mining
- Server-side checks for transaction signatures, balances, block hashes, difficulty, reward schedule, and previous-block link
- Block and transaction explorer

## Token rules in this prototype
- Symbol: BBC
- Maximum supply cap: 30,000,000 BBC
- Initial reward: 50 BBC
- Halving interval: 210,000 blocks
- Smallest unit: 0.00000001 BBC
- Difficulty: 3 leading hexadecimal zeroes (fixed for this prototype)

**Supply note:** With a 50 BBC starting reward and a 210,000-block halving interval, the geometric reward schedule issues about 21 million BBC before integer rounding, so 30 million is a cap, not a promise that all 30 million will be mined.

## Run locally
Requires Node.js 18 or newer. No npm packages are required.

```bash
npm start
```

Open `http://localhost:3000`.

## Deploy online
Deploy this folder to a Node.js hosting provider that supports:
- Node.js 18+
- a persistent writable disk/volume for `bibicoin-data.json`
- HTTPS
- long-running Node.js web services

Set the start command to `npm start`. The provider should assign the `PORT` environment variable automatically.

Do not deploy on a static-only hosting service. If the host has ephemeral storage, the chain file can be lost on restart; attach a persistent disk or replace the JSON store with a managed database before public use.

## Test across devices
1. Deploy the app and open its HTTPS URL on Phone A.
2. Create a wallet and securely back up its private key.
3. Open the same URL on Phone B and create another wallet.
4. On Phone A, mine blocks to earn BBC.
5. Copy Phone B's address and send BBC from Phone A.
6. Mine another block. Phone B should see the confirmed incoming transfer after refresh.

## Important limitations
- One hosted server currently owns the canonical ledger. Devices are browser wallets/miners, **not independent full nodes**.
- There is no peer discovery, P2P gossip, independent chain selection, reorganization handling, or distributed consensus yet.
- The server is a central point of failure and can censor or lose data.
- Private keys are stored in browser localStorage for convenience in this demo. Anyone with access to that browser profile may be able to extract them. Do not use a valuable or reused key.
- Fixed difficulty is intentionally low for learning and is not secure.
- The server's JSON ledger is a prototype storage layer, not production-grade database software.
- No real money, exchange listing, or financial value is involved.

## Next engineering stages
1. Replace JSON file storage with SQLite/PostgreSQL and atomic transactions.
2. Add rate limits, request size limits, audit logging, backups, and robust tests.
3. Build independent node software and authenticated peer-to-peer synchronization.
4. Add chain-work selection and reorganization support.
5. Add testnet reset/genesis configuration and a proper command-line node.
