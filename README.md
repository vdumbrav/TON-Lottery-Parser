# TON Lottery Parser

A TypeScript/Node.js CLI tool that fetches **all** NFT-minting traces from a TON smart-contract lottery on Testnet, parses them for mint events and wins, and appends structured records into a CSV file for further analysis.

## Features

* **Full history**: paginates through TON Center API (`/traces`) to fetch every trace since genesis or since last checkpoint.
* **Incremental updates**: remembers last processed logical time (`lt`) and only fetches newer ones on each run.
* **Structured output**: writes a CSV with fields:

  * `participant` (user-friendly address)
  * `nftAddress` (friendly NFT item address)
  * `collectionAddress` (friendly collection address)
  * `nftIndex`
  * `timestamp` (Unix seconds)
  * `txHash`
  * `lt` (logical time)
  * `isWin` (boolean flag)
  * `win` (raw win comment text, e.g. `x3`)
* **Type safety**: written in TypeScript, with full typings for TON traces.
* **Modular architecture**:

  * **`services/tonApiService.ts`**: handles paged `/traces` calls and mapping raw traces → records
  * **`core/processor.ts`**: coordinates fetch → parse → CSV append → state update
  * **`services/csvService.ts`**: uses PapaParse to build and append CSV rows
  * **`services/stateService.ts`**: tracks last processed `lt` in `data/state.json`
  * **`config/config.ts`**: centralizes API endpoint, key, contract addresses, and pagination settings

## Prerequisites

* **Node.js ≥ 20** (for ES modules & top-level `await`)
* **NPM** or **Yarn**
* A **TON Center Testnet API key**

## Installation

1. Clone this repository:

   ```bash
   git clone <repo-url>
   cd ton-lottery-parser
   ```
2. Install dependencies:

   ```bash
   npm install
   # or
   yarn install
   ```
3. Create a `.env` file in the project root:

   ```env
   TONCENTER_API_URL=https://testnet.toncenter.com/api/v3
   TONCENTER_API_KEY=YOUR_TESTNET_API_KEY
   TON_CONTRACT_ADDRESS=kQD4Frl7oL3vuMqTZ812zB-lRSTcrogKu6MFx3Fl3V1ieuWb
   PAGE_LIMIT=50
   ```

## Usage

Run the parser:

```bash
npm start
# or
yarn start
```

* **First run**: fetches *all* traces for the configured contract.
* **Subsequent runs**: only fetches traces with `lt` greater than the saved cursor.
* **CSV output**: appended to `data/lottery.csv` (created with headers if missing).
* **State file**: `data/state.json` stores the last processed `lt`.

## CSV Schema

| Column            | Description                            |
| ----------------- | -------------------------------------- |
| participant       | Lottery participant (friendly address) |
| nftAddress        | NFT item address (friendly)            |
| collectionAddress | NFT collection address (friendly)      |
| nftIndex          | NFT index within collection            |
| timestamp         | Mint time (Unix seconds)               |
| txHash            | Transaction hash                       |
| lt                | Logical time of the trace              |
| isWin             | `true` if win comment prefix detected  |
| win               | Raw win comment (e.g. `x3`)            |

## Extending & Customization

* **Additional fields**: update `LotteryTx` type and `mapTraceToLotteryTx()` in `services/tonApiService.ts`.
* **Change heuristics**: adjust `isWin` logic or extract other action details.
* **Mainnet support**: modify `TONCENTER_API_URL` and `TON_CONTRACT_ADDRESS` in `.env`.

## Development

* Build: `npm run build`
* Run compiled: `node dist/index.js`

## License

MIT © vdumbrava
