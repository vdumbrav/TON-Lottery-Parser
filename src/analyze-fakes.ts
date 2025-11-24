import { promises as fs } from "fs";
import Papa from "papaparse";
import { CONFIG } from "./config/config.js";

interface LotteryRow {
  participant: string;
  isFake?: string;
  fakeReason?: string;
  validationScore?: string;
  winAmount?: string;
  timestamp?: string;
  txHash?: string;
}

async function analyzeFakes() {
  console.log("=== Fake Transaction Analysis ===\n");

  try {
    const csvContent = await fs.readFile(CONFIG.csvPath, "utf-8");
    const parsed = Papa.parse(csvContent, { header: true });
    const data = parsed.data as LotteryRow[];

    // Filter fake transactions
    const fakes = data.filter((row: LotteryRow) => row.isFake === "true");
    const total = data.length;

    console.log(`📊 Total transactions: ${total}`);
    console.log(`❌ Fake transactions: ${fakes.length}`);
    console.log(`✅ Legitimate transactions: ${total - fakes.length}`);
    console.log(`📈 Fake percentage: ${((fakes.length / total) * 100).toFixed(2)}%\n`);

    if (fakes.length === 0) {
      console.log("✅ No fake transactions detected!");
      return;
    }

    // Group by participant
    const fakesByParticipant = new Map<string, number>();
    const fakeReasons = new Map<string, number>();

    for (const fake of fakes) {
      // Count by participant
      const count = fakesByParticipant.get(fake.participant) || 0;
      fakesByParticipant.set(fake.participant, count + 1);

      // Count by reason
      const reason = fake.fakeReason || "Unknown";
      const reasonCount = fakeReasons.get(reason) || 0;
      fakeReasons.set(reason, reasonCount + 1);
    }

    // Top fake participants
    console.log("🔍 Top fake transaction participants:");
    console.log("-".repeat(80));

    const topFakers = Array.from(fakesByParticipant.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [participant, count] of topFakers) {
      const shortAddr = `${participant.slice(0, 8)}...${participant.slice(-6)}`;
      console.log(`${shortAddr} - ${count} fake attempts`);
    }

    console.log("\n📋 Fake reasons breakdown:");
    console.log("-".repeat(80));

    for (const [reason, count] of Array.from(fakeReasons.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`${reason}: ${count} times`);
    }

    // Recent fakes
    console.log("\n🕐 Recent fake attempts (last 5):");
    console.log("-".repeat(80));

    const recentFakes = fakes.slice(-5).reverse();
    for (const fake of recentFakes) {
      const shortAddr = `${fake.participant.slice(0, 8)}...${fake.participant.slice(-6)}`;
      const date = fake.timestamp ? new Date(Number(fake.timestamp) * 1000).toLocaleString() : "Unknown";
      console.log(`${shortAddr} at ${date}`);
      console.log(`  Reason: ${fake.fakeReason}`);
      console.log(`  Score: ${fake.validationScore}/100`);
      console.log();
    }

    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total,
        fakes: fakes.length,
        legitimate: total - fakes.length,
        fakePercentage: ((fakes.length / total) * 100).toFixed(2) + "%",
      },
      topFakers: topFakers.map(([addr, count]) => ({ address: addr, count })),
      fakeReasons: Array.from(fakeReasons.entries()).map(([reason, count]) => ({ reason, count })),
      recentFakes: recentFakes.map((f: LotteryRow) => ({
        participant: f.participant,
        reason: f.fakeReason,
        score: f.validationScore,
        timestamp: f.timestamp,
        txHash: f.txHash,
      })),
    };

    await fs.writeFile("data/fake_analysis.json", JSON.stringify(report, null, 2));
    console.log("\n💾 Detailed report saved to: data/fake_analysis.json");

  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log("❌ CSV file not found. Run the parser first: npm run start");
    } else {
      console.error("❌ Error:", error.message);
    }
  }
}

// Run analysis
analyzeFakes()
  .then(() => console.log("\n✅ Analysis completed"))
  .catch((error) => {
    console.error("❌ Analysis failed:", error);
    process.exit(1);
  });
