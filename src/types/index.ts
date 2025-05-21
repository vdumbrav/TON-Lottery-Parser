// Raw trace data from TonCenter v3
export interface TraceAction {
  action_id: string;
  type: string;
  start_lt: string;
  end_lt: string;
  transactions: string[];
  details: Record<string, any>;
}

export interface RawTrace {
  trace_id: string;
  external_hash: string;
  mc_seqno_start: string;
  mc_seqno_end: string;
  start_lt: string;
  start_utime: number;
  end_lt: string;
  end_utime: number;
  actions: TraceAction[];
  trace: any;
}

export interface LotteryTx {
  participant: string; // friendly address
  nftAddress?: string; // friendly NFT item address
  collectionAddress?: string; // friendly collection address
  nftIndex?: number;
  timestamp: number;
  txHash: string;
  lt: string;
  isWin: boolean;
  win?: string;
}
