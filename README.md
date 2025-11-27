# TON Lottery Parser

A TypeScript/Node.js CLI tool that fetches lottery transactions from a TON smart-contract on Mainnet via **tonapi.io**, parses them, and appends structured records into a CSV file for analysis.

---

## Features

- **Full history**: fetches all transactions from tonapi.io API (`/v2/blockchain/accounts/{account}/transactions`)
- **Incremental updates**: remembers the last processed logical time (`lt`) and only fetches newer ones on each run
- **Dynamic ticket price**: fetches ticket price from contract via `get_full_data` method
- **Prize detection**: detects wins by opcode (`OP_PRIZ`) or comment (x1, x3, x7, x20, x77, x200, jp)
- **Referral tracking**: tracks referral payments by opcode (`OP_REFF`) or comment
- **Structured output**: appends to CSV with comprehensive transaction data

### CSV Columns

| Column | Description |
|--------|-------------|
| participant | Wallet that bought the ticket |
| nftAddress | NFT item address (if available) |
| collectionAddress | Collection contract address (if available) |
| nftIndex | Token index (if available) |
| timestamp | Unix time of the event |
| txHash | Transaction hash |
| lt | Logical time |
| isWin | `true` if won a prize |
| winComment | Prize comment (x1, x3, x7, x20, x77, x200, jp) |
| winAmount | Prize in USD equivalent |
| winJettonAmount | Jetton prize amount (if present) |
| winJettonSymbol | Jetton symbol (e.g. `USDT`) |
| winTonAmount | TON amount transferred for prize |
| referralAmount | Referral payout amount |
| referralPercent | Referral percentage (10%) |
| referralAddress | Wallet that received referral |
| buyAmount | Ticket price paid |
| buyCurrency | Currency (TON or jetton) |
| buyMasterAddress | Jetton master address |
| isFake | Suspicious transaction flag |
| fakeReason | Reason for flagging |
| validationScore | Validation score (0-100) |

### Prize Map

| Comment | Prize (USD) |
|---------|-------------|
| x1 | 1 |
| x3 | 3 |
| x7 | 7 |
| x20 | 20 |
| x77 | 77 |
| x200 | 200 |
| jp/jackpot | 1000 |

---

## Project Structure

```
src/
├── config/
│   └── config.ts           # Environment configuration
├── constants/
│   └── lottery.ts          # Lottery constants (PRIZE_MAP, opcodes)
├── core/
│   ├── processor.ts        # Main processing logic
│   ├── utils.ts            # Utility functions
│   └── validator.ts        # Transaction validator
├── services/
│   ├── apiServiceTon.ts    # TON API service (tonapi.io)
│   ├── apiServiceJetton.ts # Jetton API service
│   ├── csvService.ts       # CSV file operations
│   ├── stateService.ts     # State persistence
│   └── tonApiFactory.ts    # API factory
├── types/
│   ├── index.ts            # Main types (LotteryTx, etc.)
│   └── tonApi.ts           # TonAPI response types
└── index.ts                # Entry point
```

---

## Prerequisites

- Node.js >= 20
- tonapi.io API key (from [tonconsole.com](https://tonconsole.com/tonapi/api-keys))

---

## Installation

```bash
git clone <repo-url>
cd ton-lottery-parser
npm install
```

Create `.env`:

```dotenv
# TON API Configuration (tonapi.io)
TONAPI_URL=https://tonapi.io
TONAPI_KEY=your_api_key_here

# Contract Configuration
TON_CONTRACT_ADDRESS=EQCHbnxDzu6b7U25pLV2V1cWwh1IxxtHPKmZky4Wpo-m-WuM
CONTRACT_TYPE=TON

# Pagination
PAGE_LIMIT=100
```

---

## Usage

```bash
# Build and run
npm start

# Build only
npm run build

# Run analysis
npm run analyze
```

---

## API Rate Limits

tonapi.io free tier: **1 request/second**

The parser automatically respects this limit with 1100ms delay between requests.

---

## Results

For contract `EQCHbnxDzu6b7U25pLV2V1cWwh1IxxtHPKmZky4Wpo-m-WuM`:

| Metric | Value |
|--------|-------|
| Total lottery tickets | 9024 |
| Unique transactions | 9024 |
| Ticket price | 1 TON |
| Referral rate | 10% (0.1 TON) |

---

## Technical Details

### Lottery Opcodes

```typescript
OP_PRIZ = 0x5052495a  // Prize payment
OP_REFF = 0x52454646  // Referral payment
OP_DEPLOY = 0x801b4fb4 // NFT deploy
```

### Transaction Validation

A transaction is valid if:
1. `buyAmount === ticketPrice` (from contract)
2. Transaction is TO the contract address
3. Has valid participant address

### Ticket Price

Fetched dynamically from contract via toncenter API:
- Endpoint: `/api/v3/runGetMethod`
- Method: `get_full_data`
- Index: 4 (for TON contracts)

---

## License

MIT
