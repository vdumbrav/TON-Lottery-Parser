import axios from "axios";
import { Buffer } from "buffer";
import { CONFIG } from "../config/config.js";
import {
  RawTrace,
  LotteryTx,
  TraceAction,
  TraceActionDetails,
  JettonTransferDetails,
  JettonTransferDetailsV3,
  TokenInfo,
} from "../types/index.js";
import { Address, Cell, Slice } from "@ton/core";
import { nanoToTon, delay } from "../core/utils.js";

/* ---------- prize-usd map ---------- */
const PRIZE_MAP: Record<string, number> = {
  x1: 10,
  x3: 25,
  x7: 50,
  x20: 180,
  x77: 700,
  x200: 1800,
  jp: 10000,
  "jackpot winner": 10000,
};

/* ---------- type-guards ---------- */
function isJettonV2(
  d: TraceActionDetails
): d is JettonTransferDetails {
  return typeof (d as any)?.jetton === "object";
}

function isJettonV3(
  d: TraceActionDetails
): d is JettonTransferDetailsV3 {
  return typeof (d as any)?.asset === "string";
}

function readDecimals(meta?: TokenInfo[]): number {
  const raw = meta?.[0]?.extra?.decimals;
  return raw ? Number(raw) : 9;
}

/* ---------- service ---------- */
export class TonApiService {
  private client = axios.create({
    baseURL: CONFIG.apiEndpoint,
    timeout: 10_000,
    params: { api_key: CONFIG.apiKey },
  });

  private contract = Address.parse(CONFIG.contractAddress).toString({
    bounceable: false,
    urlSafe: true,
  });

  /* --------------------- fetchAll --------------------- */
  async fetchAllTraces(): Promise<RawTrace[]> {
    console.log("[API] start fetching traces");
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

      const traces = (data.traces as RawTrace[]) ?? [];
      if (!traces.length) break;
      all.push(...traces);
      offset += CONFIG.pageLimit;
      await delay(1_000);
    }

