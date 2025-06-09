import { createTonApiService } from "../services/tonApiFactory.js";
import { CsvService } from "../services/csvService.js";
import { StateService } from "../services/stateService.js";
import { LotteryTx } from "../types/index.js";

export class Processor {
  private api = createTonApiService();
  private csv = new CsvService();
  private state = new StateService();

  async run() {
    console.log("[PROC] start");
    const lastLt = await this.state.getLastLt();

    let traces = await this.api.fetchAllTraces();

    if (lastLt) {
      traces = traces.filter((t) => BigInt(t.start_lt) > BigInt(lastLt));
    }

    if (!traces.length) {
      console.log("[PROC] no new traces");
      console.log("[PROC] end");
      return;
    }

    const rows = traces
      .map((t) => this.api.mapTraceToLotteryTx(t))
      .filter((r): r is LotteryTx => r !== null && r !== undefined);

    if (rows.length === 0) {
      console.log("[PROC] no valid parsed rows");
      console.log("[PROC] end");
      return;
    }

    await this.csv.append(rows);

    const maxLt = rows
      .map((r) => BigInt(r.lt))
      .reduce((a, b) => (a > b ? a : b), BigInt(rows[0].lt))
      .toString();

    await this.state.saveLastLt(maxLt);

    console.log(`[PROC] processed ${rows.length} rows`);
    console.log("[PROC] end");
  }
}
