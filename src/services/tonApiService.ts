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

function isJettonTransferV2(
  details: TraceActionDetails
): details is JettonTransferDetails {
  return typeof (details as any)?.jetton === "object";
}

function isJettonTransferV3(
  details: TraceActionDetails
): details is JettonTransferDetailsV3 {
  return (
    typeof details === "object" &&
    typeof (details as any).asset === "string" &&
    typeof (details as any).sender === "string" &&
    typeof (details as any).receiver === "string"
  );
}

export class TonApiService {
  private readonly apiClient = axios.create({
    baseURL: CONFIG.apiEndpoint,
    timeout: 10000,
    params: { api_key: CONFIG.apiKey },
  });

  private readonly contractAddress = Address.parse(
    CONFIG.contractAddress
  ).toString({
    bounceable: false,
    urlSafe: true,
  });

  private jettonMetadata: Record<string, any> = {};

  private normalizeAddress(rawAddress: string): string {
    return Address.parse(rawAddress).toString({
      bounceable: false,
      urlSafe: true,
    });
  }

  private convertJettonAmount(rawAmount?: string, decimals = 9): number {
    if (!rawAmount) return 0;
    const amount = Number(rawAmount) / 10 ** decimals;
    return Math.round(amount * 1e6) / 1e6;
  }

  private isReferral(details: any): boolean {
    const payloadCandidate: unknown = details?.forward_payload;
    return (
      typeof payloadCandidate === "string" &&
      payloadCandidate.includes("ClJFRkY")
    );
  }

  async fetchAllTraces(): Promise<RawTrace[]> {
    const traces: RawTrace[] = [];
    let offset = 0;
    while (true) {
      const { data } = await this.apiClient.get("/traces", {
        params: {
          account: CONFIG.contractAddress,
          limit: CONFIG.pageLimit,
          offset,
          include_actions: true,
        },
      });
      const batch: RawTrace[] = data.traces ?? [];
      if (!batch.length) break;
      traces.push(...batch);
      if (data.metadata) Object.assign(this.jettonMetadata, data.metadata);
      offset += CONFIG.pageLimit;
      await delay(1000);
    }
    return traces;
  }

  private extractJettonTransfer(details: TraceActionDetails) {
    if (isJettonTransferV3(details)) {
      const transfer = details as JettonTransferDetailsV3;
      let symbol = "JETTON";
      let decimals = 9;
      const metadata = this.jettonMetadata?.[transfer.asset]?.token_info?.[0];
      if (metadata) {
        if (typeof metadata.symbol === "string") symbol = metadata.symbol;
        decimals = Number(metadata.extra?.decimals ?? decimals);
      }
      return {
        sender: this.normalizeAddress(transfer.sender),
        receiver: this.normalizeAddress(transfer.receiver),
        amount: this.convertJettonAmount(transfer.amount, decimals),
        symbol,
        master: this.normalizeAddress(transfer.asset),
      };
    }
    if (isJettonTransferV2(details)) {
      const transfer = details as JettonTransferDetails;
      const info = transfer.jetton ?? {};
      const decimals = Number(info.decimals ?? 9);
      const symbol = typeof info.symbol === "string" ? info.symbol : "JETTON";
      const masterAddress = info.master
        ? this.normalizeAddress(info.master)
        : null;
      return {
        sender: this.normalizeAddress(transfer.source!),
        receiver: this.normalizeAddress(transfer.destination!),
        amount: this.convertJettonAmount(transfer.value, decimals),
        symbol,
        master: masterAddress,
      };
    }
    throw new Error("Unknown jetton transfer format");
  }

  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    if (!trace.actions || !trace.transactions_order) return null;

    const traceHashBase64 = trace.trace?.tx_hash ?? trace.trace_id;
    const transactionHashHex = Buffer.from(traceHashBase64, "base64").toString(
      "hex"
    );
    const firstTransactionId = trace.transactions_order[0];
    const firstTransaction = trace.transactions[firstTransactionId];
    const initialSource =
      firstTransaction?.in_msg?.source ??
      firstTransaction?.account ??
      trace.trace?.in_msg?.source;
    if (!initialSource) return null;

    let participantAddress: string;
    try {
      participantAddress = this.normalizeAddress(initialSource);
    } catch {
      return null;
    }

    let winComment: string | null = null;
    let wonTonNano = 0n;
    let wonJettonAmount: number | null = null;
    let wonJettonSymbol: string | null = null;
    let referralTonAmount: number | null = null;
    let referralTonReceiver: string | null = null;
    let referralJettonAmount: number | null = null;
    let referralJettonReceiver: string | null = null;
    let purchaseAmount: number | null = null;
    let purchaseCurrency: string | null = null;
    let purchaseJettonMaster: string | null = null;
    let purchaseRecorded = false;

