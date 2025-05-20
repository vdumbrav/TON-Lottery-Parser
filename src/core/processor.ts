import { TonApiService } from '../services/tonApiService.js';
import { CsvService } from '../services/csvService.js';
import { StateService } from '../services/stateService.js';

export class Processor {
  constructor(
    private api = new TonApiService(),
    private csv = new CsvService(),
    private state = new StateService()
  ) {}

  async run() {
    // 1) Load last processed LT
    const lastLt = await this.state.getLastLt();

    // 2) Fetch all traces (or only those newer than lastLt)
    let traces = await this.api.fetchAllTraces();
    if (lastLt) {
      traces = traces.filter(t => BigInt(t.start_lt) > BigInt(lastLt));
    }

    if (traces.length === 0) {
      console.log('No new traces found');
      return;
    }

    // 3) Map & CSV
    const rows = traces.map(t => this.api.mapTraceToLotteryTx(t));
    await this.csv.append(rows);

    // 4) Persist highest LT
    const maxLt = rows.reduce((max, r) => (BigInt(r.lt) > BigInt(max) ? r.lt : max), rows[0].lt);
    await this.state.saveLastLt(maxLt);

    console.log(`Appended ${rows.length} rows; new cursor LT=${maxLt}`);
  }
}
