export interface TraceActionDetailsBase {
  source?: string;
  destination?: string;
  value?: string;
  comment?: string | null;
  owner?: string;
  nft_item?: string;
  nft_collection?: string;
  nft_item_index?: string;
  opcode?: string;
}

export interface JettonInfo {
  decimals?: number | string;
  symbol?: string;
  master?: string;
}

export interface JettonTransferDetails extends TraceActionDetailsBase {
  jetton?: JettonInfo;
}

export interface JettonTransferDetailsV3 extends TraceActionDetailsBase {
  asset: string;
  sender: string;
  receiver: string;
  sender_jetton_wallet: string;
  receiver_jetton_wallet: string;
  amount: string;
  forward_payload?: string | null;
}

export type TraceActionDetails =
  | TraceActionDetailsBase
  | JettonTransferDetails
  | JettonTransferDetailsV3;

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
  details: TraceActionDetails;
  trace_external_hash: string;
}

export interface InMsg {
  hash: string;
  source: string | null;
  destination: string;
  message_content?: {
    hash: string;
    body: string;
    decoded: any | null;
  };
}

export interface Transaction {
  account: string;
  hash: string;
  lt: string;
  now: number;
  in_msg: InMsg;
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
    in_msg?: { source?: string };
  };
  transactions_order: string[];
  transactions: { [tx_hash: string]: Transaction };
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
  winAmount: number | null;
  winJettonAmount: number | null;
  winJettonSymbol: string | null;
  winTonAmount: number | null;
  referralAmount: number | null;
  referralAddress: string | null;
  buyAmount: number | null;
  buyCurrency: string | null;
  buyMasterAddress: string | null;
}
