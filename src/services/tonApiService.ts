import axios from "axios";
import { CONFIG } from "../config/config.js";
import { RawTrace, LotteryTx } from "../types/index.js";
import { Address } from "@ton/core";

export class TonApiService {
  private client = axios.create({
    baseURL: CONFIG.apiEndpoint,
    params: { api_key: CONFIG.apiKey },
  });

  /**
   * Fetches all traces from TON API for the configured contract address using pagination.
   */
  async fetchAllTraces(): Promise<RawTrace[]> {
    console.log(
      `[API] ▶️  Start fetching traces for ${CONFIG.contractAddress}`
    );
    const all: RawTrace[] = [];
    let offset = 0;

    while (true) {
      console.log(
        `  [API] 🔄  Fetch offset=${offset}, limit=${CONFIG.pageLimit}`
      );
      const { data } = await this.client.get("/traces", {
        params: {
          account: CONFIG.contractAddress,
          limit: CONFIG.pageLimit,
          offset,
          include_actions: true,
        },
      });

      const traces = data.traces as RawTrace[];
      console.log(`  [API] ✅  Got ${traces.length} traces`);
      if (!traces.length) break;

      all.push(...traces);
      offset += CONFIG.pageLimit;
    }

    console.log(`📊 [API] Total traces fetched: ${all.length}`);
    return all;
  }

  /**
   * Converts a RawTrace object into a structured LotteryTx object.
   * Returns null if required fields are missing or trace is irrelevant.
   */
  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    // Step 1: Locate the NFT mint action
    const mint = trace.actions.find((a) => a.type === "nft_mint");
    if (
      !mint ||
      !mint.details.nft_item ||
      !mint.details.nft_collection ||
      !mint.details.nft_item_index
    ) {
      return null;
    }

    // Step 2: Determine participant from the first transaction
    const firstTxHash = trace.transactions_order?.[0];
    const firstTx = firstTxHash ? trace.transactions[firstTxHash] : null;
    const rawSource = firstTx?.in_msg?.source ?? firstTx?.account;
    if (!rawSource) return null;

    let participant: string;
    try {
      participant = Address.parse(rawSource).toString({
        bounceable: true,
        urlSafe: true,
      });
    } catch {
      console.warn(`[API] ⚠️ Invalid participant address: ${rawSource}`);
      return null;
    }

    // Step 3: Parse NFT data
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

    // Step 4: Determine win status and prize
    const winAct = trace.actions.find((a) => a.details?.comment);
    const winComment = winAct?.details?.comment ?? null;

    let winAmount = 0;
    if (winComment) {
      switch (winComment) {
        case "x1":
          winAmount = 10;
          break;
        case "x2":
          winAmount = 25;
          break;
        case "x3":
          winAmount = 50;
          break;
        case "x4":
          winAmount = 180;
          break;
        case "x5":
          winAmount = 700;
          break;
        case "x6":
          winAmount = 1800;
          break;
        case "x7":
          winAmount = 10000;
          break;
        default:
          winAmount = 0;
          break;
      }
    }

    const isWin = Boolean(winComment?.startsWith("x"));

    return {
      participant,
      nftAddress,
      collectionAddress,
      nftIndex,
      timestamp: trace.start_utime,
      txHash: trace.external_hash,
      lt: trace.start_lt,
      isWin,
      winComment,
      winAmount,
    };
  }
}
