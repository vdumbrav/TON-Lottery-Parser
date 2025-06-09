import axios from "axios";
import { CONFIG } from "../config/config.js";
import {
  RawTrace,
  LotteryTx,
  JettonTransferDetails,
  TraceActionDetails,
  JettonTransferDetailsV3,
} from "../types/index.js";
import { Address } from "@ton/core";
import { nanoToTon, delay } from "../core/utils.js";

const OP_PRIZ = 0x5052495a;
const OP_REFF = 0x52454646;

function isJettonV2(d: TraceActionDetails): d is JettonTransferDetails {
  return typeof (d as any)?.jetton === "object";
}

function isJettonV3(d: TraceActionDetails): d is JettonTransferDetailsV3 {
  return (d as any)?.asset !== undefined;
}

export class TonApiService {
  private client = axios.create({
    baseURL: CONFIG.apiEndpoint,
    timeout: 10000,
    params: { api_key: CONFIG.apiKey },
  });

  private contract = Address.parse(CONFIG.contractAddress).toString({
    bounceable: false,
    urlSafe: true,
  });

  private jettonMeta: Record<string, any> = {};

  private normalizeAddress(raw: string): string {
    return Address.parse(raw).toString({ bounceable: false, urlSafe: true });
  }

  private jetAmount(raw?: string, decimals?: number): number {
    return raw ? Number(raw) / 10 ** (decimals ?? 9) : 0;
  }

  private readDecimals(asset: string): number {
    const decimals = this.jettonMeta?.[asset]?.token_info?.[0]?.extra?.decimals;
    return typeof decimals === "number" ? decimals : 9;
  }

