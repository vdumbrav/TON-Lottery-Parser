import { createTonApiService } from "../services/tonApiFactory.js";
import { CsvService } from "../services/csvService.js";
import { StateService } from "../services/stateService.js";
import { LotteryTx } from "../types/index.js";
import { CONFIG } from "../config/config.js";

export class Processor {
  private api = createTonApiService();
  private csv = new CsvService();
  private state = new StateService();

  async run() {
    console.log("[PROC] start");

    // API v3: Incremental fetching
    const lastLt = await this.state.getLastLt();
    let totalProcessed = 0;
    let currentMaxLt = lastLt;

    await (this.api as any).fetchTracesIncremental(lastLt, async (txs: any[]) => {
      // TonAPI transactions use 'lt' as a number
      const newTxs = lastLt
        ? txs.filter((t) => {
            const txLt = t.lt ?? t.start_lt;
            return BigInt(txLt) > BigInt(lastLt);
          })
        : txs;

      if (!newTxs.length) return;

      const rows = newTxs
        .map((t) => (this.api as any).mapTraceToLotteryTx(t))
        .filter((r): r is LotteryTx => r !== null && r !== undefined);

      if (rows.length === 0) return;

      await this.csv.append(rows);

      const batchMaxLt = rows
        .map((r) => BigInt(r.lt))
        .reduce((a, b) => (a > b ? a : b), BigInt(rows[0].lt))
        .toString();

      if (!currentMaxLt || BigInt(batchMaxLt) > BigInt(currentMaxLt)) {
        currentMaxLt = batchMaxLt;
        await this.state.saveLastLt(currentMaxLt);
      }

      totalProcessed += rows.length;
      console.log(`[PROC] batch: ${rows.length} rows | total: ${totalProcessed}`);
    });

    if (totalProcessed === 0) {
      console.log("[PROC] no new traces");
    } else {
      console.log(`[PROC] completed: ${totalProcessed} total rows`);
    }

    console.log("[PROC] end");
  }
}
