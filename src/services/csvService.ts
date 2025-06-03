
import Papa from 'papaparse';
import { promises as fs } from 'fs';
import { CONFIG } from '../config/config.js';
import { LotteryTx } from '../types/index.js';

export class CsvService {
  async append(records: LotteryTx[]) {
    if (!records.length) return;
    await fs.mkdir('data', { recursive: true });
    const exists = await fs.stat(CONFIG.csvPath).then(() => true).catch(() => false);
    const headers = Object.keys(records[0]);

    if (!exists) {
      const csv = Papa.unparse(records, { header: true });
      await fs.writeFile(CONFIG.csvPath, csv + '\n', 'utf-8');
      return;
    }

    const current = await fs.readFile(CONFIG.csvPath, 'utf-8');
    const [firstLine, ...rest] = current.trim().split(/\r?\n/);
    if (firstLine !== headers.join(',')) {
      // rewrite file with new header and migrated rows
      const parsed = Papa.parse<LotteryTx>(current, { header: true, skipEmptyLines: true }).data as LotteryTx[];
      const csv = Papa.unparse([...parsed, ...records], { header: true });
      await fs.writeFile(CONFIG.csvPath, csv + '\n', 'utf-8');
    } else {
      const csv = Papa.unparse(records, { header: false });
      await fs.appendFile(CONFIG.csvPath, csv + '\n', 'utf-8');
    }
  }
}
