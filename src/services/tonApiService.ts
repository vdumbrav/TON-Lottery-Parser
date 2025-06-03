import axios from "axios";
import { Buffer } from "buffer";
import { CONFIG } from "../config/config.js";
import { RawTrace, LotteryTx } from "../types/index.js";
import { Address } from "@ton/core";

const CONTRACT_ADDRESS_NORMALIZED = Address.parse(
  CONFIG.contractAddress
).toString({ bounceable: false, urlSafe: true });

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

export class TonApiService {
  private client = axios.create({
    baseURL: CONFIG.apiEndpoint,
    params: { api_key: CONFIG.apiKey },
  });

  async fetchAllTraces(): Promise<RawTrace[]> {
    console.log(`[API] ▶ Fetching traces for ${CONFIG.contractAddress}`);
    const all: RawTrace[] = [];
    let offset = 0;

    while (true) {
      console.log(`[API] 🔄 offset=${offset}, limit=${CONFIG.pageLimit}`);
      const { data } = await this.client.get("/traces", {
        params: {
          account: CONFIG.contractAddress,
          limit: CONFIG.pageLimit,
          offset,
          include_actions: true,
        },
      });

      const traces = data.traces as RawTrace[];
      console.log(`[API] ✅ Got ${traces.length} traces`);

      if (!traces.length) break;
      all.push(...traces);
      offset += CONFIG.pageLimit;
    }

    console.log(`[API] 📦 Total traces fetched: ${all.length}`);
    return all;
  }

  private b64ToHex(b64: string): string {
    return Buffer.from(b64, "base64").toString("hex");
  }

  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    const rootB64 = trace.trace?.tx_hash ?? trace.trace_id;
    if (!rootB64) {
      console.warn(`[API] ⚠ Missing root tx hash`);
      return null;
    }

    const txHash = this.b64ToHex(rootB64);

    let winComment: string | null = null;
    let winAmount = 0;
    let winTonAmount = 0;
    let referralAmount = 0;
    let referralAddress: string | null = null;
    let buyAmount: number | null = null;
    let currency: string | null = null;
    let masterAddress: string | null = null;

    for (const action of trace.actions) {
      if (action.type !== "ton_transfer") continue;

      const comment = action.details?.comment;
      const value = Number(action.details?.value) || 0;
      const ton = value / 1e9;

      if (comment && PRIZE_MAP[comment]) {
        winAmount = PRIZE_MAP[comment];
        winComment = comment;
        winTonAmount += ton;
        console.log(
          `[API] 🎉 Win detected: ${comment} → ${winAmount} USDT, ${ton} TON`
        );
      } else if (comment === "referral") {
        referralAmount += ton;
        if (!referralAddress && action.details?.destination) {
          try {
            referralAddress = Address.parse(
              action.details.destination
            ).toString({
              bounceable: false,
              urlSafe: true,
            });
          } catch {
            console.warn(
              `[API] ⚠ Invalid referral address: ${action.details.destination}`
            );
          }
        }
        console.log(`[API] 🤝 Referral detected: ${ton} TON`);
      }
    }

    const mint = trace.actions.find((a) => a.type === "nft_mint");
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

    for (const action of trace.actions) {
      if (action.type !== "call_contract") continue;
      const src = action.details?.source;
      const dest = action.details?.destination;
      if (!src || !dest) continue;
      try {
        const srcNorm = Address.parse(src).toString({
          bounceable: false,
          urlSafe: true,
        });
        const destNorm = Address.parse(dest).toString({
          bounceable: false,
          urlSafe: true,
        });
        if (srcNorm !== participant || destNorm !== CONTRACT_ADDRESS_NORMALIZED)
          continue;
      } catch {
        continue;
      }

      if (
        action.details.extra_currencies &&
        Object.keys(action.details.extra_currencies).length > 0
      ) {
        const [master, valRaw] = Object.entries(
          action.details.extra_currencies
        )[0] as [string, any];
        const val =
          typeof valRaw === "string" ? valRaw : (valRaw as any).value ?? "0";
        buyAmount = Number(val) / 1e9;
        currency = master;
        masterAddress = master;
      } else if (action.details.value) {
        buyAmount = Number(action.details.value) / 1e9;
        currency = "TON";
      }
      break;
    }

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
        console.warn(`[API] ⚠ Invalid nft_index in tx ${txHash}`);
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
        winTonAmount: winTonAmount || null,
        referralAmount: referralAmount || null,
        referralAddress,
        buyAmount,
        currency,
        masterAddress,
      };
    }

    // 🎯 Case: prize only (no mint)
    if (winAmount > 0) {
      console.log(`[API] 🎯 Prize-only trace: ${txHash}`);
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
        winTonAmount: winTonAmount || null,
        referralAmount: referralAmount || null,
        referralAddress,
        buyAmount,
        currency,
        masterAddress,
      };
    }

    console.log(`[API] ⛔ Skipped trace ${txHash} (no nft_mint or prize)`);
    return null;
  }
}
