# TON Lottery Parser

A TypeScript/Node.js CLI tool that fetches **all** NFT-minting traces from a TON smart-contract lottery on Testnet, parses them for mint events and wins, and appends structured records into a CSV file for further analysis.

---

## Features

- **Full history**: paginates through TON Center API (`/traces`) to fetch every trace since genesis or since last checkpoint.
- **Incremental updates**: remembers last processed logical time (`lt`) and only fetches newer ones on each run.
- **NFT-mint focus**: processes **only** traces that include an `nft_mint` action, ensuring the CSV contains only actual mint events.
- **Structured output**: writes a CSV with these columns:
  - `participant` (user-friendly, **non-bounceable, url-safe** address)
  - `nftAddress` (user-friendly NFT item address, **non-bounceable, url-safe**)
  - `collectionAddress` (user-friendly collection address, **non-bounceable, url-safe**)
  - `nftIndex` (index of the minted token)
  - `timestamp` (Unix seconds)
  - `txHash`
  - `lt` (logical time)
  - `isWin` (boolean flag)
  - `winComment` (raw win comment text, e.g. `x3`)
  - `winAmount` (calculated win payout for the comment)
- **Type safety**: written in TypeScript, with strong typings for TON traces.
- **Modular architecture:**
  - `services/tonApiService.ts`: handles paged `/traces` calls and filters to NFT-mint traces
  - `core/processor.ts`: coordinates fetch → filter → parse → CSV append → state update
  - `services/csvService.ts`: uses PapaParse to build and append CSV rows
  - `services/stateService.ts`: tracks last processed `lt` in `data/state.json`
  - `config/config.ts`: centralizes API endpoint, key, contract addresses, and pagination settings

---

## Prerequisites

- **Node.js ≥ 22** (for ES modules & top-level `await`)
- **NPM** or **Yarn**
- A **TON Center Testnet API key**

---

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

   ```dotenv
   TONCENTER_API_URL=https://testnet.toncenter.com/api/v3
   TONCENTER_API_KEY=YOUR_TESTNET_API_KEY
   TON_CONTRACT_ADDRESS=kQD4Frl7oL3vuMqTZ812zB-lRSTcrogKu6MFx3Fl3V1ieuWb
   PAGE_LIMIT=50
   ```

---

## Usage

Run the parser:

```bash
npm start
# or
yarn start
```

- **First run**: fetches _all_ NFT-mint traces for the configured contract.
- **Subsequent runs**: only fetches and appends traces with `lt` greater than the saved cursor.
- **CSV output**: appended to `data/lottery.csv` (created with headers if missing).
- **State file**: `data/state.json` stores the last processed `lt`.

---

## CSV Schema

| Column            | Description                                                                   |
| ----------------- | ----------------------------------------------------------------------------- |
| participant       | Lottery participant (**user-friendly, non-bounceable, url-safe TON address**) |
| nftAddress        | NFT item address (**user-friendly, non-bounceable, url-safe**)                |
| collectionAddress | NFT collection address (**user-friendly, non-bounceable, url-safe**)          |
| nftIndex          | Index of the minted token                                                     |
| timestamp         | Mint time (Unix seconds)                                                      |
| txHash            | Transaction hash                                                              |
| lt                | Logical time of the trace                                                     |
| isWin             | `true` if the win comment prefix (`x`) is detected                            |
| winComment        | Raw win comment text (e.g. `x3`)                                              |
| winAmount         | Calculated win payout for this comment                                        |

> ℹ️ All addresses in CSV (`participant`, `nftAddress`, `collectionAddress`) are formatted using:
>
> ```ts
> Address.parse(raw).toString({ bounceable: false, urlSafe: true });
> ```
>
> This ensures compatibility with wallets, explorers, and CSV post-processing tools.

---

## Extending & Customization

- Modify `services/tonApiService.ts` to extract extra fields or adjust filtering logic.
- Switch to Mainnet by updating `.env` values (API URL and contract address).

---

## Development

- Build: `npm run build`
- Run compiled: `node dist/index.js`

---

## License

MIT © vdumbrava
