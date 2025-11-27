import axios from "axios";
import { CONFIG } from "../config/config.js";
import { LotteryTx } from "../types/index.js";
import { tryNormalizeAddress, delay } from "../core/utils.js";
import {
  TonApiTransaction,
  TonApiTransactionsResponse,
} from "../types/tonApi.js";
import {
  PRIZE_MAP,
  OP_PRIZ,
  OP_REFF,
  CONTRACT_DATA_INDEX,
} from "../constants/lottery.js";

export class ApiServiceTon {
  private client;
  private contract: string;
  private ticketPrice: number | null = null;

  constructor() {
    const normalizedContract = tryNormalizeAddress(CONFIG.contractAddress);
    if (!normalizedContract) {
      throw new Error(`Invalid contract address: ${CONFIG.contractAddress}`);
    }
    this.contract = normalizedContract;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (CONFIG.apiKey) {
      headers["Authorization"] = `Bearer ${CONFIG.apiKey}`;
    }

    this.client = axios.create({
      baseURL: CONFIG.apiEndpoint,
      timeout: 60000,
      headers,
    });
  }

  /**
   * Fetch ticket price from contract via get_full_data method (using toncenter API)
   */
  async fetchTicketPrice(): Promise<number> {
    if (this.ticketPrice !== null) {
      return this.ticketPrice;
    }

    try {
      const toncenterUrl = CONFIG.isTestnet
        ? "https://testnet.toncenter.com/api/v3"
        : "https://toncenter.com/api/v3";

      const { data } = await axios.get(
        `${toncenterUrl}/runGetMethod`,
        {
          params: {
            address: CONFIG.contractAddress,
            method: "get_full_data",
          },
          timeout: 15000,
        }
      );

      // Parse stack: ticket price for TON is at index 4
      const stack = data.result?.stack || [];
      const priceIndex = CONTRACT_DATA_INDEX.TICKET_PRICE_TON;

      if (stack[priceIndex]) {
        const priceNano = BigInt(stack[priceIndex][1] || "1000000000");
        this.ticketPrice = Number(priceNano) / 1e9;
      } else {
        this.ticketPrice = 1;
      }

      console.log(`[API-TON] Ticket price from contract: ${this.ticketPrice} TON`);
      return this.ticketPrice;
    } catch (err) {
      console.warn("[API-TON] Failed to fetch ticket price, using default 1 TON");
      this.ticketPrice = 1;
      return this.ticketPrice;
    }
  }

  async fetchAllTraces(): Promise<TonApiTransaction[]> {
    console.log("[API-TON] start fetching transactions from tonapi.io");
    const all: TonApiTransaction[] = [];
    let beforeLt: number | undefined = undefined;

    while (true) {
      const params: Record<string, any> = {
        limit: CONFIG.pageLimit,
      };
      if (beforeLt) {
        params.before_lt = beforeLt;
      }

      const { data } = await this.client.get(
        `/v2/blockchain/accounts/${CONFIG.contractAddress}/transactions`,
        { params }
      );

      const response = data as TonApiTransactionsResponse;
      const txs = response.transactions || [];
      if (!txs.length) break;

      all.push(...txs);

      if (all.length % 500 === 0 || txs.length < CONFIG.pageLimit) {
        console.log(`[API-TON] fetched ${all.length} transactions...`);
      }

      const lastTx = txs[txs.length - 1];
      beforeLt = lastTx.lt;

      if (txs.length < CONFIG.pageLimit) break;
      await delay(1100);
    }

    console.log(`[API-TON] fetched ${all.length} transactions total`);
    return all;
  }

