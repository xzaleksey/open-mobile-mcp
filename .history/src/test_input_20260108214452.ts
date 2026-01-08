import { deviceType } from "./interaction/input.js";

async function run() {
  console.log("--- Starting Self-Test: Unicode Input ---");
  const deviceId = "91e308c"; // Known from previous context
  const text = "музей";

  console.log(`Target Device: ${deviceId}`);
  console.log(`Text to Type: "${text}"`);

  try {
    await deviceType(deviceId, "android", text);
    console.log("--- Test Function Completed (Check device screen) ---");
  } catch (e) {
    console.error("--- Test Failed ---");
    console.error(e);
  }
}

run();
