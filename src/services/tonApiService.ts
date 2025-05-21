import axios from "axios";
import { CONFIG } from "../config/config.js";
import { RawTrace, TraceAction, LotteryTx } from "../types/index.js";
import { Address } from "@ton/core";

export class TonApiService {
  private client = axios.create({
    baseURL: CONFIG.apiEndpoint,
    params: { api_key: CONFIG.apiKey },
  });

  /**
   * Page through /traces by account using limit/offset.
   * Returns all RawTrace entries for the contract.
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
   * Convert one RawTrace into your CSV-friendly record.
   */
  mapTraceToLotteryTx(trace: RawTrace): LotteryTx {
    // Locate the NFT mint action; if absent, skip this trace
    const mint = trace.actions.find((a) => a.type === "nft_mint");
    if (!mint) {
      // no mint, so we don’t produce a CSV row for this trace
      return null as any;
    }

    // Convert on-chain raw addresses to user-friendly form
    const participant = Address.parse(mint.details.owner).toString({
      bounceable: true,
      urlSafe: true,
    });
    const nftAddress = Address.parse(mint.details.nft_item).toString({
      bounceable: true,
      urlSafe: true,
    });
    const collectionAddress = Address.parse(
      mint.details.nft_collection
    ).toString({ bounceable: true, urlSafe: true });

    // nftIndex is always present on mint
    const nftIndex = Number(mint.details.nft_item_index);

    // Detect win comment
    const winAct = trace.actions.find((a) => a.details.comment);
    const win = winAct?.details.comment;
    const isWin = Boolean(win && win.startsWith("x"));

    return {
      participant,
      nftAddress,
      collectionAddress,
      nftIndex,
      timestamp: trace.start_utime,
      txHash: trace.external_hash,
      lt: trace.start_lt,
      isWin,
      win,
    };
  }
}
