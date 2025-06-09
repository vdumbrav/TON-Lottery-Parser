import axios from "axios";
import { Buffer } from "buffer";
import { CONFIG } from "../config/config.js";
import {
  RawTrace,
  LotteryTx,
  JettonTransferDetails,
  TraceActionDetails,
  JettonTransferDetailsV3,
  TraceMetadata,
} from "../types/index.js";
import { Address, Cell, Slice } from "@ton/core";
import { nanoToTon, delay } from "../core/utils.js";
import { isJettonV3, readDecimals } from "../utils/checks.js";
import { OP } from "../utils/analyzer.js";

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

function isJettonDetails(
  details: TraceActionDetails
): details is JettonTransferDetails {
  return typeof (details as any)?.jetton === "object";
}

export class TonApiService {
  private client = axios.create({
    baseURL: CONFIG.apiEndpoint,
    timeout: 10_000,
    params: { api_key: CONFIG.apiKey },
  });
  private contract = Address.parse(CONFIG.contractAddress).toString({
    bounceable: false,
    urlSafe: true,
  });

  async fetchAllTraces(): Promise<RawTrace[]> {
    console.log("[API] start fetching traces");
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

      const traces = (data.traces as RawTrace[]) || [];
      if (!traces.length) break;
      all.push(...traces);
      offset += CONFIG.pageLimit;
      await delay(1_000);
    }

