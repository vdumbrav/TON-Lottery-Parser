import { OP } from '../utils/analyzer.js';

export interface PrizeMsg {
  op: typeof OP.SEND_PRIZE;
  amount: bigint;
  code: number;
}

export interface ReferralMsg {
  op: typeof OP.SEND_REFF;
  amount: bigint;
}

export type LotteryOutMsg = PrizeMsg | ReferralMsg;

export interface LotteryTxMeta {
  txHash: string;
  lt: string;
  ts: number;
  prize: bigint;
  prizeCode: number | null;
  referralAmount: bigint;
  isLoss: boolean;
}
