import axios from "axios";
import { Buffer } from "buffer";
import { CONFIG } from "../config/config.js";
import {
  RawTrace,
  LotteryTx,
  JettonTransferDetails,
  TraceActionDetails,
} from "../types/index.js";
import { nanoToTon, delay, tryNormalizeAddress } from "../core/utils.js";

const PRIZE_MAP: Record<string, number> = {
  x1: 1,
  x3: 3,
  x7: 7,
  x20: 20,
  x77: 77,
  x200: 200,
  jp: 1000,
};

function isJettonDetails(
  details: TraceActionDetails
): details is JettonTransferDetails {
  return typeof (details as any)?.jetton === "object";
}

export class ApiServiceTon {
  private client = axios.create({
    baseURL: CONFIG.apiEndpoint,
    timeout: 10000,
    params: { api_key: CONFIG.apiKey },
  });

  private contract = tryNormalizeAddress(CONFIG.contractAddress);

  async fetchAllTraces(): Promise<RawTrace[]> {
    console.log("[API-TON] start fetching traces");
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
      await delay(1000);
    }

    console.log(`[API-TON] fetched ${all.length} traces`);
    return all;
  }

  private b64ToHex(b64: string): string {
    return Buffer.from(b64, "base64").toString("hex");
  }

  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    if (!trace.actions || !trace.transactions_order) return null;

    const rootB64 = trace.trace?.tx_hash ?? trace.trace_id;
    const txHash = rootB64 ? this.b64ToHex(rootB64) : null;
    if (!txHash) return null;

    const firstTx = trace.transactions_order[0];
    const rawSource =
      trace.transactions[firstTx]?.in_msg?.source ??
      trace.transactions[firstTx]?.account;

    if (!rawSource) return null;

    const participant = tryNormalizeAddress(rawSource);
    if (!participant) {
      console.warn(`[API-TON] ⚠ Invalid address: ${rawSource}`);
      return null;
    }

    let winComment: string | null = null;
    let winAmount = 0;
    let winTonNano = 0n;
    let referralNano = 0n;
    let referralAddress: string | null = null;
    let buyAmount: number | null = null;
    let buyCurrency: string | null = null;
    let buyMasterAddress: string | null = null;
    let textComment: string | null = null;
    let purchaseRecorded = false;

    for (const action of trace.actions) {
      const details = action.details;
      const dest = details?.destination;
      const src = details?.source;

      const destNorm = dest ? tryNormalizeAddress(dest) : null;
      const srcNorm = src ? tryNormalizeAddress(src) : null;

      const value = details?.value ? BigInt(details.value) : 0n;

      if (action.type === "ton_transfer") {
        const rawComment = details?.comment?.trim() || null;
        const comment = rawComment ? rawComment.toLowerCase() : null;
        const prizeUsd = comment ? PRIZE_MAP[comment] : undefined;

        if (prizeUsd) {
          winAmount = prizeUsd;
          winComment = comment ?? null;
          winTonNano += value;
          continue;
        }

        if (comment === "referral") {
          referralNano += value;
          if (!referralAddress && dest) {
            const parsed = tryNormalizeAddress(dest);
            if (parsed) {
              referralAddress = parsed;
            } else {
              console.warn(`[API-TON] invalid referral address: ${dest}`);
            }
          }
          continue;
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
          textComment = rawComment;
          purchaseRecorded = true;
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

      if (action.type === "jetton_transfer") {
        const jetton = isJettonDetails(details) ? details.jetton : undefined;
        const decimals = jetton?.decimals ?? 9;
        const amount =
          (Number(details?.value) || 0) / Math.pow(10, Number(decimals));
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
          buyMasterAddress = master ? tryNormalizeAddress(master) : null;
          purchaseRecorded = true;
        }
      }
    }

    const mint = trace.actions.find((a) => a.type === "nft_mint");

    if (
      mint &&
      mint.details.nft_item &&
      mint.details.nft_collection &&
      mint.details.nft_item_index
    ) {
      const nftAddress = tryNormalizeAddress(mint.details.nft_item);
      const collectionAddress = tryNormalizeAddress(
        mint.details.nft_collection
      );
      if (!nftAddress || !collectionAddress) return null;
      const nftIndex = parseInt(mint.details.nft_item_index, 10);
      if (isNaN(nftIndex)) return null;

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
        winJettonAmount: null,
        winJettonSymbol: null,
        winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
        referralAmount: referralNano ? nanoToTon(referralNano) : null,
        referralPercent:
          buyAmount && referralNano
            ? Math.round((nanoToTon(referralNano) / buyAmount) * 10000) / 100
            : null,
        referralAddress,
        buyAmount,
        buyCurrency,
        buyMasterAddress,
        textComment,
      };
    }

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
        winJettonAmount: null,
        winJettonSymbol: null,
        winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
        referralAmount: referralNano ? nanoToTon(referralNano) : null,
        referralPercent:
          buyAmount && referralNano
            ? Math.round((nanoToTon(referralNano) / buyAmount) * 10000) / 100
            : null,
        referralAddress,
        buyAmount,
        buyCurrency,
        buyMasterAddress,
        textComment,
      };
    }

    return null;
  }
}