    for (const action of trace.actions) {
      if (action.type === "ton_transfer" || action.type === "call_contract") {
        const opcode =
          action.details?.opcode !== undefined
            ? Number(action.details.opcode)
            : null;
        const valueNano =
          action.details?.value !== undefined
            ? BigInt(action.details.value)
            : 0n;
        const destination = action.details?.destination
          ? this.normalizeAddress(action.details.destination)
          : null;
        const source = action.details?.source
          ? this.normalizeAddress(action.details.source)
          : null;

        if (
          !purchaseRecorded &&
          destination === this.contractAddress &&
          source === participantAddress &&
          valueNano > 0n
        ) {
          purchaseAmount = nanoToTon(valueNano);
          purchaseCurrency = "TON";
          purchaseJettonMaster = null;
          purchaseRecorded = true;
          continue;
        }
        if (opcode === OP_PRIZ) {
          wonTonNano += valueNano;
          winComment = "TON PRIZE";
          continue;
        }
        if (opcode === OP_REFF) {
          referralTonAmount = nanoToTon(valueNano);
          referralTonReceiver = destination;
          continue;
        }
      }

      if (action.type === "jetton_transfer") {
        let transfer;
        try {
          transfer = this.extractJettonTransfer(action.details);
        } catch {
          continue;
        }

        if (
          !purchaseRecorded &&
          transfer.sender === participantAddress &&
          transfer.receiver === this.contractAddress
        ) {
          purchaseAmount = transfer.amount;
          purchaseCurrency = transfer.symbol;
          purchaseJettonMaster = transfer.master;
          purchaseRecorded = true;
          continue;
        }

        if (transfer.sender === this.contractAddress) {
          const referralDetected = this.isReferral(action.details as any);
          if (referralDetected) {
            referralJettonAmount =
              (referralJettonAmount ?? 0) + transfer.amount;
            referralJettonReceiver = transfer.receiver;
          } else {
            wonJettonAmount = (wonJettonAmount ?? 0) + transfer.amount;
            wonJettonSymbol = transfer.symbol;
            winComment = `${transfer.amount} ${transfer.symbol}`;
          }
          continue;
        }
      }
    }

    let finalReferralAmount: number | null = null;
    let finalReferralReceiver: string | null = null;
    if (referralJettonAmount && referralJettonAmount > 0) {
      finalReferralAmount = referralJettonAmount;
      finalReferralReceiver = referralJettonReceiver;
    } else if (referralTonAmount && referralTonAmount > 0) {
      finalReferralAmount = referralTonAmount;
      finalReferralReceiver = referralTonReceiver;
    }

    const mintAction = trace.actions.find(
      (action) => action.type === "nft_mint"
    );

    const baseTransaction = {
      participant: participantAddress,
      timestamp: trace.start_utime,
      txHash: transactionHashHex,
      lt: trace.start_lt,
    };

    if (mintAction) {
      const nftAddress = this.normalizeAddress(
        (mintAction as any).details.nft_item
      );
      const collectionAddress = this.normalizeAddress(
        (mintAction as any).details.nft_collection
      );
      const nftIndex = Number((mintAction as any).details.nft_item_index);
      return {
        ...baseTransaction,
        nftAddress,
        collectionAddress,
        nftIndex,
        isWin: Boolean(winComment),
        winComment,
        winAmount: wonTonNano ? nanoToTon(wonTonNano) : null,
        winJettonAmount: wonJettonAmount ?? null,
        winJettonSymbol: wonJettonSymbol ?? null,
        winTonAmount: wonTonNano ? nanoToTon(wonTonNano) : null,
        referralAmount: finalReferralAmount,
        referralAddress: finalReferralReceiver,
        buyAmount: purchaseAmount,
        buyCurrency: purchaseCurrency,
        buyMasterAddress: purchaseJettonMaster,
      };
    }

    if (winComment || finalReferralAmount) {
      return {
        ...baseTransaction,
        nftAddress: null,
        collectionAddress: null,
        nftIndex: null,
        isWin: Boolean(winComment),
        winComment,
        winAmount: wonTonNano ? nanoToTon(wonTonNano) : null,
        winJettonAmount: wonJettonAmount ?? null,
        winJettonSymbol: wonJettonSymbol ?? null,
        winTonAmount: wonTonNano ? nanoToTon(wonTonNano) : null,
        referralAmount: finalReferralAmount,
        referralAddress: finalReferralReceiver,
        buyAmount: purchaseAmount,
        buyCurrency: purchaseCurrency,
        buyMasterAddress: purchaseJettonMaster,
      };
    }

    return null;
  }
}
