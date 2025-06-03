import Papa from "papaparse";
import { promises as fs } from "fs";
import { CONFIG } from "../config/config.js";
import { LotteryTx } from "../types/index.js";

export class CsvService {
  async append(records: LotteryTx[]) {
    if (!records.length) return;
    await fs.mkdir("data", { recursive: true });
    const exists = await fs
      .stat(CONFIG.csvPath)
      .then(() => true)
      .catch(() => false);
    const csv = Papa.unparse(records, { header: !exists });
    await fs.appendFile(CONFIG.csvPath, csv + "\n", "utf-8");
  }
}
