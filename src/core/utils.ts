export const NANO = 1_000_000_000n;
export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
/**
 * Converts nano TON to TON and rounds the result
 * to 6 digits after the decimal point.
 */
export function nanoToTon(nano: bigint): number {
  const ton = Number(nano) / 1e9;
  return Math.round(ton * 1e6) / 1e6;
}
