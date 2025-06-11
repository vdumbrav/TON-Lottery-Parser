import axios from "axios";
import { Cell } from "@ton/core";
import { CONFIG } from "../config/config.js";
import {
  RawTrace,
  LotteryTx,
  JettonTransferDetails,
  TraceActionDetails,
  JettonTransferDetailsV3,
} from "../types/index.js";
import { nanoToTon, delay, normalizeAddress, tryNormalizeAddress } from "../core/utils.js";

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

export class ApiServiceJetton {
  private readonly apiClient = axios.create({
    baseURL: CONFIG.apiEndpoint,
    timeout: 10000,
    params: { api_key: CONFIG.apiKey },
  });

  private readonly contractAddress = normalizeAddress(CONFIG.contractAddress);

  private jettonMetadata: Record<string, any> = {};

  private convertJettonAmount(rawAmount?: string, decimals = 9): number {
    if (!rawAmount) return 0;
    const amount = Number(rawAmount) / 10 ** decimals;
    return Math.round(amount * 1e6) / 1e6;
  }

  private extractReferralPercent(details: TraceActionDetails): number | null {
    const payloadCandidate = (details as JettonTransferDetailsV3)?.forward_payload;
    if (typeof payloadCandidate !== "string") return null;
    try {
      const cell = Cell.fromBase64(payloadCandidate);
      const slice = cell.beginParse();
      const opcode = slice.loadUint(32);
      if (opcode !== OP_REFF) return null;
      const percent = slice.loadUint(8);
      return percent;
    } catch {
      return null;
    }
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
      const sender = tryNormalizeAddress(transfer.sender);
      const receiver = tryNormalizeAddress(transfer.receiver);
      const master = tryNormalizeAddress(transfer.asset);
      if (!sender || !receiver || !master) {
        throw new Error("Invalid jetton transfer address");
      }
      return {
        sender,
        receiver,
        amount: this.convertJettonAmount(transfer.amount, decimals),
        symbol,
        master,
      };
    }
    if (isJettonTransferV2(details)) {
      const transfer = details as JettonTransferDetails;
      const info = transfer.jetton ?? {};
      const decimals = Number(info.decimals ?? 9);
      const symbol = typeof info.symbol === "string" ? info.symbol : "JETTON";
      const masterAddress = info.master ? tryNormalizeAddress(info.master) : null;
      const sender = tryNormalizeAddress(transfer.source!);
      const receiver = tryNormalizeAddress(transfer.destination!);
      if (!sender || !receiver) {
        throw new Error("Invalid jetton transfer address");
      }
      return {
        sender,
        receiver,
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

    const participantAddress = tryNormalizeAddress(initialSource);
    if (!participantAddress) {
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
    let referralJettonPercent: number | null = null;
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
          ? tryNormalizeAddress(action.details.destination)
          : null;
        const source = action.details?.source
          ? tryNormalizeAddress(action.details.source)
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
          const percent = this.extractReferralPercent(action.details);
          if (percent !== null) {
            referralJettonAmount =
              (referralJettonAmount ?? 0) + transfer.amount;
            referralJettonReceiver = transfer.receiver;
            if (referralJettonPercent === null) {
              referralJettonPercent = percent;
            }
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
    let finalReferralPercent: number | null = null;
    if (referralJettonAmount && referralJettonAmount > 0) {
      finalReferralAmount = referralJettonAmount;
      finalReferralReceiver = referralJettonReceiver;
      finalReferralPercent = referralJettonPercent;
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

    if (
      mintAction &&
      mintAction.details &&
      typeof mintAction.details.nft_item === "string" &&
      typeof mintAction.details.nft_collection === "string" &&
      typeof mintAction.details.nft_item_index === "string"
    ) {
      const nftIndex = Number(mintAction.details.nft_item_index);
      if (Number.isNaN(nftIndex)) return null;

      const nftAddress = tryNormalizeAddress(mintAction.details.nft_item);
      const collectionAddress = tryNormalizeAddress(
        mintAction.details.nft_collection
      );
      if (!nftAddress || !collectionAddress) return null;

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
        referralPercent: finalReferralPercent,
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
        referralPercent: finalReferralPercent,
        referralAddress: finalReferralReceiver,
        buyAmount: purchaseAmount,
        buyCurrency: purchaseCurrency,
        buyMasterAddress: purchaseJettonMaster,
      };
    }

    return null;
  }
}
