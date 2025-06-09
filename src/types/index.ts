export interface TraceActionDetails {
  source?: string;
  destination?: string;
  value?: string;
  comment?: string | null; // Can be null
  owner?: string;
  nft_item?: string;
  nft_collection?: string;
  nft_item_index?: string; // API returns as string, needs conversion
  opcode?: string;
  // ... other possible fields
}

export interface TokenInfo {
  type: "jetton_masters" | string;
  name: string;
  symbol: string;
  extra: {
    decimals?: string;
    address?: string;
    [k: string]: unknown;
  };
}

export interface TraceMetadata {
  [addr: string]: {
    is_indexed: boolean;
    token_info: TokenInfo[];
  };
}

export interface JettonInfo {
  decimals?: number;
  symbol?: string;
  master?: string;
}

export interface JettonTransferDetails extends TraceActionDetails {
  jetton?: JettonInfo;
}

export interface JettonTransferDetailsV3 extends TraceActionDetails {
  asset: string;
  amount: string;
  sender_jetton_wallet: string;
  receiver_jetton_wallet: string;
  forward_payload?: string | null;
  forward_amount?: string;
}

export type AnyJettonDetails = JettonTransferDetails | JettonTransferDetailsV3;

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
    | "jetton_transfer"
    | "nft_mint"
    | "contract_deploy"
    | string;
  details: TraceActionDetails | JettonTransferDetails;
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
  metadata?: TraceMetadata;
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
  /** Amount the participant spent to buy the ticket */
  buyAmount: number | null;
  /** Currency used for the purchase (e.g. `TON` or jetton symbol) */
  buyCurrency: string | null;
  /** Jetton master address if the ticket was bought with a jetton */
  buyMasterAddress: string | null;
}

export * from "./lottery.js";
