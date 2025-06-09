// ton-api-service.ts – refactored version with explicit payload parsing and richer types
// -----------------------------------------------------------------------------
// 1.  New helpers for participant discovery and payload decoding.
// 2.  Forward‑payload op‑codes ("PRIZ" / "REFF") handled for Jetton v2 & v3.
// 3.  New type fields: `prizeCode`, `isLoss`.
// -----------------------------------------------------------------------------

import axios, { AxiosInstance } from "axios";
import { Address, Cell } from "@ton/core";
import { Buffer } from "buffer";
import { CONFIG } from "../config/config.js";
import {
  RawTrace,
  LotteryTx,
  JettonTransferDetails,
  TraceActionDetails,
  JettonTransferDetailsV3,
  TraceAction,
} from "../types/index.js";
import { nanoToTon, delay } from "../core/utils.js";

// ──────────────────────────
// ‑‑‑ constants
// ──────────────────────────
const OP_PRIZE = 0x5052495a; // "PRIZ"
const OP_REFERRAL = 0x52454646; // "REFF"

const PRIZE_MAP: Record<string, number> = {
  x1: 10,
  x3: 25,
  x7: 50,
  x20: 180,
  x77: 700,
  x200: 1800,
  jp: 10000,
  "Jackpot winner": 10000,
};

// ──────────────────────────
// ‑‑‑ type‑guards
// ──────────────────────────
function isJettonV2(d: TraceActionDetails): d is JettonTransferDetails {
  return typeof (d as any)?.jetton === "object";
}
function isJettonV3(d: TraceActionDetails): d is JettonTransferDetailsV3 {
  return (d as any)?.asset !== undefined;
}

// ──────────────────────────
// ‑‑‑ service
// ──────────────────────────
export class TonApiService {
  private readonly client: AxiosInstance = axios.create({
    baseURL: CONFIG.apiEndpoint,
    timeout: 10_000,
    params: { api_key: CONFIG.apiKey },
  });

  private readonly contract = Address.parse(
    CONFIG.contractAddress,
  ).toString({ bounceable: false, urlSafe: true });

  private readonly jettonMeta: Record<string, any> = {};

  // ------------- utils ----------------
  private addr(raw?: string | null): string | null {
    if (!raw) return null;
    try {
      return Address.parse(raw).toString({ bounceable: false, urlSafe: true });
    } catch {
      return null;
    }
  }

  private b64ToHex(b64: string): string {
    return Buffer.from(b64, "base64").toString("hex");
  }

  private jetAmount(raw: string | undefined, decimals: number): number {
    return raw ? Number(raw) / 10 ** decimals : 0;
  }

  private readDecimals(asset: string): number {
    return Number(this.jettonMeta?.[asset]?.token_info?.[0]?.extra?.decimals ?? 9);
  }

  /**
   * Decode the cell stored as Base‑64 and extract the first 4 / 5 bytes.
   * Returns `{ op, prizeCode }` where `prizeCode` is *only* present for PRIZ.
   */
  private decodePayload(forwardPayloadB64?: string | null): {
    op: number | null;
    prizeCode: number | null;
  } {
    if (!forwardPayloadB64) return { op: null, prizeCode: null };
    try {
      const cell = Cell.fromBoc(Buffer.from(forwardPayloadB64, "base64"))[0];
      const cs = cell.beginParse();
      const op = cs.readUintNumber(32);
      let prizeCode: number | null = null;
      if (op === OP_PRIZE && cs.remainingBits >= 8) {
        prizeCode = cs.readUintNumber(8);
      }
      return { op, prizeCode };
    } catch {
      return { op: null, prizeCode: null };
    }
  }

  // ------------- public API ----------------
  async fetchAllTraces(): Promise<RawTrace[]> {
    const all: RawTrace[] = [];
    let offset = 0;
    while (true) {
      const { data } = await this.client.get("/traces", {
        params: {
          account: CONFIG.contractAddress,
          limit: CONFIG.pageLimit,
          offset,
          include_actions: true,
        },
      });
      const traces: RawTrace[] = data.traces || [];
      if (!traces.length) break;
      all.push(...traces);
      if (data.metadata) Object.assign(this.jettonMeta, data.metadata);
      offset += CONFIG.pageLimit;
      await delay(1_000); // avoid rate‑limit
    }
    return all;
  }

  /**
   * Map a raw trace to an internal `LotteryTx` domain object.
   */
  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    if (!trace.actions || !trace.transactions_order) return null;

    // 1) derive tx‑hash & participant address
    const txHashB64 = trace.trace?.tx_hash ?? trace.trace_id;
    if (!txHashB64) return null;
    const txHash = this.b64ToHex(txHashB64);

    const participant = this.deriveParticipant(trace.actions);
    if (!participant) return null;

    // 2) iter over actions
    let winAmount = 0;
    let prizeCode: number | null = null;
    let winTonNano = 0n;

    let referralAmount: number | null = null;
    let referralAddress: string | null = null;

