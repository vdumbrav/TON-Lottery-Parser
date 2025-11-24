import axios from "axios";
import { CONFIG } from "../config/config.js";
import { LotteryTx, RawTrace, TraceAction, Transaction } from "../types/index.js";
import { tryNormalizeAddress } from "../core/utils.js";
import { delay } from "../core/utils.js";
import { TransactionValidator } from "../core/validator.js";

const PRIZE_MAP: Record<string, number> = {
  x1: 1,
  x3: 3,
  x7: 7,
  x20: 20,
  x77: 77,
  x200: 200,
  jp: 1000,
  jackpot: 1000,
};

export class ApiServiceTon {
  private client: any;
  private contract: string;
  private validator: TransactionValidator;

  constructor() {
    const normalizedContract = tryNormalizeAddress(CONFIG.contractAddress);
    if (!normalizedContract) {
      throw new Error(`Invalid contract address: ${CONFIG.contractAddress}`);
    }
    this.contract = normalizedContract;
    this.validator = new TransactionValidator(normalizedContract);

    this.client = axios.create({
      baseURL: CONFIG.apiEndpoint,
      timeout: 60000,
      params: {
        api_key: CONFIG.apiKey,
      },
    });
  }

  async fetchAllTraces(): Promise<RawTrace[]> {
    console.log("[API-TON] start fetching traces");
    const all: RawTrace[] = [];
    let offset = 0;

    while (true) {
      const { data } = await this.client.get("/traces", {
        params: {
          account: CONFIG.contractAddress,
          limit: CONFIG.pageLimit,
          offset,
          include_actions: true,
        },
      });

      const traces = (data.traces as RawTrace[]) || [];
      if (!traces.length) break;
      all.push(...traces);
      offset += CONFIG.pageLimit;
      await delay(1000);
    }

    console.log(`[API-TON] fetched ${all.length} traces`);
    return all;
  }

  async fetchTracesIncremental(
    lastLt: string | null,
    onBatch: (traces: RawTrace[]) => Promise<void>
  ): Promise<void> {
    console.log("[API-TON] start fetching traces (incremental)");
    let offset = 0;
    let totalFetched = 0;

    while (true) {
      console.log(`[API-TON] fetching batch at offset ${offset}...`);

      const { data } = await this.client.get("/traces", {
        params: {
          account: CONFIG.contractAddress,
          limit: CONFIG.pageLimit,
          offset,
          include_actions: true,
        },
      });

      const traces = (data.traces as RawTrace[]) || [];
      if (!traces.length) break;

      totalFetched += traces.length;

      const newTraces = lastLt
        ? traces.filter(t => BigInt(t.start_lt) > BigInt(lastLt))
        : traces;

      if (newTraces.length > 0) {
        console.log(`[API-TON] processing ${newTraces.length} new traces...`);
        await onBatch(newTraces);
      }

      if (traces.length < CONFIG.pageLimit) break;
      offset += CONFIG.pageLimit;

      await delay(3000);
    }

    console.log(`[API-TON] Total fetched: ${totalFetched} traces`);
  }

  private b64ToHex(b64: string): string {
    return Buffer.from(b64, "base64").toString("hex");
  }

  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    if (!trace.actions || !trace.transactions_order) return null;

    const rootB64 = trace.trace?.tx_hash ?? trace.trace_id;
    const txHash = rootB64 ? this.b64ToHex(rootB64) : null;
    if (!txHash) return null;

    // Get the first transaction to identify participant
    const firstTx = trace.transactions_order[0];
    const rawSource =
      trace.transactions[firstTx]?.in_msg?.source ??
      trace.transactions[firstTx]?.account;

    if (!rawSource) return null;

    const participant = tryNormalizeAddress(rawSource);
    if (!participant) {
      console.warn(`[API-TON] ⚠ Invalid address: ${rawSource}`);
      return null;
    }

    const validation = this.validator.validateTrace(trace, participant);

    let winComment: string | null = null;
    let winAmount = 0;
    let winTonNano = 0n;
    let referralNano = 0n;
    let referralAddress: string | null = null;
    let buyAmount: number | null = null;
    let buyCurrency: string | null = null;
    let buyMasterAddress: string | null = null;
    let purchaseRecorded = false;

    let nftAddress: string | null = null;
    let collectionAddress: string | null = null;
    let nftIndex: number | null = null;

