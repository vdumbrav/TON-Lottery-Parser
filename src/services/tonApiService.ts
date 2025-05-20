import axios from 'axios';
import { CONFIG } from '../config/config.js';
import { RawTrace, TraceAction, LotteryTx } from '../types/index.js';

export class TonApiService {
  private client = axios.create({
    baseURL: CONFIG.apiEndpoint,
    params: { api_key: CONFIG.apiKey }
  });

  /** Fetch all traces for a given tx hash */
  async fetchTraces(txHash: string): Promise<RawTrace[]> {
    const { data } = await this.client.get('/traces', {
      params: { tx_hash: txHash, include_actions: true }
    });
    return data.traces as RawTrace[];
  }

  /** Fetch all traces for every transaction on the contract */
  async fetchAllTraces(): Promise<RawTrace[]> {
    const allTraces: RawTrace[] = [];
    let page = 0;

    // We don't have a direct “list all tx” in v3, so page over logical time
    // Start from the highest LT and page backwards until none left
    let ltCursor: string | undefined = undefined;
    let more = true;

    while (more) {
      const params: any = {
        address: CONFIG.contractAddress,
        limit: CONFIG.pageLimit,
        archival: true,
        include_actions: true
      };
      if (ltCursor) params.lt = ltCursor;

      const { data } = await this.client.get('/traces', { params });
      const traces = data.traces as RawTrace[];
      if (traces.length === 0) break;

      allTraces.push(...traces);
      ltCursor = traces[traces.length - 1].start_lt;
      more = traces.length === CONFIG.pageLimit;
      page++;
      if (page > 1000) break; // safety
    }

    return allTraces;
  }

  /** Map a single RawTrace into your CSV-friendly model */
  mapTraceToLotteryTx(trace: RawTrace): LotteryTx {
    // 1) find the nft_mint action
    const mint = trace.actions.find((a: TraceAction) => a.type === 'nft_mint');

    // 2) extract participant, nft, collection, index
    const participant = mint?.details.owner ?? '<unknown>';
    const nftAddress = mint?.details.nft_item;
    const collectionAddress = mint?.details.nft_collection;
    const nftIndex = mint ? Number(mint.details.nft_item_index) : undefined;

    // 3) find any action that carried a comment
    const commentAction = trace.actions.find(a => a.details.comment);
    const comment = commentAction?.details.comment;
    const isWin = Boolean(comment && comment.startsWith('x'));

    // 4) often the transfer value lives on the ton_transfer action
    const transfer = trace.actions.find(a => a.type === 'ton_transfer');
    const value = transfer?.details.value ?? '0';

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
      value
    };
  }
}
