# TON Lottery Parser

A TypeScript/Node.js CLI tool that fetches **all** transactions from a TON smart-contract lottery on Testnet, parses them for NFT mints and wins, and appends structured records into a CSV file for further analysis.

## Features

* **Full history**: paginates through TON Center API to fetch every transaction since genesis or since last checkpoint.
* **Incremental updates**: remembers last processed transaction (`lt`) and only fetches newer ones on each run.
* **Structured output**: writes a CSV with fields like participant address, NFT address, collection address, token index, timestamp, tx hash, win flag, comment, and transferred value.
* **Type safety**: written in TypeScript, with full typings for TON transaction payloads.
* **Modular architecture**:

  * `services/tonApiService.ts` handles all HTTP calls to TON Center via Axios
  * `core/processor.ts` coordinates fetch → parse → CSV append → state update
  * `services/csvService.ts` uses PapaParse to build CSV rows
  * `services/stateService.ts` tracks last processed logical time in `data/state.json`
  * `utils/addressUtils.ts` normalizes raw TON addresses into user-friendly Base64 format

## Prerequisites

* **Node.js ≥ 22** (supports ES2022 modules and top‑level `await`)
* **NPM or Yarn**
* A **TON Center Testnet API key**

## Installation

1. Clone this repository:

   ```bash
   git clone ...
   cd ton-lottery-parser
   ```

2. Install dependencies:

   ```bash
   npm install
   # or
   yarn install
   ```

3. Create a `.env` file in the project root:

   ```dotenv
   TONCENTER_API_KEY=YOUR_TESTNET_API_KEY
   TONCENTER_API_URL=https://testnet.toncenter.com/api/v3
   ```

## Configuration

All runtime options live in `src/config/config.ts`. By default:

* **API endpoint**: `process.env.TONCENTER_API_URL` (Testnet v3)
* **API key**: `process.env.TONCENTER_API_KEY`
* **Contract address**: the lottery’s user-friendly address
* **CSV output**: `data/lottery.csv`
* **State file**: `data/state.json`
* **Page limit**: 100 transactions per API call

Feel free to adjust these constants as needed.

## Usage

Run the parser with:

```bash
npm start
# or
yarn start
```

* On first run, it will fetch **all** transactions ever created by the lottery contract.
* It writes records to `data/lottery.csv` (creates file with headers if missing).
* It saves the highest `lt` in `data/state.json`.
* On subsequent runs, it only fetches and appends **new** transactions (those with `lt` greater than saved).

## CSV Output

Each row in `data/lottery.csv` contains:

| participant          | nftAddress | collectionAddress | nftIndex | timestamp    | txHash                           | lt           | isWin      | comment   | value          |
| -------------------- | ---------- | ----------------- | -------- | ------------ | -------------------------------- | ------------ | ---------- | --------- | -------------- |
| user-friendly string | optional   | optional          | optional | Unix seconds | transaction hash (Base64 or hex) | logical time | true/false | e.g. `x3` | nanoTON string |

You can open this CSV in Excel, Google Sheets, or any data-processing pipeline.

## Extending & Customization

* **Additional fields**: modify `types/LotteryTx` and `mapToLotteryTx()` in `services/tonApiService.ts` to include extra data (fees, status, etc.).
* **Alternate logic**: adjust the `isWin` heuristic or NFT parsing in `services/tonApiService.ts`.
* **Mainnet support**: change the endpoint and contract address in `config.ts` to point to Mainnet.

## Development

* Build to `dist/` via:

  ```bash
  npm run build
  ```
* Run compiled code:

  ```bash
  node dist/index.js
  ```

## License

MIT © vdumbrava
