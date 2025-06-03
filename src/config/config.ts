import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  apiEndpoint:
    process.env.TONCENTER_API_URL || "https://testnet.toncenter.com/api/v3",
  apiKey:
    process.env.TONCENTER_API_KEY ||
    "956da4d618bdc3f356234bb971da09cc8c9ae369e8cb3fdfcb6520a26f26b48f",
  contractAddress:
    process.env.TON_CONTRACT_ADDRESS ||
    "kQD4Frl7oL3vuMqTZ812zB-lRSTcrogKu6MFx3Fl3V1ieuWb",
  pageLimit: parseInt(process.env.PAGE_LIMIT || "50", 10),
  csvPath: "data/lottery.csv",
  statePath: "data/state.json",
  debug: process.env.DEBUG === "true" || process.env.DEBUG === "1",
} as const;
