export const NANO = 1_000_000_000n;

/**
 * Converts nano TON to TON and rounds the result
 * to 6 digits after the decimal point.
 */
export function nanoToTon(nano: bigint): number {
  const ton = Number(nano) / 1e9;
  return Math.round(ton * 1e6) / 1e6;
}
export function nanoToTon(nano: bigint): number {
  return Math.round((Number(nano) / 1e9) * 1e6) / 1e6;
}
