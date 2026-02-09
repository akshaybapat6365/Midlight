# Midlight

Privacy-preserving prescription pickup demo using **Midnight Compact** contracts and **real ZK proofs** (via the Midnight proof server).

Use-case (demo):
1. A clinic registers an authorization for `(rxId, pharmacyId, patientPublicKey)` on-chain.
2. A patient redeems without revealing identity: they prove they control the patient secret key corresponding to the public key committed into the authorization.
3. A nullifier prevents double redemption.

This is intentionally a hackable reference implementation, not production logic.

## Repo Layout

- `midnight/contract/` Compact smart contract + generated ZK assets (generated into `src/managed/**`).
- `services/prover/` Node.js service that builds/signs/submits Midnight transactions and talks to the proof server.
- `/src/` Vite + React UI that calls the prover service.

## Prerequisites

- Node.js `>=22`
- Docker + Docker Compose
- `npm`

## Quickstart (Local Standalone Network)

1. Install deps:

```bash
npm install
```

2. Start a local Midnight node + indexer + proof server:

```bash
docker compose -f services/prover/standalone.yml up -d
```

3. Start the demo (compiles the contract + starts prover + starts web):

```bash
npm run dev:demo
```

Open the UI at `http://127.0.0.1:3000`.

Notes:
- ZK proof generation can take a long time on laptops. The UI uses background jobs (polling `/api/jobs/:id`) so the browser doesn't time out.
- If you see `Failed to connect to Proof Server: Transport error`, bump timeouts (see below).

## What’s “Real” Here

- Proof generation is done by the **Midnight proof server** (no deterministic/stub proofs).
- Transactions are created, balanced, signed, and submitted using the Midnight wallet SDKs.

## Local State

The prover service persists demo state locally:

- `services/prover/.data/state.json` contains the deployed contract address and demo secrets.
- `services/prover/midlight-private-state*` is the LevelDB-backed private state store used by midnight-js.

These paths are gitignored.

## Configuration

Prover service env vars:

- `MIDLIGHT_HTTP_TIMEOUT_MS` (default: 1 hour)
  - Used to increase the underlying Node fetch/undici timeouts for long-running `/prove` requests.
  - Example:

```bash
MIDLIGHT_HTTP_TIMEOUT_MS=$((2*60*60*1000)) npm -w services/prover run dev
```

Docker proof-server tuning (edit `services/prover/standalone.yml`, then recreate just the proof-server):

```bash
docker compose -f services/prover/standalone.yml up -d --force-recreate --no-deps proof-server
```
