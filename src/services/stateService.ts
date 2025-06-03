import { promises as fs } from "fs";
import { CONFIG } from "../config/config.js";

export class StateService {
  async getLastLt(): Promise<string | null> {
    try {
      const data = await fs.readFile(CONFIG.statePath, "utf-8");
      const obj = JSON.parse(data);
      return obj.lastLt as string;
    } catch {
      return null;
    }
  }

  async saveLastLt(lt: string) {
    await fs.mkdir("data", { recursive: true });
    await fs.writeFile(
      CONFIG.statePath,
      JSON.stringify({ lastLt: lt }),
      "utf-8"
    );
  }
}
