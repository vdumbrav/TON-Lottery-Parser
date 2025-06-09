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
  return (
    typeof d === "object" &&
    typeof (d as any).asset === "string" &&
    typeof (d as any).sender === "string" &&
    typeof (d as any).receiver === "string"
  );
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
    if (!raw) return 0;
    const dec = decimals ?? 9;
    const num = Number(raw) / 10 ** dec;
    return Math.round(num * 1e6) / 1e6;
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
      const jetton = d as JettonTransferDetailsV3;
      let symbol = "JETTON";
      let decimals = 9;
      const meta = this.jettonMeta?.[jetton.asset]?.token_info?.[0];

      if (meta) {
        symbol = typeof meta.symbol === "string" ? meta.symbol : symbol;
        decimals = Number(meta.extra?.decimals ?? decimals);
      }

      const master = this.normalizeAddress(jetton.asset);

      return {
        sender: this.normalizeAddress(jetton.sender),
        receiver: this.normalizeAddress(jetton.receiver),
        amount: this.jetAmount(jetton.amount, decimals),
        symbol,
        master,
      };
    }

    if (isJettonV2(d)) {
      const jetton = d as JettonTransferDetails;
      const info = jetton.jetton ?? {};
      const decimals = Number(info.decimals ?? 9);
      const symbol = typeof info.symbol === "string" ? info.symbol : "JETTON";
      const master = info.master ? this.normalizeAddress(info.master) : null;

      return {
        sender: this.normalizeAddress(jetton.source!),
        receiver: this.normalizeAddress(jetton.destination!),
        amount: this.jetAmount(jetton.value, decimals),
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
        trace.transactions[firstTx]?.account ??
        trace.trace?.in_msg?.source
      : null;

    if (!rawSource) {
      console.warn("Missing source address for trace:", trace.trace_id);
      return null;
    }

    let participant: string;
    try {
      participant = this.normalizeAddress(rawSource);
    } catch {
      return null;
    }

    let winComment: string | null = null;
    let winAmount: number | null = null;
    let winJettonAmount: number | null = null;
    let winJettonSymbol: string | null = null;
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
              console.log("Invalid referral address:", e);
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
            winJettonAmount = jetton.amount;
            winJettonSymbol = jetton.symbol;
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
          console.log("Failed to parse jetton_transfer:", e);
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
      finalReferralAmount = referralJettonAmount ?? referralTonAmount ?? 0;
      finalReferralAddress =
        referralJettonAddress ?? referralTonAddress ?? null;
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
      if (isNaN(nftIndex)) {
        console.warn("Invalid NFT index:", mint.details.nft_item_index);
        return null;
      }

      return {
        participant,
        nftAddress,
        collectionAddress,
        nftIndex,
        timestamp: trace.start_utime,
        txHash,
        lt: trace.start_lt,
        isWin: (winAmount ?? 0) > 0 || winJettonAmount !== null,
        winComment,
        winAmount,
        winJettonAmount,
        winJettonSymbol,
        winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
        referralAmount: finalReferralAmount,
        referralAddress,
        buyAmount,
        buyCurrency,
        buyMasterAddress,
      };
    }

    if ((winAmount ?? 0) > 0 || winJettonAmount !== null) {
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
        winJettonAmount,
        winJettonSymbol,
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
