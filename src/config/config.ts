import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  apiEndpoint: process.env.TONCENTER_API_URL ?? 'https://testnet.toncenter.com/api/v3',
  apiKey: process.env.TONCENTER_API_KEY || '',
  contractAddress: 'kQD4Frl7oL3vuMqTZ812zB-lRSTcrogKu6MFx3Fl3V1ierhe',
  csvPath: 'data/lottery.csv',
  statePath: 'data/state.json',
  pageLimit: 50
} as const;
