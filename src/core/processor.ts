import { TonApiService } from "../services/tonApiService.js";
import { CsvService } from "../services/csvService.js";
import { StateService } from "../services/stateService.js";

export class Processor {
  private api = new TonApiService();
  private csv = new CsvService();
  private state = new StateService();

  async run() {
    console.log("[PROC] ▶️  Processor start");

    // load last LT
    const lastLt = await this.state.getLastLt();
    console.log(`[PROC] 🔖  Last saved LT: ${lastLt ?? "none"}`);

    // fetch all traces (via tx→traces)
    console.log("[PROC] ⏳  Fetching all traces from API…");
    let traces = await this.api.fetchAllTraces();

    // filter only new ones if we have a checkpoint
    if (lastLt) {
      traces = traces.filter((t) => BigInt(t.start_lt) > BigInt(lastLt));
      console.log(`[PROC] 🔍  ${traces.length} traces newer than LT=${lastLt}`);
    } else {
      console.log(
        `[PROC] 🔍  No previous cursor—processing all ${traces.length} traces`
      );
    }

    if (!traces.length) {
      console.log("[PROC] 💤  No new traces to process. Exiting.");
      return;
    }

    // map → CSV rows
    console.log("[PROC] 🔨  Mapping traces → CSV rows");
    const rows = traces.map((t) => this.api.mapTraceToLotteryTx(t));

    // append to CSV
    console.log(`[PROC] 💾  Appending ${rows.length} rows to CSV`);
    await this.csv.append(rows);

    // persist the highest LT for next run
    const maxLt = rows
      .map((r) => BigInt(r.lt))
      .reduce((a, b) => (a > b ? a : b), BigInt(rows[0].lt))
      .toString();

    console.log(`[PROC] 💾  Saving new cursor LT = ${maxLt}`);
    await this.state.saveLastLt(maxLt);

    console.log("[PROC] 🎉  Done.");
  }
}
