export interface TraceActionDetails {
  source?: string;
  destination?: string;
  value?: string;
  /** Additional currencies transferred with the message (jettons) */
  extra_currencies?: Record<string, string>;
  comment?: string | null; // Can be null
  owner?: string;
  nft_item?: string;
  nft_collection?: string;
  nft_item_index?: string; // API returns as string, needs conversion
  opcode?: string;
  // ... other possible fields
}

export interface TraceAction {
  trace_id: string;
  action_id: string;
  start_lt: string;
  end_lt: string;
  start_utime: number;
  end_utime: number;
  transactions: string[];
  success: boolean;
  type:
    | "ton_transfer"
    | "call_contract"
    | "nft_mint"
    | "contract_deploy"
    | string;
  details: TraceActionDetails;
  trace_external_hash: string;
}

export interface InMsg {
  hash: string;
  source: string | null; // Can be null for external messages
  destination: string;
  message_content?: {
    hash: string;
    body: string;
    decoded: any | null;
  };
  // ... other InMsg fields
}

export interface Transaction {
  account: string; // The account address this transaction belongs to
  hash: string;
  lt: string;
  now: number;
  in_msg: InMsg;
  // ... other Transaction fields
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
  trace_info: {
    trace_state: string;
    messages: number;
    transactions: number;
    pending_messages: number;
    classification_state: string;
  };
  is_incomplete: boolean;
  actions: TraceAction[];
  trace: {
    tx_hash: string;
    in_msg_hash: string;
    children: any[];
  };
  transactions_order: string[];
  transactions: {
    [tx_hash: string]: Transaction;
  };
}

export interface LotteryTx {
  participant: string;
  nftAddress?: string | null;
  collectionAddress?: string | null;
  nftIndex?: number | null;
  timestamp: number;
  txHash: string;
  lt: string;
  isWin: boolean;
  winComment: string | null;
  winAmount: number;
  /** Actual TON amount transferred for the prize, if any (in TON) */
  winTonAmount: number | null;
  /** Referral payout amount in TON if present */
  referralAmount: number | null;
  /** Address that received the referral payout if present */
  referralAddress: string | null;
  /** Amount paid by the participant for the ticket */
  buyAmount: number;
  /** Token used to buy the ticket (`TON` or jetton address) */
  currency: string;
  /** Jetton master address if purchase used a jetton */
  masterAddress: string | null;
}
