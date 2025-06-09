export const OP = {
  SEND_PRIZE: 0x5052495a,
  SEND_REFF: 0x52454646,
  JETTON_XFER: 0x0f8a7ea5,
} as const;

export interface OutMsg {
  op: number;
  amount: bigint;
  payload: import("@ton/core").Slice;
}

function isJettonMsg(m: OutMsg): boolean {
  return m.op === OP.JETTON_XFER;
}

export interface TxAnalysis {
  prize: bigint;
  prizeCode: number | null;
  referralAmount: bigint;
  isLoss: boolean;
}

export function analyzeTransaction(outMsgs: OutMsg[]): TxAnalysis {
  let prize = 0n;
  let prizeCode: number | null = null;
  let referralAmount = 0n;

  for (const msg of outMsgs) {
    if (!isJettonMsg(msg)) continue;
    const payloadOp = msg.payload.loadUint(32);
    switch (payloadOp) {
      case OP.SEND_PRIZE:
        prize += msg.amount;
        prizeCode = msg.payload.loadUint(8);
        break;
      case OP.SEND_REFF:
        referralAmount += msg.amount;
        break;
      default:
        // ignore
        break;
    }
  }

  return {
    prize,
    prizeCode,
    referralAmount,
    isLoss: prizeCode === 7,
  };
}
