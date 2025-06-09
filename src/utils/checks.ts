import { TraceActionDetails, JettonTransferDetailsV3, TokenInfo } from "../types/index.js";

export function isJettonV3(d: TraceActionDetails): d is JettonTransferDetailsV3 {
  return typeof (d as any).asset === "string";
}

export function readDecimals(meta?: TokenInfo[]): number {
  const raw = meta?.[0]?.extra?.decimals;
  return raw ? Number(raw) : 9;
}
