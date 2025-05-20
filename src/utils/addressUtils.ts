
import { Address } from '@ton/core';

export function toFriendly(raw: string): string {
  try {
    return Address.parse(raw).toString();
  } catch {
    return raw; // already friendly
  }
}
