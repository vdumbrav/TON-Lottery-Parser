import { TonApiService } from "../services/tonApiService.js";
import { CsvService } from "../services/csvService.js";
import { StateService } from "../services/stateService.js";
import { LotteryTx } from "../types/index.js";

export class Processor {
  private api = new TonApiService();
  private csv = new CsvService();
  private state = new StateService();

  async run() {
    const lastLt = await this.state.getLastLt();

    // fetch all traces (via tx→traces)
    let traces = await this.api.fetchAllTraces();

    // filter only new ones if we have a checkpoint
    if (lastLt) {
      traces = traces.filter((t) => BigInt(t.start_lt) > BigInt(lastLt));
    }

    if (!traces.length) {
      return;
    }

    // map → CSV rows
    const rows = traces
      .map((t) => this.api.mapTraceToLotteryTx(t))
      .filter((r): r is LotteryTx => r !== null && r !== undefined);

    // append to CSV
    await this.csv.append(rows);

    // persist the highest LT for next run
    const maxLt = rows
      .map((r) => BigInt(r.lt))
      .reduce((a, b) => (a > b ? a : b), BigInt(rows[0].lt))
      .toString();

    await this.state.saveLastLt(maxLt);

  }
}
