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
import { nanoToTon, delay, tryNormalizeAddress } from "../core/utils.js";
import { TransactionValidator } from "../core/validator.js";

const OP_PRIZ = 0x5052495a;
const OP_REFF = 0x52454646;
const OP_DEPLOY = 0x801b4fb4;

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
  private readonly apiClient;
  private readonly contractAddress = tryNormalizeAddress(CONFIG.contractAddress);
  private readonly validator = new TransactionValidator(CONFIG.contractAddress);
  private jettonMetadata: Record<string, any> = {};

  constructor() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (CONFIG.apiKey) {
      headers["Authorization"] = `Bearer ${CONFIG.apiKey}`;
    }

    this.apiClient = axios.create({
      baseURL: CONFIG.apiEndpoint,
      timeout: 60000,
      headers,
    });
  }

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

  private hasPrizeOpcode(details: TraceActionDetails): boolean {
    const payloadCandidate = (details as JettonTransferDetailsV3)?.forward_payload;
    if (typeof payloadCandidate !== "string") return false;
    try {
      const cell = Cell.fromBase64(payloadCandidate);
      const slice = cell.beginParse();
      const opcode = slice.loadUint(32);
      return opcode === OP_PRIZ;
    } catch {
      return false;
    }
  }

  async fetchAllTraces(): Promise<RawTrace[]> {
    console.log("[API-JETTON] start fetching traces from tonapi.io");
    const traces: RawTrace[] = [];
    let beforeLt: string | undefined = undefined;

    while (true) {
      const params: Record<string, any> = {
        limit: CONFIG.pageLimit,
      };
      if (beforeLt) {
        params.before_lt = beforeLt;
      }

      const { data } = await this.apiClient.get(
        `/v2/accounts/${CONFIG.contractAddress}/events`,
        { params }
      );

      const batch: RawTrace[] = data.traces ?? [];
      if (!batch.length) break;

      traces.push(...batch);

      // Get the last trace's lt for pagination
      const lastTrace = batch[batch.length - 1];
      beforeLt = lastTrace.start_lt;

      if (batch.length < CONFIG.pageLimit) break;
      await delay(1100); // Rate limit: 1 req/s
    }

    console.log(`[API-JETTON] fetched ${traces.length} traces`);
    return traces;
  }

  async fetchTracesIncremental(
    lastLt: string | null,
    onBatch: (traces: RawTrace[]) => Promise<void>
  ): Promise<void> {
    console.log("[API-JETTON] start fetching traces (incremental) from tonapi.io");
    let beforeLt: string | undefined = undefined;
    let totalFetched = 0;
    let shouldStop = false;

    while (!shouldStop) {
      const params: Record<string, any> = {
        limit: CONFIG.pageLimit,
      };
      if (beforeLt) {
        params.before_lt = beforeLt;
      }

      console.log(`[API-JETTON] fetching batch...`);

      const { data } = await this.apiClient.get(
        `/v2/accounts/${CONFIG.contractAddress}/events`,
        { params }
      );

      const traces: RawTrace[] = data.traces ?? [];
      if (!traces.length) break;

      totalFetched += traces.length;
      console.log(`[API-JETTON] fetched ${traces.length} traces (total: ${totalFetched})`);

      // Filter new traces (those with lt greater than lastLt)
      const newTraces = lastLt
        ? traces.filter(t => BigInt(t.start_lt) > BigInt(lastLt))
        : traces;

      if (newTraces.length > 0) {
        await onBatch(newTraces);
      }

      // If we've reached already processed transactions, stop
      if (lastLt && newTraces.length < traces.length) {
        shouldStop = true;
        break;
      }

      // Get the last trace's lt for pagination
      const lastTrace = traces[traces.length - 1];
      beforeLt = lastTrace.start_lt;

      if (traces.length < CONFIG.pageLimit) break;
      await delay(1100); // Rate limit: 1 req/s
    }

    console.log(`[API-JETTON] completed: ${totalFetched} total traces fetched`);
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

    // Validate the transaction
    const validation = this.validator.validateTrace(trace, participantAddress);

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
            continue;
          }

          if (this.hasPrizeOpcode(action.details)) {
            wonJettonAmount = (wonJettonAmount ?? 0) + transfer.amount;
            wonJettonSymbol = transfer.symbol;
            winComment = `${transfer.amount} ${transfer.symbol}`;
            continue;
          }

          continue;
        }

        if (
          transfer.receiver === participantAddress &&
          this.hasPrizeOpcode(action.details)
        ) {
          wonJettonAmount = (wonJettonAmount ?? 0) + transfer.amount;
          wonJettonSymbol = transfer.symbol;
          winComment = `${transfer.amount} ${transfer.symbol}`;
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

    let nftAddress: string | null = null;
    let collectionAddress: string | null = null;
    let nftIndex: number | null = null;

    for (const action of trace.actions) {
      if (action.type === "nft_mint" && action.details) {
        if (action.details.nft_item && action.details.nft_collection && action.details.nft_item_index !== undefined) {
          const nftAddr = tryNormalizeAddress(action.details.nft_item);
          const collAddr = tryNormalizeAddress(action.details.nft_collection);

          if (nftAddr && collAddr) {
            nftAddress = nftAddr;
            collectionAddress = collAddr;
            const idx = parseInt(action.details.nft_item_index, 10);
            if (!isNaN(idx)) {
              nftIndex = idx;
            }
            break;
          }
        }
      }

      if (action.type === "contract_deploy" && action.details && !nftAddress) {
        const opcode = Number(action.details.opcode);
        if (opcode === OP_DEPLOY) {
          const nftAddr = action.details.destination ? tryNormalizeAddress(action.details.destination) : null;
          const collAddr = action.details.source ? tryNormalizeAddress(action.details.source) : null;

          if (nftAddr && collAddr) {
            nftAddress = nftAddr;
            collectionAddress = collAddr;
          }
        }
      }
    }

    return {
      participant: participantAddress,
      timestamp: trace.start_utime,
      txHash: transactionHashHex,
      lt: trace.start_lt,
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
      isFake: validation.isFake,
      fakeReason: validation.fakeReason,
      validationScore: validation.validationScore,
    };
  }
}