  async fetchAllTraces(): Promise<RawTrace[]> {
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
      const traces: RawTrace[] = data.traces || [];
      if (!traces.length) break;
      all.push(...traces);
      if (data.metadata) Object.assign(this.jettonMeta, data.metadata);
      offset += CONFIG.pageLimit;
      await delay(1000);
    }
    return all;
  }

  private getJettonDetails(d: TraceActionDetails) {
    if (isJettonV3(d)) {
      const decimals = this.readDecimals(d.asset);
      const symbol =
        this.jettonMeta?.[d.asset]?.token_info?.[0]?.symbol ?? "JETTON";
      const master = this.normalizeAddress(d.asset);
      return {
        sender: this.normalizeAddress(d.sender),
        receiver: this.normalizeAddress(d.receiver),
        amount: this.jetAmount(d.amount, decimals),
        symbol,
        master,
      };
    }

    if (isJettonV2(d)) {
      const jet = d.jetton ?? {};
      const decimals = jet.decimals ?? 9;
      const symbol = jet.symbol ?? "JETTON";
      const master = jet.master ? this.normalizeAddress(jet.master) : null;
      return {
        sender: this.normalizeAddress(d.source!),
        receiver: this.normalizeAddress(d.destination!),
        amount: this.jetAmount(d.value, decimals),
        symbol,
        master,
      };
    }

    throw new Error("Unknown jetton details format");
  }

  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    if (!trace.actions || !trace.transactions_order) return null;

    const rootB64 = trace.trace?.tx_hash ?? trace.trace_id;
    const txHash = Buffer.from(rootB64, "base64").toString("hex");
    const firstTx = trace.transactions_order?.[0];
    const rawSource = firstTx
      ? trace.transactions[firstTx]?.in_msg?.source ??
        trace.transactions[firstTx]?.account
      : null;

    if (!rawSource) return null;

    let participant: string;
    try {
      participant = this.normalizeAddress(rawSource);
    } catch {
      return null;
    }

    let winComment: string | null = null;
    let winAmount = 0;
    let winTonNano = 0n;
    let referralTonAmount: number | null = null;
    let referralTonAddress: string | null = null;
    let referralJettonAmount: number | null = null;
    let referralJettonAddress: string | null = null;
    let referralAddress: string | null = null;
    let buyAmount: number | null = null;
    let buyCurrency: string | null = null;
    let buyMasterAddress: string | null = null;
    let purchaseRecorded = false;

    for (const action of trace.actions) {
      if (action.type === "ton_transfer" || action.type === "call_contract") {
        const dest = action.details?.destination;
        const src = action.details?.source;
        const destNorm = dest ? this.normalizeAddress(dest) : null;
        const srcNorm = src ? this.normalizeAddress(src) : null;
        const value = action.details?.value ? BigInt(action.details.value) : 0n;
        const opcode = action.details?.opcode
          ? Number(action.details.opcode)
          : null;

        if (action.type === "ton_transfer" && opcode === OP_PRIZ) {
          winAmount = nanoToTon(value);
          winTonNano += value;
          winComment = "TON PRIZE";
          continue;
        }

        if (opcode === OP_REFF) {
          referralTonAmount = nanoToTon(value);
          if (!referralTonAddress && action.details?.destination) {
            try {
              referralTonAddress = this.normalizeAddress(
                action.details.destination
              );
            } catch (e) {
              console.log("e", e);
            }
          }
          continue;
        }
        if (
          !purchaseRecorded &&
          destNorm === this.contract &&
          srcNorm === participant &&
          value > 0n
        ) {
          buyAmount = nanoToTon(value);
          buyCurrency = "TON";
          buyMasterAddress = null;
          purchaseRecorded = true;
        }
      } else if (action.type === "jetton_transfer") {
        try {
          const jetton = this.getJettonDetails(action.details);
          if (
            !purchaseRecorded &&
            jetton.sender === participant &&
            jetton.receiver === this.contract
          ) {
            buyAmount = jetton.amount;
            buyCurrency = jetton.symbol;
            buyMasterAddress = jetton.master;
            purchaseRecorded = true;
            continue;
          }
          if (
            jetton.sender === this.contract &&
            jetton.receiver === participant
          ) {
            winAmount = jetton.amount;
            winComment = `${jetton.amount} ${jetton.symbol}`;
            continue;
          }
          if (
            jetton.sender === this.contract &&
            jetton.receiver !== participant
          ) {
            referralJettonAmount = (referralJettonAmount ?? 0) + jetton.amount;
            referralJettonAddress = jetton.receiver;
            continue;
          }
        } catch (e) {
          console.log("e", e);
        }
      }
    }

    let finalReferralAmount: number | null = null;
    let finalReferralAddress: string | null = null;
    const tonPositive = referralTonAmount !== null && referralTonAmount > 0;
    const jettonPositive =
      referralJettonAmount !== null && referralJettonAmount > 0;

    if (tonPositive && jettonPositive) {
      finalReferralAmount = referralJettonAmount;
      finalReferralAddress = referralJettonAddress;
    } else if (jettonPositive) {
      finalReferralAmount = referralJettonAmount;
      finalReferralAddress = referralJettonAddress;
    } else if (tonPositive) {
      finalReferralAmount = referralTonAmount;
      finalReferralAddress = referralTonAddress;
    } else {
      finalReferralAmount = referralJettonAmount ?? referralTonAmount;
      finalReferralAddress = referralJettonAddress ?? referralTonAddress;
    }

    referralAddress = finalReferralAddress;

    const mint = trace.actions.find((a) => a.type === "nft_mint");
    if (
      mint &&
      mint.details.nft_item &&
      mint.details.nft_collection &&
      mint.details.nft_item_index
    ) {
      const nftAddress = this.normalizeAddress(mint.details.nft_item);
      const collectionAddress = this.normalizeAddress(
        mint.details.nft_collection
      );
      const nftIndex = parseInt(mint.details.nft_item_index, 10);
      if (isNaN(nftIndex)) return null;
      return {
        participant,
        nftAddress,
        collectionAddress,
        nftIndex,
        timestamp: trace.start_utime,
        txHash,
        lt: trace.start_lt,
        isWin: winAmount > 0,
        winComment,
        winAmount,
        winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
        referralAmount: finalReferralAmount,
        referralAddress,
        buyAmount,
        buyCurrency,
        buyMasterAddress,
      };
    }

    if (winAmount > 0) {
      return {
        participant,
        nftAddress: null,
        collectionAddress: null,
        nftIndex: null,
        timestamp: trace.start_utime,
        txHash,
        lt: trace.start_lt,
        isWin: true,
        winComment,
        winAmount,
        winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
        referralAmount: finalReferralAmount,
        referralAddress,
        buyAmount,
        buyCurrency,
        buyMasterAddress,
      };
    }

    return null;
  }
}
