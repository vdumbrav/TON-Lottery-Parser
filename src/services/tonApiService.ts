// src/services/tonApiService.ts
import axios from "axios";
import { CONFIG } from "../config/config.js";
import { RawTrace, TraceAction, LotteryTx } from "../types/index.js";

export class TonApiService {
  private client = axios.create({
    baseURL: CONFIG.apiEndpoint,
    params: { api_key: CONFIG.apiKey },
  });

  /** Page through /traces by account, using limit & offset */
  async fetchAllTraces(): Promise<RawTrace[]> {
    console.log(
      `[API] ▶️  Start fetching traces for ${CONFIG.contractAddress}`
    );
    const all: RawTrace[] = [];
    let offset = 0;

    while (true) {
      console.log(
        `  [API] 🔄  Fetching traces offset=${offset}, limit=${CONFIG.pageLimit}`
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
      console.log(`  [API] ✅  Received ${traces.length} traces`);
      if (!traces.length) break;
      all.push(...traces);
      offset += CONFIG.pageLimit;
    }

    console.log(`📊 [API] Completed: fetched total ${all.length} traces`);
    return all;
  }

  mapTraceToLotteryTx(trace: RawTrace): LotteryTx {
    const mint = trace.actions.find((a: TraceAction) => a.type === "nft_mint");
    const participant = mint?.details.owner ?? "<unknown>";
    const nftAddress = mint?.details.nft_item;
    const collectionAddress = mint?.details.nft_collection;
    const nftIndex = mint ? Number(mint.details.nft_item_index) : undefined;
    const commentAct = trace.actions.find((a) => a.details.comment);
    const comment = commentAct?.details.comment;
    const isWin = Boolean(comment && comment.startsWith("x"));
    const transfer = trace.actions.find((a) => a.type === "ton_transfer");
    const value = transfer?.details.value ?? "0";

    return {
      participant,
      nftAddress,
      collectionAddress,
      nftIndex,
      timestamp: trace.start_utime,
      txHash: trace.external_hash,
      lt: trace.start_lt,
      isWin,
      comment,
      value,
    };
  }
}
