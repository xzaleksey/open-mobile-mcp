import { exec } from "child_process";
import fs from "fs/promises";
import { promisify } from "util";
import { getSemanticHierarchy } from "./perception/hierarchy.js";

const execAsync = promisify(exec);
const args = process.argv.slice(2);
const DEVICE_ID = args[0] || "91e308c"; // Default if not provided

async function main() {
  console.log(`Debug Hierarchy Script`);
  console.log(`Device ID: ${DEVICE_ID}`);

  try {
    // 1. Dump Raw XML
    console.log("1. Dumping Raw XML...");

    // Clean up old dump
    await execAsync(
      `adb -s ${DEVICE_ID} shell rm /sdcard/window_dump.xml`
    ).catch(() => {});

    // Dump to device
    await execAsync(
      `adb -s ${DEVICE_ID} shell uiautomator dump /sdcard/window_dump.xml`
    );

    // Pull to local
    await execAsync(
      `adb -s ${DEVICE_ID} pull /sdcard/window_dump.xml raw_hierarchy.xml`
    );
    console.log("   - Saved to 'raw_hierarchy.xml'");

    // Read content to search
    const rawXml = await fs.readFile("raw_hierarchy.xml", "utf-8");
    const continueMatches = rawXml.match(/continue/gi);
    if (continueMatches) {
      console.log(
        `   - FOUND 'continue' in raw XML: ${continueMatches.length} times.`
      );
      // Simple grep-like output
      const lines = rawXml.split("\n");
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes("continue")) {
          console.log(`     Line ${i + 1}: ${line.trim()}`);
        }
      });
    } else {
      console.warn("   - 'continue' NOT FOUND in raw XML!");
    }

    // 2. Dump Pruned JSON
    console.log("\n2. Dumping Pruned Hierarchy (MCP Logic)...");
    const pruned = await getSemanticHierarchy(DEVICE_ID, "android");
    await fs.writeFile(
      "pruned_hierarchy.json",
      JSON.stringify(pruned, null, 2)
    );
    console.log("   - Saved to 'pruned_hierarchy.json'");

    const prunedStr = JSON.stringify(pruned);
    if (prunedStr.toLowerCase().includes("continue")) {
      console.log("   - FOUND 'continue' in pruned JSON.");
    } else {
      console.warn("   - 'continue' NOT FOUND in pruned JSON.");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
