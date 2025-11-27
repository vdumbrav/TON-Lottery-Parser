// TonAPI response types

export interface TonApiAccount {
  address: string;
  is_scam: boolean;
  is_wallet: boolean;
}

export interface TonApiMessage {
  msg_type: string;
  value: number;
  source?: TonApiAccount;
  destination?: TonApiAccount;
  op_code?: string;
  decoded_op_name?: string;
  decoded_body?: {
    text?: string;
  };
}

export interface TonApiTransaction {
  hash: string;
  lt: number;
  utime: number;
  account: TonApiAccount;
  success: boolean;
  in_msg?: TonApiMessage;
  out_msgs?: TonApiMessage[];
  total_fees: number;
}

export interface TonApiTransactionsResponse {
  transactions: TonApiTransaction[];
}

// Contract data from get_full_data method
export interface ContractFullData {
  ticketsSoldTon: number;
  ticketsSoldJetton: number;
  ticketPriceTon: bigint;
  ticketPriceJetton: bigint;
}
