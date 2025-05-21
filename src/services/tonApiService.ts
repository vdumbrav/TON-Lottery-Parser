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
    // find NFT mint
    const mint = trace.actions.find((a: TraceAction) => a.type === "nft_mint");

    // convert addresses to friendly
    const participant = mint?.details.owner
      ? Address.parse(mint!.details.owner).toString({
          bounceable: true,
          urlSafe: true,
        })
      : "<unknown>";
    const nftAddress = mint?.details.nft_item
      ? Address.parse(mint!.details.nft_item).toString({
          bounceable: true,
          urlSafe: true,
        })
      : undefined;
    const collectionAddress = mint?.details.nft_collection
      ? Address.parse(mint!.details.nft_collection).toString({
          bounceable: true,
          urlSafe: true,
        })
      : undefined;
    const nftIndex = mint ? Number(mint.details.nft_item_index) : undefined;

    // comment holds win info
    const commentAct = trace.actions.find((a) => a.details.comment);
    const win = commentAct?.details.comment;
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
