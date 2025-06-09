import axios from "axios";
import { Buffer } from "buffer";
import { CONFIG } from "../config/config.js";
import {
  RawTrace,
  LotteryTx,
  JettonTransferDetails,
  TraceActionDetails,
  JettonTransferDetailsV3,
} from "../types/index.js";
import { Address } from "@ton/core";
import { nanoToTon, delay } from "../core/utils.js";

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

function isJettonV2(d: TraceActionDetails): d is JettonTransferDetails {
  return typeof (d as any)?.jetton === "object";
}

function isJettonV3(d: TraceActionDetails): d is JettonTransferDetailsV3 {
  return (d as any)?.asset !== undefined;
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
  private jettonMeta: Record<string, any> = {};

  private b64ToHex(b64: string): string {
    return Buffer.from(b64, "base64").toString("hex");
  }

  private jetAmount(raw: string | undefined, decimals: number): number {
    return raw ? Number(raw) / 10 ** decimals : 0;
  }

  private readDecimals(asset: string): number {
    return Number(
      this.jettonMeta?.[asset]?.token_info?.[0]?.extra?.decimals ?? 9
    );
  }

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
      await delay(1_000);
    }
    return all;
  }

  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    if (!trace.actions || !trace.transactions_order) return null;
    const rootB64 = trace.trace?.tx_hash ?? trace.trace_id;
    if (!rootB64) {
      console.warn(`[API] ⚠ Missing root tx hash`);
      return null;
    }
    const txHash = this.b64ToHex(rootB64);

    let winComment: string | null = null;
    let winAmount = 0;
    let winTonNano = 0n;
    let referralTonAmount: number | null = null;
    let referralJettonAmount: number | null = null;
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
      console.warn(`[API] ⚠ Missing source address for tx ${txHash}`);
      return null;
    }

    let participant: string;
    try {
      participant = Address.parse(rawSource).toString({
        bounceable: false,
        urlSafe: true,
      });
    } catch {
      console.warn(`[API] ⚠ Failed to parse source address: ${rawSource} in tx ${txHash}`);
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
          }
          if (prizeKey === "referral") {
            referralTonAmount = nanoToTon(value);
            if (!referralAddress && action.details?.destination) {
              try {
                referralAddress = Address.parse(
                  action.details.destination
                ).toString({ bounceable: false, urlSafe: true });
              } catch {
                console.warn(
                  `[API] ⚠ Invalid referral address: ${action.details.destination} in tx ${txHash}`
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
        const d = action.details as TraceActionDetails;
        const srcAddr = Address.parse(
          isJettonV3(d) ? (d as JettonTransferDetailsV3).sender : d.source!
        ).toString({ bounceable: false, urlSafe: true });
        const dstAddr = Address.parse(
          isJettonV3(d)
            ? (d as JettonTransferDetailsV3).receiver
            : d.destination!
        ).toString({ bounceable: false, urlSafe: true });

        let decimals = 9;
        let symbol = "JETTON";
        let master = "";

        if (isJettonV3(d)) {
          master = Address.parse((d as JettonTransferDetailsV3).asset).toString(
            {
              bounceable: false,
              urlSafe: true,
            }
          );
          decimals = this.readDecimals((d as JettonTransferDetailsV3).asset);
          symbol =
            this.jettonMeta?.[(d as JettonTransferDetailsV3).asset]
              ?.token_info?.[0]?.symbol ?? symbol;
        } else if (isJettonV2(d)) {
          const jet = (d as JettonTransferDetails).jetton ?? {};
          decimals = jet.decimals ?? 9;
          symbol = jet.symbol ?? symbol;
          master = jet.master
            ? Address.parse(jet.master).toString({
                bounceable: false,
                urlSafe: true,
              })
            : "";
        }

        const amount = this.jetAmount(
          isJettonV3(d) ? (d as JettonTransferDetailsV3).amount : d.value,
          decimals
        );

        if (
          !purchaseRecorded &&
          srcAddr === participant &&
          dstAddr === this.contract
        ) {
          buyAmount = amount;
          buyCurrency = symbol;
          buyMasterAddress = master || null;
          purchaseRecorded = true;
          continue;
        }
        if (srcAddr === this.contract && dstAddr === participant) {
          winAmount = amount;
          winComment = `${amount} ${symbol}`;
          continue;
        }
        if (srcAddr === this.contract && dstAddr !== participant) {
          referralJettonAmount = (referralJettonAmount ?? 0) + amount;
          referralAddress = dstAddr;
          continue;
        }
      }
    }

    if (referralJettonAmount !== null && referralTonAmount !== null) {
      console.warn(
        `[API] ⚠ Both TON and jetton referrals detected in tx ${txHash}`
      );
    }
    const referralAmount =
      referralJettonAmount !== null ? referralJettonAmount : referralTonAmount;

    const mint = trace.actions.find((a) => a.type === "nft_mint");
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
      ).toString({ bounceable: false, urlSafe: true });
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
        winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
        referralAmount,
        referralAddress,
        buyAmount,
        buyCurrency,
        buyMasterAddress,
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
        winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
        referralAmount,
        referralAddress,
        buyAmount,
        buyCurrency,
        buyMasterAddress,
      };
    }
    return null;
  }
}