    let buyAmount: number | null = null;
    let buyCurrency: string | null = null;
    let buyMasterAddress: string | null = null;

    for (const action of trace.actions) {
      //------------------------------------------------------------------
      // TON transfers (simple comment‑based payouts)
      //------------------------------------------------------------------
      if (action.type === "ton_transfer") {
        const comment = (action.details?.comment ?? "").trim().toLowerCase();
        if (comment in PRIZE_MAP) {
          winAmount = PRIZE_MAP[comment];
          prizeCode = null; // not available for TON prizes
          winTonNano += BigInt(action.details?.value ?? 0);
          continue;
        }
        if (comment === "referral") {
          referralAmount = nanoToTon(BigInt(action.details?.value ?? 0));
          referralAddress = this.addr(action.details?.destination) ?? null;
          continue;
        }
      }

      //------------------------------------------------------------------
      // Jetton transfers: purchase, prize, referral (v2 + v3)
      //------------------------------------------------------------------
      if (action.type === "jetton_transfer") {
        const d = action.details as TraceActionDetails;

        const srcAddr = this.addr(
          isJettonV3(d) ? (d as JettonTransferDetailsV3).sender : d.source!,
        );
        const dstAddr = this.addr(
          isJettonV3(d) ? (d as JettonTransferDetailsV3).receiver : d.destination!,
        );

        let decimals = 9;
        let symbol = "JETTON";
        let master = "";

        if (isJettonV3(d)) {
          master = this.addr((d as JettonTransferDetailsV3).asset) ?? "";
          decimals = this.readDecimals((d as JettonTransferDetailsV3).asset);
          symbol =
            this.jettonMeta?.[(d as JettonTransferDetailsV3).asset]?.token_info?.[0]?.symbol ?? symbol;
        } else if (isJettonV2(d)) {
          const jet = (d as JettonTransferDetails).jetton ?? {};
          decimals = jet.decimals ?? 9;
          symbol = jet.symbol ?? symbol;
          master = jet.master ? this.addr(jet.master) ?? "" : "";
        }

        const amount = this.jetAmount(
          isJettonV3(d) ? (d as JettonTransferDetailsV3).amount : d.value,
          decimals,
        );

        // --- Decode forward‑payload (if any) --------------------------------
        const { op, prizeCode: pCode } = this.decodePayload(
          isJettonV3(d) ? (d as JettonTransferDetailsV3).forward_payload : (d as any).custom_payload,
        );

        // purchase (participant → contract)
        if (!buyAmount && srcAddr === participant && dstAddr === this.contract) {
          buyAmount = amount;
          buyCurrency = symbol;
          buyMasterAddress = master || null;
          continue;
        }

        // payouts (contract → …)
        if (srcAddr === this.contract) {
          if (op === OP_PRIZE) {
            winAmount = amount;
            prizeCode = pCode;
          } else if (op === OP_REFERRAL) {
            referralAmount = (referralAmount ?? 0) + amount;
            referralAddress = dstAddr;
          }
          continue;
        }
      }
    }

    // --- normalise TON prize amount (if any) --------------------------------
    const winTonAmount = winTonNano ? nanoToTon(winTonNano) : null;

    const isWin = winAmount > 0;
    const isLoss = prizeCode === 7;

    // NFT mint (collectable ticket) -----------------------------------------
    const mint = trace.actions.find((a) => a.type === "nft_mint");
    let nftAddress: string | null = null;
    let collectionAddress: string | null = null;
    let nftIndex: number | null = null;
    if (
      mint &&
      mint.details.nft_item &&
      mint.details.nft_collection &&
      mint.details.nft_item_index
    ) {
      nftAddress = this.addr(mint.details.nft_item);
      collectionAddress = this.addr(mint.details.nft_collection);
      nftIndex = parseInt(mint.details.nft_item_index, 10);
    }

    return {
      participant,
      nftAddress,
      collectionAddress,
      nftIndex,
      timestamp: trace.start_utime,
      txHash,
      lt: trace.start_lt,
      isWin,
      isLoss,
      prizeCode,
      winComment: winAmount ? `${winAmount} ${buyCurrency ?? "USDT"}` : null,
      winAmount,
      winTonAmount,
      referralAmount,
      referralAddress,
      buyAmount,
      buyCurrency,
      buyMasterAddress,
    };
  }

  // -------------------------------------------------------------------------
  // derive participant from the first purchase action
  // -------------------------------------------------------------------------
  private deriveParticipant(actions: TraceAction[]): string | null {
    const pay = actions.find(
      (a) =>
        a.type === "jetton_transfer" &&
        a.details &&
        this.addr((a.details as any).source) !== this.contract &&
        this.addr((a.details as any).destination) === this.contract,
    );
    if (!pay) return null;

    const d = pay.details as TraceActionDetails;
    const raw = isJettonV3(d)
      ? (d as JettonTransferDetailsV3).sender
      : (d as JettonTransferDetails).source!;
    return this.addr(raw);
  }
}
