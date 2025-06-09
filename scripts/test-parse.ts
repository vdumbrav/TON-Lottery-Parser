import fs from 'fs';
import { TonApiService } from '../src/services/tonApiService.js';

const trace = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).traces[0];
const service = new TonApiService();
const result = service.mapTraceToLotteryTx(trace as any);
console.log(JSON.stringify(result, null, 2));
