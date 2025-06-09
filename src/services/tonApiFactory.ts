import { CONFIG } from "../config/config.js";
import { ApiServiceJetton } from "./apiServiceJetton.js";
import { ApiServiceTon } from "./apiServiceTon.js";

export function createTonApiService() {
  if (CONFIG.contractType === "JETTON") {
    console.log("[FACTORY] Using Jetton parser");
    return new ApiServiceJetton();
  }

  console.log("[FACTORY] Using TON parser");
  return new ApiServiceTon();
}
