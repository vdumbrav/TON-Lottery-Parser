export const NANO = 1_000_000_000n;
export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
export function nanoToTon(nano: bigint): number {
  return Math.round((Number(nano) / 1e9) * 1e6) / 1e6;
}
