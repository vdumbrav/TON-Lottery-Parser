# TON Lottery Parser

A TypeScript/Node.js CLI tool that fetches all NFT-minting traces from a TON smart-contract lottery on Testnet, parses them for mint events and prize wins, and appends structured records into a CSV file for further analysis.

---

## Features

- Full history: paginates through the TON Center API (`/traces`) to fetch every trace since genesis or last checkpoint.
- Incremental updates: tracks last processed logical time (`lt`) in `data/state.json`
- NFT-mint focus: filters only traces that include an `nft_mint` action.
- Prize logic: checks `ton_transfer` actions with matching comment to determine win amounts
- Typed and modular: fully written in TypeScript with strict schema validation
- Outputs structured data to CSV using PapaParse

---

## Modules

- `services/tonApiService.ts`: API integration with TON Center, fetches and maps traces
- `core/processor.ts`: orchestrates full run – fetch → parse → save
- `services/csvService.ts`: appends structured trace results to CSV
- `services/stateService.ts`: loads and saves last processed logical time (`lt`)
- `config/config.ts`: environment-driven configuration (API key, contract address, page limit)
- `utils/addressUtils.ts`: helper for safely parsing TON addresses

---

## Prerequisites

- Node.js ≥ 22 (ESM + top-level `await`)
- Valid TON Center API key for Testnet
- NPM or Yarn

---

## Installation

```bash
git clone <repo-url>
cd ton-lottery-parser
npm install
```

Create a `.env` file in project root:

```dotenv
TONCENTER_API_URL=https://testnet.toncenter.com/api/v3
TONCENTER_API_KEY=YOUR_TESTNET_API_KEY
TON_CONTRACT_ADDRESS=YOUR_CONTRACT_ADDRESS
PAGE_LIMIT=50
```

---

## Usage

```bash
npm start
# or
yarn start
```

On each run:

- Fetches all new traces from the configured contract
- Detects mint events and win payouts
- Appends rows to `data/lottery.csv`
- Updates last logical time in `data/state.json`

---

## CSV Output

CSV is written to `data/lottery.csv`.

| Column              | Description                                   |
| ------------------- | --------------------------------------------- |
| `participant`       | Address that minted the NFT (non-bounceable)  |
| `nftAddress`        | Address of minted NFT                         |
| `collectionAddress` | NFT collection contract address               |
| `nftIndex`          | Index of the NFT in the collection            |
| `timestamp`         | Unix timestamp of mint                        |
| `txHash`            | Root transaction hash (hex)                   |
| `lt`                | Logical time of trace                         |
| `isWin`             | Whether a prize was won                       |
| `winComment`        | Comment used to determine prize (e.g., `x77`) |
| `winAmount`         | Prize amount (in USDT or equivalent)          |

---

## Developer Notes

- Traces are paged using `offset` + `limit`
- NFT prize events are identified using `ton_transfer` actions with specific `comment`
- `txHash` is decoded from base64 → hex from either `trace.tx_hash` or `trace_id`
- Address formatting uses url-safe and bounceable=false for participants

---

## License

MIT © vdumbrava