    for (const action of trace.actions) {
      const details = action.details;

      if (action.type === "nft_mint" && details) {
        if (details.nft_item && details.nft_collection && details.nft_item_index !== undefined) {
          const nftAddr = tryNormalizeAddress(details.nft_item);
          const collAddr = tryNormalizeAddress(details.nft_collection);

          if (nftAddr && collAddr) {
            nftAddress = nftAddr;
            collectionAddress = collAddr;
            const idx = parseInt(details.nft_item_index, 10);
            if (!isNaN(idx)) {
              nftIndex = idx;
            }
          }
        }
      }

      if (action.type === "contract_deploy" && details && !nftAddress) {
        const opcode = Number(details.opcode);
        if (opcode === 0x801a1fcc) {
          const nftAddr = details.destination ? tryNormalizeAddress(details.destination) : null;
          const collAddr = details.source ? tryNormalizeAddress(details.source) : null;

          if (nftAddr && collAddr) {
            nftAddress = nftAddr;
            collectionAddress = collAddr;
          }
        }
      }

      const dest = details?.destination;
      const src = details?.source;

      const destNorm = dest ? tryNormalizeAddress(dest) : null;
      const srcNorm = src ? tryNormalizeAddress(src) : null;

      const value = details?.value ? BigInt(details.value) : 0n;

      if (action.type === "ton_transfer") {
        const comment = details?.comment?.trim().toLowerCase();
        const prizeUsd = comment ? PRIZE_MAP[comment] : undefined;

        // Win from contract
        if (
          srcNorm === this.contract &&
          destNorm === participant &&
          prizeUsd !== undefined &&
          comment
        ) {
          winComment = comment;
          winAmount = prizeUsd;
          winTonNano = value;
        }

        // Referral from contract
        if (
          srcNorm === this.contract &&
          destNorm !== participant &&
          comment === "referral"
        ) {
          referralNano = value;
          referralAddress = destNorm || null;
        }

        // Purchase to contract
        if (
          !purchaseRecorded &&
          destNorm === this.contract &&
          srcNorm === participant &&
          value > 0n
        ) {
          buyAmount = Number(value) / 1e9;
          buyCurrency = "TON";
          purchaseRecorded = true;
        }
      }

      // Handle jetton transfers
      if (action.type === "jetton_transfer") {
        const jettonDetails = details as any;
        const amount = jettonDetails?.amount ? Number(jettonDetails.amount) : 0;
        const decimals = jettonDetails?.decimals ?? 9;
        const divisor = Math.pow(10, decimals);
        const symbol = jettonDetails?.symbol || "JETTON";
        const master = jettonDetails?.jetton_master;

        // Win jetton from contract
        const senderNorm = jettonDetails?.sender ? tryNormalizeAddress(jettonDetails.sender) : null;
        const receiverNorm = jettonDetails?.receiver ? tryNormalizeAddress(jettonDetails.receiver) : null;

        if (
          senderNorm === this.contract &&
          receiverNorm === participant &&
          amount > 0
        ) {
          const comment = jettonDetails?.comment?.trim().toLowerCase();
          const prizeUsd = comment ? PRIZE_MAP[comment] : undefined;

          if (prizeUsd !== undefined && comment) {
            winComment = comment;
            winAmount = prizeUsd;
          }
        }

        // Purchase with jetton
        if (
          !purchaseRecorded &&
          receiverNorm === this.contract &&
          senderNorm === participant &&
          amount > 0
        ) {
          buyAmount = amount / divisor;
          buyCurrency = symbol;
          buyMasterAddress = master ? tryNormalizeAddress(master) : null;
          purchaseRecorded = true;
        }
      }
    }

    // Build the lottery transaction with NFT data if found
    const result: LotteryTx = {
      participant,
      nftAddress,      // Will be null if no NFT found
      collectionAddress, // Will be null if no NFT found
      nftIndex,         // Will be null if no NFT found
      timestamp: trace.start_utime,
      txHash,
      lt: trace.start_lt,
      isWin: winAmount > 0,
      winComment,
      winAmount,
      winJettonAmount: null,
      winJettonSymbol: null,
      winTonAmount: winTonNano ? Number(winTonNano) / 1e9 : null,
      referralAmount: referralNano ? Number(referralNano) / 1e9 : null,
      referralPercent:
        buyAmount !== null && referralNano > 0n
          ? Math.round((Number(referralNano) / 1e9 / buyAmount) * 10000) / 100
          : null,
      referralAddress,
      buyAmount,
      buyCurrency,
      buyMasterAddress,
      isFake: validation.isFake,
      fakeReason: validation.fakeReason,
      validationScore: validation.validationScore,
    };

    // Only return if there's a purchase or a win
    if (purchaseRecorded || winAmount > 0) {
      return result;
    }

    return null;
  }
}