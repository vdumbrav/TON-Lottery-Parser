# TON Lottery Parser

A TypeScript/Node.js CLI tool that fetches **all** NFT-minting traces and prize payouts from a TON smart-contract lottery on Mainnet, parses them, validates transactions, and appends structured records into a CSV file for further analysis.

---

## Features

- **Full history**: paginates through TON Center API (`/traces`) to fetch every trace since genesis or last checkpoint.
- **Incremental updates**: remembers the last processed logical time (`lt`) and only fetches newer ones on each run.
- **NFT-mint focus**: processes all traces that include an `nft_mint` action.
- **Prize-only support**: traces with a `ton_transfer` prize but no `nft_mint` (e.g. manual jackpot payout) are also supported.
- **Fake transaction detection**: validates all transactions using a multi-factor scoring system to identify suspicious activity.
- **Structured output**: appends to a CSV with the following columns:

  - `participant` — wallet that minted the NFT or received the prize
  - `nftAddress` — NFT item address (if available)
  - `collectionAddress` — collection contract address (if available)
  - `nftIndex` — token index (if available)
  - `timestamp` — Unix time of the event
  - `txHash` — hex-encoded root transaction hash
  - `lt` — logical time of the trace
  - `isWin` — `true` if the trace includes a prize transfer
  - `winComment` — TON transfer comment (e.g. `x3`, `Jackpot winner`)
  - `winAmount` — prize in TON (or null if Jetton-only)
  - `winJettonAmount` — Jetton prize amount (if present)
  - `winJettonSymbol` — Jetton symbol for prize (e.g. `USDT`)
  - `winTonAmount` — actual TON amount transferred for the prize
  - `referralAmount` — referral payout amount in TON or jetton (e.g. `USDT`) if present
  - `referralPercent` — percentage of the ticket price paid out as a referral
  - `referralAddress` — wallet that received the referral payout
  - `buyAmount` — amount the participant paid for the ticket
  - `buyCurrency` — currency used for the ticket purchase (e.g. `TON` or jetton symbol)
  - `buyMasterAddress` — jetton master address of the purchase currency
  - `isFake` — boolean flag indicating if transaction is suspicious
  - `fakeReason` — description of why transaction was flagged as fake (if applicable)
  - `validationScore` — validation score (0-100, higher is more legitimate)

- **Prize logic**: prizes are detected by comments in `ton_transfer` actions, matched via:

  | Comment          | Prize (USD) |
  | ---------------- | ----------- |
  | `x1`             | 1           |
  | `x3`             | 3           |
  | `x7`             | 7           |
  | `x20`            | 20          |
  | `x77`            | 77          |
  | `x200`           | 200         |
  | `jp`/`jackpot`   | 1000        |

- **Type-safe**: written in TypeScript with strict TON schema typings
- **Modular** architecture:

  - `services/apiServiceTon.ts` – fetches traces and maps them to structured records
  - `core/processor.ts` – coordinates fetch → parse → write → save
  - `core/validator.ts` – validates transactions and detects fake activity
  - `services/csvService.ts` – appends records to CSV using PapaParse
  - `services/stateService.ts` – tracks the last processed `lt` in `data/state.json`
  - `config/config.ts` – env-driven configuration

---

## Prerequisites

- Node.js ≥ 20 (ESM + top-level `await`)
- A TON Center **Mainnet API key**
- NPM or Yarn

---

## Installation

```bash
git clone <repo-url>
cd ton-lottery-parser
npm install
```

Create a `.env`:

```dotenv
TONCENTER_API_URL=https://toncenter.com/api/v3
TONCENTER_API_KEY=YOUR_MAINNET_API_KEY
TON_CONTRACT_ADDRESS=EQCHbnxDzu6b7U25pLV2V1cWwh1IxxtHPKmZky4Wpo-m-WuM
CONTRACT_TYPE=TON
PAGE_LIMIT=100
```

### Type checking

First install the dev dependencies with `npm install`.
Run `npm run build` to compile the TypeScript sources and ensure all
types are correct. The command emits the compiled files into `dist/`.

