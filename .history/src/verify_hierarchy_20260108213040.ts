import { getSemanticHierarchy } from "./perception/hierarchy.js";

async function run() {
  try {
    console.log("Capturing hierarchy...");
    const h = await getSemanticHierarchy("91e308c", "android");
    const json = JSON.stringify(h, null, 2);
    console.log("Hierarchy JSON Length (chars):", json.length);
    console.log("Estimated Tokens (~chars/4):", Math.ceil(json.length / 4));
    console.log("Total Nodes:", (json.match(/"type":/g) || []).length);
  } catch (e) {
    console.error("Verification failed:", e);
  }
}
run();
