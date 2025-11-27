import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  apiEndpoint: process.env.TONAPI_URL || "https://tonapi.io",
  apiKey: process.env.TONAPI_KEY || "",
  contractAddress: process.env.TON_CONTRACT_ADDRESS || "kQD4Frl7oL3vuMqTZ812zB-lRSTcrogKu6MFx3Fl3V1ieuWb",
  pageLimit: parseInt(process.env.PAGE_LIMIT || "100", 10),
  csvPath: "data/lottery.csv",
  statePath: "data/state.json",
  contractType: (process.env.CONTRACT_TYPE || "JETTON").toUpperCase() as "TON" | "JETTON",
  isTestnet: process.env.IS_TESTNET === "true",
} as const;
