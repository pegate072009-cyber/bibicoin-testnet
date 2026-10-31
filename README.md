# Darkcoin (DKC) V2.5 — educational testnet explorer + paper exchange

This is a single-hosted-node educational blockchain demo with a browser-local paper exchange. DKC has no real monetary value. It is not a production cryptocurrency and is not Bitcoin-compatible. The paper exchange uses simulated prices and demo credits only.

## V2.5 changes
- Expanded the blockchain explorer with chain height, issued supply, pending transaction metrics, block timestamps, and search by block height or transaction ID.
- Added clearer network architecture reporting: one hosted server, no peer-to-peer node discovery, and no independent multi-node consensus. Browser sessions are not counted as network nodes.
- Explorer searches use the existing block and recent-transaction APIs; transaction search is limited to the server's available recent transaction index.
- No real trading, external price feed, deposits, withdrawals, or decentralized peer network were added.

## V2.4 changes
- Added a browser-local DKC/USD paper exchange with a simulated price chart, simulated high/low/volume, demo USD credits, demo DKC holdings, market orders, limit orders, generated bid/ask book, open-order cancellation, trade history, and portfolio reset.
- Paper exchange data is stored in this browser localStorage and is not connected to the blockchain ledger or any external market. The displayed price is simulated and is not a real DKC/USD quote.
- No deposits, withdrawals, external exchange connectivity, or real-money trading are implemented.

## V2.3 changes
- Standardized the demo coin symbol to DKC and maximum supply cap to 21,000,000 DKC.
- Added startup validation for genesis, block links, block hashes, proof of work, subsidy schedule, transaction signatures/IDs, duplicate transactions, transaction nonces, balances, and pending transactions. Invalid ledgers fail closed rather than being silently reset.
- Added sequential per-wallet transaction nonce enforcement to reduce replay/duplicate-order problems.
- Made ledger writes atomic with restrictive file permissions and fsync before rename.
- New browser-created wallets encrypt the private key at rest using PBKDF2-SHA256 (310,000 iterations) and AES-256-GCM. Passwords are never sent to the server.
- Replaced the former illustrative balance chart with a chart derived from the available block history.
- Replaced unit-only tests with server integration tests covering wallet creation, mining, transfers, nonce rejection, balances, and tampered-ledger rejection.

## Run locally
Requires Node.js 18 or later.

```bash
npm test
npm start
```

Open `http://localhost:3000`. Use HTTPS when hosted publicly.

## Persistent hosting storage
The ledger defaults to `./bibicoin-data.json`. Set `BIBICOIN_DATA` to a path on a persistent disk mounted by your host, for example `/var/data/darkcoin-data.json`. Attach/configure the persistent disk in your hosting provider first. Back up this file regularly. Do not assume an ephemeral container filesystem is persistent.

## Important migration note
V2.3 uses DKC addresses and validates a 21-million cap. Existing V1/V2 ledger files created with BBC addresses or a 30-million cap will fail validation. Back up the old file before starting V2.3 and use a new empty ledger path for this educational testnet. This does not migrate old balances.

## Wallet security limitations
The wallet encryption is browser-side encryption at rest, not a full account/password authentication system. Anyone who knows the wallet password and has the encrypted browser backup can unlock it. If the password is lost, the encrypted key cannot be recovered; keep a secure offline backup of the private key. Older wallets saved by earlier versions may still contain plaintext private keys in browser localStorage. Remove those old records only after securely backing up the keys, or create new wallets.

The server returns a newly generated private key once over the API; deploy behind HTTPS only. Do not use real funds, personal passwords, or valuable keys. This code has not undergone an independent security audit.

## Consensus and decentralization limitations
This remains one server with fixed difficulty and a simple proof-of-work rule. It has no P2P network, independent peer consensus, cumulative chainwork fork choice, production retargeting, UTXO set, script system, coinbase maturity, or robust production mempool. Multiple app sessions connected to this server are not independent blockchain nodes.
