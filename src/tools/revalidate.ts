import { promises as fs } from "fs";
import Papa from "papaparse";
import { CONFIG } from "../config/config.js";
import { TransactionValidator } from "../core/validator.js";

interface ValidationReport {
  totalTransactions: number;
  fakeTransactions: number;
  suspiciousTransactions: number;
  lowScoreTransactions: number;
  detailedIssues: Array<{
    txHash: string;
    participant: string;
    issue: string;
    validationScore: number;
  }>;
  timestamp: string;
}

async function revalidateExistingData() {
  console.log("[REVALIDATE] Starting revalidation of existing lottery data...");

  try {
    // Check if CSV file exists
    const csvExists = await fs
      .stat(CONFIG.csvPath)
      .then(() => true)
      .catch(() => false);

    if (!csvExists) {
      console.log("[REVALIDATE] No CSV file found at", CONFIG.csvPath);
      return;
    }

    // Read existing CSV
    const csvContent = await fs.readFile(CONFIG.csvPath, "utf-8");
    const { data } = Papa.parse(csvContent, { header: true });

    if (!data || data.length === 0) {
      console.log("[REVALIDATE] CSV file is empty");
      return;
    }

    const validator = new TransactionValidator(CONFIG.contractAddress);

    let fakeCount = 0;
    let suspiciousCount = 0;
    let lowScoreCount = 0;
    const detailedIssues: ValidationReport['detailedIssues'] = [];

    console.log(`[REVALIDATE] Analyzing ${data.length} transactions...`);

    for (const row of data as any[]) {
      const issues: string[] = [];
      let validationScore = 100;

      // Check 1: Win without payment
      if (row.isWin === 'true' && !row.winTonAmount && !row.winJettonAmount) {
        issues.push("Win marked but no payment recorded");
        suspiciousCount++;
        validationScore -= 50;
      }

      // Check 2: Win comment without actual win amount
      if (row.winComment && (!row.winAmount || row.winAmount === '0')) {
        issues.push("Win comment present but no win amount");
        suspiciousCount++;
        validationScore -= 30;
      }

      // Check 3: Referral without purchase
      if (row.referralAmount && (!row.buyAmount || row.buyAmount === '0')) {
        issues.push("Referral payment without purchase");
        suspiciousCount++;
        validationScore -= 20;
      }

      // Check 4: NFT without purchase (might be legitimate in some cases)
      if (row.nftAddress && (!row.buyAmount || row.buyAmount === '0')) {
        issues.push("NFT minted without purchase");
        validationScore -= 10;
      }

      // Check 5: Already marked as fake
      if (row.isFake === 'true') {
        fakeCount++;
        issues.push(`Already marked as fake: ${row.fakeReason || 'Unknown reason'}`);
        validationScore = 0;
      }

      // Check 6: Low validation score
      if (row.validationScore && parseInt(row.validationScore) < 50) {
        lowScoreCount++;
        issues.push(`Low validation score: ${row.validationScore}`);
      }

      if (issues.length > 0) {
        detailedIssues.push({
          txHash: row.txHash,
          participant: row.participant,
          issue: issues.join('; '),
          validationScore: Math.max(0, validationScore)
        });
      }
    }

    // Create report
    const report: ValidationReport = {
      totalTransactions: data.length,
      fakeTransactions: fakeCount,
      suspiciousTransactions: suspiciousCount,
      lowScoreTransactions: lowScoreCount,
      detailedIssues: detailedIssues.slice(0, 100), // Limit to first 100 issues
      timestamp: new Date().toISOString()
    };

    // Save report
    await fs.mkdir("data", { recursive: true });
    await fs.writeFile(
      "data/validation_report.json",
      JSON.stringify(report, null, 2),
      "utf-8"
    );

    // Print summary
    console.log("\n[REVALIDATE] === VALIDATION REPORT ===");
    console.log(`Total transactions: ${report.totalTransactions}`);
    console.log(`Fake transactions: ${report.fakeTransactions}`);
    console.log(`Suspicious transactions: ${report.suspiciousTransactions}`);
    console.log(`Low score transactions: ${report.lowScoreTransactions}`);
    console.log(`Transactions with issues: ${detailedIssues.length}`);

    if (detailedIssues.length > 0) {
      console.log("\n[REVALIDATE] First 5 issues found:");
      detailedIssues.slice(0, 5).forEach((issue, i) => {
        console.log(`${i + 1}. TX ${issue.txHash.substring(0, 10)}...`);
        console.log(`   Participant: ${issue.participant.substring(0, 20)}...`);
        console.log(`   Issue: ${issue.issue}`);
        console.log(`   Score: ${issue.validationScore}`);
      });
    }

    console.log("\n[REVALIDATE] Full report saved to data/validation_report.json");

    // Check for critical issues
    const criticalRatio = (fakeCount + suspiciousCount) / data.length;
    if (criticalRatio > 0.1) {
      console.warn("\n[WARNING] More than 10% of transactions are suspicious or fake!");
      console.warn("Consider running a full re-parse with updated validation logic.");
    }

  } catch (error) {
    console.error("[REVALIDATE] Error during revalidation:", error);
    process.exit(1);
  }
}

// Export for use as module
export { revalidateExistingData };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  revalidateExistingData()
    .then(() => {
      console.log("[REVALIDATE] Completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("[REVALIDATE] Fatal error:", error);
      process.exit(1);
    });
}