export const NANO = 1_000_000_000n;
export function nanoToTon(raw: string | bigint) {
  return Number((BigInt(raw) * 100n) / NANO) / 100;
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
