# TON Lottery Parser

A TypeScript/Node.js CLI tool that fetches **all** NFT-minting traces from a TON smart-contract lottery on Testnet, parses them for mint events and prize wins, and appends structured records into a CSV file for further analysis.

---

## Features

- **Full history**: paginates through TON Center API (`/traces`) to fetch every trace since genesis or last checkpoint.

- **Incremental updates**: remembers the last processed logical time (`lt`) and only fetches newer ones on each run.

- **NFT-mint focus**: processes only traces that include an `nft_mint` action.

- **Structured output**: appends to a CSV with these columns:

  - `participant` — wallet that minted the NFT
  - `nftAddress` — NFT item address
  - `collectionAddress` — collection contract address
  - `nftIndex` — token index
  - `timestamp` — mint time (Unix seconds)
  - `txHash` — **hex-encoded root transaction hash**
  - `lt` — logical time of the trace
  - `isWin` — `true` if the mint resulted in a prize transfer
  - `winComment` — raw TON transfer comment (e.g. `x3`, `jp`)
  - `winAmount` — prize in USDT equivalent (e.g. `700`)

- **New win logic**:

  - Prizes are detected via `ton_transfer` actions containing a comment
  - Comment → prize mapping is based on:

    | Comment | Prize |
    | ------- | ----- |
    | `x1`    | 10    |
    | `x3`    | 25    |
    | `x7`    | 50    |
    | `x20`   | 180   |
    | `x77`   | 700   |
    | `x200`  | 1800  |
    | `jp`    | 10000 |

- **Type-safe**: built in TypeScript, strict TON schema typings

- **Modular** architecture:

  - `services/tonApiService.ts` – fetches traces and maps them to structured results
  - `core/processor.ts` – coordinates fetch → parse → write → save
  - `services/csvService.ts` – appends CSV using PapaParse
  - `services/stateService.ts` – tracks last processed `lt` in `data/state.json`
  - `config/config.ts` – env-driven configuration (API key, contract address, etc.)

---

## Prerequisites

- Node.js ≥ 22 (ESM & top-level `await`)
- A TON Center **Testnet API key**
- NPM or Yarn

---

## Installation

```bash
git clone <repo-url>
cd ton-lottery-parser
npm install   # or yarn install
```

Create a `.env`:

```dotenv
TONCENTER_API_URL=https://testnet.toncenter.com/api/v3
TONCENTER_API_KEY=YOUR_TESTNET_API_KEY
TON_CONTRACT_ADDRESS=kQD4Frl7oL3vuMqTZ812zB-lRSTcrogKu6MFx3Fl3V1ieuWb
PAGE_LIMIT=50
```

---

## Usage

```bash
npm start
# or
yarn start
```

- Fetches all new NFT mints from the configured TON contract
- Appends structured data to `data/lottery.csv`
- Tracks the last `lt` in `data/state.json`

---

## CSV Output

| Column            | Description                                       |
| ----------------- | ------------------------------------------------- |
| participant       | Minting wallet address (non-bounceable, url-safe) |
| nftAddress        | NFT item address                                  |
| collectionAddress | Collection contract address                       |
| nftIndex          | NFT index within the collection                   |
| timestamp         | Unix timestamp of mint                            |
| txHash            | Root transaction hash (hex)                       |
| lt                | Logical time                                      |
| isWin             | Boolean — `true` if a prize was transferred       |
| winComment        | Comment tag on `ton_transfer`, e.g. `x77`, `jp`   |
| winAmount         | Parsed prize value (in USDT or equivalent units)  |

---

## Developer Notes

- `txHash` is now extracted from the **root trace**, not from `external_hash`
- Prize detection logic uses:

  ```ts
  if (action.type === "ton_transfer" && action.details?.comment)
  ```

  to read the comment and apply a `switch` mapping

---

## License

MIT © vdumbrava