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

// Your canonical tx model
export interface LotteryTx {
  participant: string;
  nftAddress?: string;
  collectionAddress?: string;
  nftIndex?: number;
  timestamp: number;
  txHash: string;
  lt: string;
  isWin: boolean;
  comment?: string;
  value: string;
}