    console.log(`[API] fetched ${all.length} traces`);
    return all;
  }

  private b64ToHex(b64: string): string {
    return Buffer.from(b64, "base64").toString("hex");
  }

  private parseForwardPayload(
    b64?: string
  ): { op: number; code?: number } | null {
    if (!b64) return null;
    try {
      const cell = Cell.fromBase64(b64);
      const slice = cell.beginParse();
      const op = slice.loadUint(32);
      if (op === OP.SEND_PRIZE) {
        const code = slice.loadUint(8);
        return { op, code };
      }
      return { op };
    } catch {
      return null;
    }
  }

  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    if (!trace.actions?.length || !trace.transactions_order) {
      return null;
    }

    const rootB64 = trace.trace?.tx_hash ?? trace.trace_id;
    if (!rootB64) {
      console.warn(`[API] ⚠ Missing root tx hash`);
      return null;
    }

    const txHash = this.b64ToHex(rootB64);

    let winComment: string | null = null;
    let winAmount = 0;
    let winTonNano = 0n;
    let referralAmount = 0;
    let referralAddress: string | null = null;
    let buyAmount: number | null = null;
    let buyCurrency: string | null = null;
    let buyMasterAddress: string | null = null;

    const firstTx = trace.transactions_order?.[0];
    const rawSource = firstTx
      ? trace.transactions[firstTx]?.in_msg?.source ??
      trace.transactions[firstTx]?.account
      : null;

    if (!rawSource) {
      console.warn(`[API] ⚠ Missing source in tx ${txHash}`);
      return null;
    }

    let participant: string;
    try {
      participant = Address.parse(rawSource).toString({
        bounceable: false,
        urlSafe: true,
      });
    } catch {
      console.warn(`[API] ⚠ Invalid address: ${rawSource}`);
      return null;
    }

    let purchaseRecorded = false;

    for (const action of trace.actions) {
      if (action.type === "ton_transfer" || action.type === "call_contract") {
        const dest = action.details?.destination;
        const src = action.details?.source;
        const destNorm = dest
          ? Address.parse(dest).toString({ bounceable: false, urlSafe: true })
          : null;
        const srcNorm = src
          ? Address.parse(src).toString({ bounceable: false, urlSafe: true })
          : null;
        const value = action.details?.value ? BigInt(action.details.value) : 0n;

        if (action.type === "ton_transfer") {
          const comment = action.details?.comment;
          const prizeKey = (comment ?? "").trim().toLowerCase();
          const prizeUsd = PRIZE_MAP[prizeKey];
          if (prizeUsd) {
            winAmount = prizeUsd;
            winComment = prizeKey;
            winTonNano += value;
            continue;
          } else if (prizeKey === "referral") {
            referralAmount += nanoToTon(value);
            if (!referralAddress && action.details?.destination) {
              try {
                referralAddress = Address.parse(
                  action.details.destination
                ).toString({ bounceable: false, urlSafe: true });
              } catch {
                console.warn(
                  `[API] invalid referral address: ${action.details.destination}`
                );
              }
            }
            continue;
          }
        }

        if (
          !purchaseRecorded &&
          destNorm === this.contract &&
          srcNorm === participant &&
          value > 0n
        ) {
          buyAmount = nanoToTon(value);
          buyCurrency = "TON";
          buyMasterAddress = null;
          purchaseRecorded = true;
        }
      } else if (action.type === "jetton_transfer") {
        const dest = action.details?.destination;
        const src = action.details?.source;
        const destNorm = dest
          ? Address.parse(dest).toString({ bounceable: false, urlSafe: true })
          : null;
        const srcNorm = src
          ? Address.parse(src).toString({ bounceable: false, urlSafe: true })
          : null;
        const details = action.details as TraceActionDetails;

        if (isJettonV3(details)) {
          const master = Address.parse(details.asset).toString({
            bounceable: false,
            urlSafe: true,
          });
          const tokenMeta = trace.metadata?.[details.asset]?.token_info;
          const decimals = readDecimals(tokenMeta);
          const symbol = tokenMeta?.[0]?.symbol ?? "JETTON";
          const amount = Number(details.amount) / 10 ** decimals;
          const fwd = this.parseForwardPayload(
            details.forward_payload || undefined
          );
          const fwdAmt = details.forward_amount
            ? BigInt(details.forward_amount)
            : 0n;

          if (
            !purchaseRecorded &&
            destNorm === this.contract &&
            srcNorm === participant &&
            amount > 0
          ) {
            buyAmount = amount;
            buyCurrency = symbol;
            buyMasterAddress = master;
            purchaseRecorded = true;
          }

          if (srcNorm === this.contract && destNorm === participant && fwd) {
            if (fwd.op === OP.SEND_PRIZE) {
              winAmount += amount;
              winTonNano += fwdAmt;
              if (fwd.code !== undefined) {
                winComment = `code${fwd.code}`;
              }
            } else if (fwd.op === OP.SEND_REFF) {
              referralAmount += amount;
              referralAddress = destNorm;
            }
          }
        } else if (isJettonDetails(details)) {
          const jetton = details.jetton;
          const decimals = jetton?.decimals ?? 9;
          const amount = (Number(details.value) || 0) / 10 ** decimals;
          const symbol = jetton?.symbol ?? "JETTON";
          const master = jetton?.master ?? null;
          if (
            !purchaseRecorded &&
            destNorm === this.contract &&
            srcNorm === participant &&
            amount > 0
          ) {
            buyAmount = amount;
            buyCurrency = symbol;
            buyMasterAddress = master
              ? Address.parse(master).toString({
                bounceable: false,
                urlSafe: true,
              })
              : null;
            purchaseRecorded = true;
          }
        }
      }
    }

    const mint = trace.actions.find((a) => a.type === "nft_mint");

    // 🎯 Case: valid mint
    if (
      mint &&
      mint.details.nft_item &&
      mint.details.nft_collection &&
      mint.details.nft_item_index
    ) {
      const nftAddress = Address.parse(mint.details.nft_item).toString({
        bounceable: false,
        urlSafe: true,
      });

      const collectionAddress = Address.parse(
        mint.details.nft_collection
      ).toString({
        bounceable: false,
        urlSafe: true,
      });

      const nftIndex = parseInt(mint.details.nft_item_index, 10);
      if (isNaN(nftIndex)) {
        return null;
      }

      return {
        participant,
        nftAddress,
        collectionAddress,
        nftIndex,
        timestamp: trace.start_utime,
        txHash,
        lt: trace.start_lt,
        isWin: winAmount > 0,
        winComment,
        winAmount,
        winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
        referralAmount: referralAmount ? referralAmount : null,
        referralAddress,
        buyAmount,
        buyCurrency,
        buyMasterAddress,
      };
    }

    // 🎯 Case: prize only (no mint)
    if (winAmount > 0) {
      return {
        participant,
        nftAddress: null,
        collectionAddress: null,
        nftIndex: null,
        timestamp: trace.start_utime,
        txHash,
        lt: trace.start_lt,
        isWin: true,
        winComment,
        winAmount,
        winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
        referralAmount: referralAmount ? referralAmount : null,
        referralAddress,
        buyAmount,
        buyCurrency,
        buyMasterAddress,
      };
    }
    console.log(`[API] ⛔ Skipped trace ${txHash} (no nft_mint or prize)`);
    return null;
  }
}
