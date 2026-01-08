import { deviceType } from "./interaction/input.js";

async function run() {
  console.log("--- Starting Self-Test: Unicode Input (Final) ---");
  const deviceId = "91e308c";
  const text = "музей";

  console.log(`Target Device: ${deviceId}`);
  console.log(`Text to Type: "${text}"`);

  try {
    await deviceType(deviceId, "android", text);
    console.log("--- Test Function Completed ---");
  } catch (e) {
    console.error("--- Test Failed ---");
    console.error(e);
  }
}

run();