---

## Usage

```bash
npm start
# or
yarn start
```

- Fetches all new traces from the configured TON contract
- Detects and records both NFT mints and prize-only payouts
- Appends structured data to `data/lottery.csv`
- Tracks last processed `lt` in `data/state.json`

---

## CSV Output

| Column            | Description                                                         |
| ----------------- | ------------------------------------------------------------------- |
| participant       | Wallet that minted the NFT or received the prize                    |
| nftAddress        | NFT item address (if present)                                       |
| collectionAddress | Collection contract address (if present)                            |
| nftIndex          | NFT index within the collection (if present)                        |
| timestamp         | Unix timestamp of mint or prize payout                              |
| txHash            | Root transaction hash (hex-encoded)                                 |
| lt                | Logical time of the trace                                           |
| isWin             | Boolean — `true` if a prize was transferred                         |
| winComment        | Comment tag on `ton_transfer`, e.g. `x77`, `Jackpot winner`         |
| winAmount         | Prize amount in TON (or null if Jetton-only)                        |
| winJettonAmount   | Prize amount if paid in jetton                                      |
| winJettonSymbol   | Symbol of the jetton prize (e.g. `USDT`)                            |
| winTonAmount      | Actual TON amount transferred for the prize                         |
| referralAmount    | Referral payout amount in TON or jetton (e.g. `USDT`)               |
| referralPercent   | Percentage of the ticket price paid out as a referral |
| referralAddress   | Wallet that received the referral payout                            |
| buyAmount         | Amount the participant paid for the ticket                          |
| buyCurrency       | Currency used for the ticket purchase (e.g. `TON` or jetton symbol) |
| buyMasterAddress  | Jetton master address of the purchase currency                      |
| isFake            | Boolean flag indicating if transaction is suspicious                |
| fakeReason        | Description of why transaction was flagged as fake                  |
| validationScore   | Validation score (0-100, higher = more legitimate)                  |

---

## Transaction Validation

The parser includes a sophisticated validation system to detect fake/suspicious transactions:

### Validation Factors

1. **Transaction Flow** (40 points)
   - Payment to contract → NFT mint → prize payout (if win)
   - Correct sequence and participants
   - Referral payouts to different addresses

2. **Timing Analysis** (20 points)
   - Realistic time gaps between actions
   - No instant back-and-forth transfers

3. **Amount Verification** (20 points)
   - Purchase amounts match expected ticket prices
   - Prize amounts correspond to comment tags

4. **Address Diversity** (20 points)
   - Participant ≠ Contract
   - Referral addresses are distinct (when applicable)

### Validation Score

- **100**: Fully legitimate transaction
- **80-99**: Likely legitimate with minor issues
- **50-79**: Suspicious, requires review
- **< 50**: High probability of fake transaction

Transactions with `validationScore < 80` are flagged as `isFake=true` with a reason in `fakeReason`.

---

## Developer Notes

- `txHash` is extracted from the root trace, not from external hash
- Prize detection logic uses:

  ```ts
  if (action.type === "ton_transfer" && action.details?.comment)
  ```

- Traces with a valid prize but no `nft_mint` (e.g. manual jackpot) are included
- NFT-related fields will be `null` in prize-only traces
- `winTonAmount` > 0 indicates the prize transfer was executed
- `referralAmount` > 0 confirms the referral payout (TON or jetton)
- For TON contracts, `referralPercent` is derived from the referral payout
  relative to the ticket price. For Jetton contracts, the percentage is read
  directly from the referral payload.
- `buyAmount` and `buyCurrency` capture the ticket purchase value
- `buyMasterAddress` contains the jetton master address used for the purchase
- Utility helpers in `src/core/utils.ts` provide a single
  `normalizeAddress()` function for converting raw wallet addresses
  to the canonical bounceable-`false`, URL-safe format used throughout
  the services.
- All transactions are validated using `core/validator.ts` with scoring and fake detection

---

## License

MIT © vdumbrava
