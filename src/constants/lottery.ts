// Lottery prize multipliers (comment -> USD value)
export const PRIZE_MAP: Record<string, number> = {
  x1: 1,
  x3: 3,
  x7: 7,
  x20: 20,
  x77: 77,
  x200: 200,
  jp: 1000,
  jackpot: 1000,
};

// Lottery-specific opcodes
export const OP_PRIZ = 0x5052495a; // Prize payment
export const OP_REFF = 0x52454646; // Referral payment
export const OP_DEPLOY = 0x801b4fb4; // NFT deploy

// Contract data indices for get_full_data response
export const CONTRACT_DATA_INDEX = {
  TICKETS_SOLD_TON: 1,
  TICKETS_SOLD_JETTON: 2,
  TICKET_PRICE_TON: 4,
  TICKET_PRICE_JETTON: 5,
} as const;

// Jetton decimals
export const JETTON_DECIMALS = 6;
