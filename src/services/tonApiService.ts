import axios from "axios";
import { Buffer } from "buffer";
import { CONFIG } from "../config/config.js";
import { RawTrace, LotteryTx } from "../types/index.js";
import { Address } from "@ton/core";

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

    const mint = trace.actions.find((a) => a.type === "nft_mint");
    if (
      !mint ||
      !mint.details.nft_item ||
      !mint.details.nft_collection ||
      !mint.details.nft_item_index
    ) {
      console.log(`[API] ⛔ Skipped trace ${txHash} (no nft_mint)`);
      return null;
    }

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
        testOnly: true,
      });
    } catch {
      console.warn(`[API] ⚠ Invalid address: ${rawSource}`);
      return null;
    }

    const nftAddress = Address.parse(mint.details.nft_item).toString({
      bounceable: true,
      urlSafe: true,
    });

    const collectionAddress = Address.parse(
      mint.details.nft_collection
    ).toString({
      bounceable: true,
      urlSafe: true,
    });

    const nftIndex = Number(mint.details.nft_item_index);

    let winComment: string | null = null;
    let winAmount = 0;

    for (const action of trace.actions) {
      const comment = action.details?.comment;
      if (action.type === "ton_transfer" && comment) {
        switch (comment) {
          case "x1":
            winAmount = 10;
            break;
          case "x3":
            winAmount = 25;
            break;
          case "x7":
            winAmount = 50;
            break;
          case "x20":
            winAmount = 180;
            break;
          case "x77":
            winAmount = 700;
            break;
          case "x200":
            winAmount = 1800;
            break;
          case "jp":
            winAmount = 10000;
            break;
          default:
            winAmount = 0;
        }
        winComment = comment;
        console.log(`[API] 🎉 Win detected: ${comment} → ${winAmount} USDT`);
        break;
      }
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
    };
  }
}