    console.log(`[API] fetched ${all.length} traces`);
    return all;
  }

  /* --------------------- helpers --------------------- */
  private b64ToHex(b64: string): string {
    return Buffer.from(b64, "base64").toString("hex");
  }

  /* --------------------- main mapper --------------------- */
  mapTraceToLotteryTx(trace: RawTrace): LotteryTx | null {
    if (!trace.actions?.length || !trace.transactions_order?.length) return null;

    const rootB64 = trace.trace?.tx_hash ?? trace.trace_id;
    if (!rootB64) return null;
    const txHash = this.b64ToHex(rootB64);

    /* ─── инициализация ─────────────────────────────── */
    let winComment: string | null = null;
    let winAmount = 0;
    let winTonNano = 0n;
    let referralNano = 0n;
    let referralAddr: string | null = null;
    let buyAmount: number | null = null;
    let buyCurrency: string | null = null;
    let buyMaster: string | null = null;
    let purchaseDone = false;

    /* ─── адрес участника (с первого tx) ─────────────── */
    const firstTxKey = trace.transactions_order[0];
    const rawSrc =
      trace.transactions[firstTxKey]?.in_msg?.source ??
      trace.transactions[firstTxKey]?.account;
    if (!rawSrc) return null;

    let participant: string;
    try {
      participant = Address.parse(rawSrc).toString({
        bounceable: false,
        urlSafe: true,
      });
    } catch {
      return null;
    }

    /* ─── проходим по actions ────────────────────────── */
    for (const action of trace.actions) {
      switch (action.type) {
        /* ----- TON transfer / call_contract ----------- */
        case "ton_transfer":
        case "call_contract": {
          const d = action.details;
          const dest = d.destination
            ? Address.parse(d.destination).toString({ bounceable: false, urlSafe: true })
            : null;
          const src = d.source
            ? Address.parse(d.source).toString({ bounceable: false, urlSafe: true })
            : null;
          const value = d.value ? BigInt(d.value) : 0n;

          /* 🎁 приз / referral */
          if (action.type === "ton_transfer") {
            const comment = (d.comment ?? "").trim().toLowerCase();
            if (comment in PRIZE_MAP) {
              winAmount = PRIZE_MAP[comment];
              winComment = comment;
              winTonNano += value;
              break;
            }
            if (comment === "referral") {
              referralNano += value;
              if (!referralAddr && d.destination) {
                try {
                  referralAddr = Address.parse(d.destination).toString({
                    bounceable: false,
                    urlSafe: true,
                  });
                } catch {/* ignore */ }
              }
              break;
            }
          }

          /* 💳 покупка TON-ом */
          if (
            !purchaseDone &&
            dest === this.contract &&
            src === participant &&
            value > 0n
          ) {
            buyAmount = nanoToTon(value);
            buyCurrency = "TON";
            buyMaster = null;
            purchaseDone = true;
          }
          break;
        }

        /* ----- jetton_transfer ------------------------ */
        case "jetton_transfer": {
          const d = action.details;

          /* v3 */
          if (isJettonV3(d) && d?.destination && d?.source) {
            const dest = Address.parse(d?.destination || '').toString({ bounceable: false, urlSafe: true });
            const src = Address.parse(d?.source || '').toString({ bounceable: false, urlSafe: true });
            const meta = trace.metadata?.[d.asset]?.token_info;
            const decimals = readDecimals(meta);
            const symbol = meta?.[0]?.symbol ?? "JETTON";
            const amount = Number(d.amount) / 10 ** decimals;
            const master = Address.parse(d.asset).toString({ bounceable: false, urlSafe: true });

            if (!purchaseDone && dest === this.contract && src === participant && amount > 0) {
              buyAmount = amount;
              buyCurrency = symbol;
              buyMaster = master;
              purchaseDone = true;
            }
            break;
          }

          /* v2 (старый JSON) */
          if (isJettonV2(d)) {
            const dest = d.destination
              ? Address.parse(d.destination).toString({ bounceable: false, urlSafe: true })
              : null;
            const src = d.source
              ? Address.parse(d.source).toString({ bounceable: false, urlSafe: true })
              : null;
            const jet = d.jetton ?? {};
            const decimals = jet.decimals ?? 9;
            const amount = (Number(d.value) || 0) / 10 ** decimals;
            const symbol = jet.symbol ?? "JETTON";
            const master = jet.master
              ? Address.parse(jet.master).toString({ bounceable: false, urlSafe: true })
              : null;

            if (!purchaseDone && dest === this.contract && src === participant && amount > 0) {
              buyAmount = amount;
              buyCurrency = symbol;
              buyMaster = master;
              purchaseDone = true;
            }
          }
          break;
        }
      }
    }

    /* ─── NFT-mint / prize only ──────────────────────── */
    const mint = trace.actions.find(a => a.type === "nft_mint");

    const base: Omit<LotteryTx, "nftAddress" | "collectionAddress" | "nftIndex"> = {
      participant,
      timestamp: trace.start_utime,
      txHash,
      lt: trace.start_lt,
      isWin: winAmount > 0,
      winComment,
      winAmount,
      winTonAmount: winTonNano ? nanoToTon(winTonNano) : null,
      referralAmount: referralNano ? nanoToTon(referralNano) : null,
      referralAddress: referralAddr,
      buyAmount,
      buyCurrency,
      buyMasterAddress: buyMaster,
    };

    if (
      mint &&
      mint.details.nft_item &&
      mint.details.nft_collection &&
      mint.details.nft_item_index
    ) {
      /* ► полноценная покупка-минт */
      return {
        ...base,
        nftAddress: Address.parse(mint.details.nft_item).toString({
          bounceable: false, urlSafe: true
        }),
        collectionAddress: Address.parse(mint.details.nft_collection).toString({
          bounceable: false, urlSafe: true
        }),
        nftIndex: Number(mint.details.nft_item_index),
      };
    }

    /* ► только приз / referral */
    if (winAmount > 0) {
      return { ...base, nftAddress: null, collectionAddress: null, nftIndex: null };
    }

    /* ► мусорная трасса */
    return null;
  }
}