  async fetchTracesIncremental(
    lastLt: string | null,
    onBatch: (txs: TonApiTransaction[]) => Promise<void>
  ): Promise<void> {
    console.log("[API-TON] start fetching transactions (incremental) from tonapi.io");

    // Fetch ticket price from contract first
    const ticketPrice = await this.fetchTicketPrice();

    let beforeLt: number | undefined = undefined;
    let totalFetched = 0;
    let shouldStop = false;
    const lastLtNum = lastLt ? Number(lastLt) : null;

    while (!shouldStop) {
      const params: Record<string, any> = {
        limit: CONFIG.pageLimit,
      };
      if (beforeLt) {
        params.before_lt = beforeLt;
      }

      console.log(`[API-TON] fetching batch... (total: ${totalFetched})`);

      const { data } = await this.client.get(
        `/v2/blockchain/accounts/${CONFIG.contractAddress}/transactions`,
        { params }
      );

      const response = data as TonApiTransactionsResponse;
      const txs = response.transactions || [];
      if (!txs.length) break;

      totalFetched += txs.length;

      const newTxs = lastLtNum
        ? txs.filter((t: TonApiTransaction) => t.lt > lastLtNum)
        : txs;

      if (newTxs.length > 0) {
        await onBatch(newTxs);
      }

      if (lastLtNum && newTxs.length < txs.length) {
        shouldStop = true;
        break;
      }

      const lastTx = txs[txs.length - 1];
      beforeLt = lastTx.lt;

      if (txs.length < CONFIG.pageLimit) break;
      await delay(1100);
    }

    console.log(`[API-TON] Total fetched: ${totalFetched} transactions`);
  }

  mapTraceToLotteryTx(tx: TonApiTransaction): LotteryTx | null {
    if (!tx.in_msg) return null;

    const txHash = tx.hash;

    // Get participant from incoming message source
    const participantRaw = tx.in_msg.source?.address;
    if (!participantRaw) return null;

    const participant = tryNormalizeAddress(participantRaw);
    if (!participant) return null;

    // Check if this is a transaction TO our contract
    const destAddr = tx.in_msg.destination?.address;
    const destNorm = destAddr ? tryNormalizeAddress(destAddr) : null;
    if (destNorm !== this.contract) return null;

    // Get purchase amount from incoming message
    let buyAmount: number | null = null;
    let buyCurrency: string | null = null;

    if (tx.in_msg.value && tx.in_msg.value > 0) {
      buyAmount = tx.in_msg.value / 1e9;
      buyCurrency = "TON";
    }

    // Validate by ticket price from contract
    const ticketPrice = this.ticketPrice || 1;
    if (!buyAmount || buyAmount !== ticketPrice) return null;

    // Process outgoing messages for wins and referrals
    let winComment: string | null = null;
    let winAmount = 0;
    let winTonNano = 0n;
    let referralAmount: number | null = null;
    let referralAddress: string | null = null;

    if (tx.out_msgs) {
      for (const msg of tx.out_msgs) {
        const recipientAddr = msg.destination?.address;
        const recipientNorm = recipientAddr ? tryNormalizeAddress(recipientAddr) : null;
        const comment = msg.decoded_body?.text?.trim().toLowerCase();
        const opCode = msg.op_code ? parseInt(msg.op_code, 16) : null;

        // Check for win (by opcode OP_PRIZ or prize comment)
        if (recipientNorm === participant && msg.value > 0) {
          if (opCode === OP_PRIZ || (comment && PRIZE_MAP[comment] !== undefined)) {
            winTonNano = BigInt(msg.value);
            winComment = comment || "prize";
            if (comment && PRIZE_MAP[comment]) {
              winAmount = PRIZE_MAP[comment];
            }
          }
        }

        // Check for referral payment (by opcode OP_REFF or comment)
        if ((opCode === OP_REFF || comment === "referral") && msg.value > 0) {
          referralAmount = msg.value / 1e9;
          referralAddress = recipientNorm;
        }
      }
    }

    const result: LotteryTx = {
      participant,
      nftAddress: null,
      collectionAddress: null,
      nftIndex: null,
      timestamp: tx.utime,
      txHash,
      lt: String(tx.lt),
      isWin: winAmount > 0,
      winComment,
      winAmount: winAmount || null,
      winJettonAmount: null,
      winJettonSymbol: null,
      winTonAmount: winTonNano ? Number(winTonNano) / 1e9 : null,
      referralAmount,
      referralPercent:
        referralAmount !== null && referralAmount > 0
          ? Math.round((referralAmount / buyAmount) * 10000) / 100
          : null,
      referralAddress,
      buyAmount,
      buyCurrency,
      buyMasterAddress: null,
      isFake: false,
      fakeReason: null,
      validationScore: 100,
    };

    return result;
  }
}
