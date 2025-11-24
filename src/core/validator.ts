import { RawTrace, TraceAction, LotteryTx } from "../types/index.js";
import { tryNormalizeAddress } from "./utils.js";

export interface ValidationResult {
  isFake: boolean;
  fakeReason: string | null;
  validationScore: number;
  checks: {
    hasRealPurchase: boolean;
    hasWinPaymentFromContract: boolean;
    hasReferralFromContract: boolean;
    hasLegitimateNftMint: boolean;
    hasSuspiciousNftTransfer: boolean;
    hasFakeWinComment: boolean;
  };
}

export class TransactionValidator {
  private contractAddress: string;

  constructor(contractAddress: string) {
    this.contractAddress = tryNormalizeAddress(contractAddress) || contractAddress;
  }

  validateTrace(trace: RawTrace, participant: string): ValidationResult {
    const checks = {
      hasRealPurchase: false,
      hasWinPaymentFromContract: false,
      hasReferralFromContract: false,
      hasLegitimateNftMint: false,
      hasSuspiciousNftTransfer: false,
      hasFakeWinComment: false,
    };

    let isFake = false;
    let fakeReason: string | null = null;
    let validationScore = 100;

    const participantNorm = tryNormalizeAddress(participant);
    if (!participantNorm) {
      return {
        isFake: true,
        fakeReason: "Invalid participant address",
        validationScore: 0,
        checks
      };
    }

    for (const action of trace.actions) {
      const details = action.details;
      if (!details) continue;

      const sourceNorm = details.source ? tryNormalizeAddress(details.source) : null;
      const destNorm = details.destination ? tryNormalizeAddress(details.destination) : null;
      const comment = details.comment?.trim();
      const value = details.value ? BigInt(details.value) : 0n;

      // CRITICAL FAKE DETECTION:
      // User sends TO contract with "x..." comment - this is an exploitation attempt!
      // Normal lottery play should NOT have these comments from users
      if (action.type === "ton_transfer" &&
          sourceNorm === participantNorm &&
          destNorm === this.contractAddress &&
          comment &&
          this.isSuspiciousUserComment(comment)) {

        checks.hasFakeWinComment = true;
        isFake = true;
        fakeReason = `User sent suspicious comment "${comment}" to contract - possible exploitation attempt`;
        validationScore = 0; // Maximum penalty for exploitation attempts
      }

      // Track legitimate purchase (without suspicious comments)
      if (sourceNorm === participantNorm && destNorm === this.contractAddress && value > 0n) {
        if (!this.isSuspiciousUserComment(comment)) {
          checks.hasRealPurchase = true;
        }
      }

      // Track legitimate win payment from contract
      if (sourceNorm === this.contractAddress && destNorm === participantNorm) {
        if (value > 0n && comment && this.isWinComment(comment)) {
          checks.hasWinPaymentFromContract = true;
        }
      }

      // Check for NFT minting
      if (action.type === "nft_mint") {
        checks.hasLegitimateNftMint = true;
      }

      // Check for suspicious opcodes from user
      if (action.type === "call_contract" && sourceNorm === participantNorm) {
        const opcode = details.opcode ? Number(details.opcode) : null;

        // These opcodes should only come from the contract system
        const SUSPICIOUS_USER_OPCODES = [
          0x5052495a, // OP_PRIZ - Prize payment (should only come from contract)
          0x52454646, // OP_REFF - Referral payment (should only come from contract)
        ];

        if (opcode && SUSPICIOUS_USER_OPCODES.includes(opcode)) {
          isFake = true;
          fakeReason = `User sent system opcode 0x${opcode.toString(16)} - exploitation attempt`;
          validationScore = 0;
        }
      }
    }

    // Adjust validation score
    if (checks.hasRealPurchase && !checks.hasFakeWinComment) {
      validationScore = Math.min(validationScore + 10, 100);
    }
    if (checks.hasWinPaymentFromContract) {
      validationScore = Math.min(validationScore + 20, 100);
    }
    if (checks.hasLegitimateNftMint && !checks.hasFakeWinComment) {
      validationScore = Math.min(validationScore + 10, 100);
    }

    return {
      isFake,
      fakeReason,
      validationScore: Math.max(0, validationScore),
      checks
    };
  }

  // Check if user comment is suspicious (trying to exploit)
  private isSuspiciousUserComment(comment: string | null | undefined): boolean {
    if (!comment) return false;

    const trimmed = comment.trim().toLowerCase();

    // Pattern: x followed by numbers - these are win multipliers
    // Users should NOT send these to the contract
    // This indicates someone trying to exploit or test vulnerabilities
    const suspiciousPatterns = [
      /^x\d+$/,      // x1, x20, x77, etc.
      /^jp$/,        // jackpot
      /^win/i,       // starts with "win"
      /^prize/i,     // starts with "prize"
    ];

    return suspiciousPatterns.some(pattern => pattern.test(trimmed));
  }

  // Check if this is a legitimate win comment FROM contract
  private isWinComment(comment: string): boolean {
    const winComments = ['x1', 'x3', 'x7', 'x20', 'x77', 'x200', 'jp'];
    return winComments.includes(comment.toLowerCase());
  }

  // Validate if a win claim is legitimate based on contract response
  validateWinClaim(userComment: string | null, contractPayment: bigint, contractComment: string | null): boolean {
    // A legitimate win has:
    // 1. Payment FROM contract > 0
    // 2. Contract sends a win comment (x1, x3, x7, etc.)
    // 3. User did NOT send suspicious comments

    if (this.isSuspiciousUserComment(userComment)) {
      // User tried to exploit - not a legitimate win
      return false;
    }

    if (contractPayment > 0n && contractComment) {
      return this.isWinComment(contractComment);
    }

    return false;
  }

  // Check if transaction has legitimate purchase
  hasLegitPurchase(trace: RawTrace, participant: string): boolean {
    const participantNorm = tryNormalizeAddress(participant);
    if (!participantNorm) return false;

    for (const action of trace.actions) {
      const details = action.details;
      if (!details) continue;

      const sourceNorm = details.source ? tryNormalizeAddress(details.source) : null;
      const destNorm = details.destination ? tryNormalizeAddress(details.destination) : null;
      const comment = details.comment?.trim();

      if (sourceNorm === participantNorm && destNorm === this.contractAddress) {
        const value = details.value ? BigInt(details.value) : 0n;
        if (value > 0n && !this.isSuspiciousUserComment(comment)) {
          return true;
        }
      }
    }

    return false;
  }
}