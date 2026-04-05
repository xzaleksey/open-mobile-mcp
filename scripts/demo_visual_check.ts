import { findElement, getElementImage } from "./perception/element.js";

async function runDemo() {
  const deviceId = "91e308c";
  const platform = "android";
  // We assume the device is already on the page, but let's refresh to be sure
  // or just use what's there.
  // User said "window reloaded", maybe they refreshed the MCP server?
  // Or they want ME to reload the page?
  // Let's just work with the current screen to be fast.

  const textToFind = "Search"; // Common button on Google home page

  console.log(`1. Finding elements with text: "${textToFind}"...`);
  const elements = await findElement(deviceId, platform, textToFind, "text");

  if (elements.length === 0) {
    console.log("No elements found. Trying 'Google'...");
    // Fallback
    const fallbackElements = await findElement(
      deviceId,
      platform,
      "Google",
      "text"
    );
    if (fallbackElements.length === 0) {
      console.error("Could not find 'Search' or 'Google' elements.");
      return;
    }
    console.log("Found 'Google' instead.");
    analyzeElement(deviceId, platform, "Google", fallbackElements[0]);
  } else {
    console.log(`Found ${elements.length} element(s).`);
    analyzeElement(deviceId, platform, textToFind, elements[0]);
  }
}

async function analyzeElement(
  deviceId: string,
  platform: "android" | "ios",
  text: string,
  element: any
) {
  console.log("2. Analyzing Element Metadata:");
  console.log(`   - Type: ${element.type}`);
  console.log(`   - Bounds: ${element.bounds}`);
  console.log(`   - Clickable (via Hierarchy): ${element.clickable}`);
  // Note: The hierarchy 'clickable' attribute tells us what the accessibility tree thinks.

  console.log("3. Capturing Visual Inspection Image...");
  try {
    const base64 = await getElementImage(deviceId, platform, text, "text");
    console.log(`   - Image Capture Success! Size: ${base64.length} chars.`);
    console.log(
      `   - [Visual Check Simulation]: The AI would now accept this base64 image.`
    );
    console.log(`   - Based on hierarchy, Enabled = ${element.clickable}`);

    // Save it so we can potentially see it (optional)
    // const filepath = path.resolve("element_capture.png");
    // writeFileSync(filepath, Buffer.from(base64, 'base64'));
    // console.log(`   - Saved to ${filepath}`);
  } catch (e: any) {
    console.error("   - Failed to capture image: " + e.message);
  }
}

runDemo().catch(console.error);
