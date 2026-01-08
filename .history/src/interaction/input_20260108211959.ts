import { exec, spawn } from "child_process";
import { promisify } from "util";
import { runMaestroFlow } from "./maestro.js";

const execAsync = promisify(exec);

// Helper to run spawn as promise for safer arg passing (bypassing shell)
function spawnAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args);
    let stderr = "";
    process.stderr.on("data", (d) => (stderr += d.toString()));
    process.on("error", (err) => reject(err)); // Fix: Handle spawn errors preventing crash
    process.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}: ${stderr}`));
    });
  });
}

export async function deviceTap(
  deviceId: string,
  platform: "android" | "ios",
  x: number,
  y: number
): Promise<void> {
  if (platform === "android") {
    await execAsync(`adb -s ${deviceId} shell input tap ${x} ${y}`);
  } else {
    // iOS tap via Maestro flow
    const flowYaml = `
---
- tapOn:
    point: ${x},${y}
`;
    await runMaestroFlow(deviceId, flowYaml);
  }
}

export async function deviceType(
  deviceId: string,
  platform: "android" | "ios",
  text: string
): Promise<void> {
  if (platform === "android") {
    // Check for non-ASCII characters
    // eslint-disable-next-line no-control-regex
    const isAscii = /^[\x00-\x7F]*$/.test(text);

    if (isAscii) {
      // Fast path for simple text
      const escapedText = text.replace(/\s/g, "%s");
      await execAsync(`adb -s ${deviceId} shell input text "${escapedText}"`);
    } else {
      // Fallback for Unicode (Cyrillic, etc.)

      // Strategy: "Base64 Injection"
      // We encode the text to Base64 (which is pure ASCII) on the Host.
      // We pass this ASCII string to the device.
      // We tell the device to decode it and feed it to 'input text'.
      // Command: adb shell input text "$(echo 'BASE64_STRING' | base64 -d)"
      // This bypasses ALL Windows/ADB encoding issues because only ASCII travels over the wire.

      // 1. Prepare text: Replace spaces with %s (as input text requires)
      const textForInput = text.replace(/\s/g, "%s");

      // 2. Base64 Encode
      const base64Text = Buffer.from(textForInput, "utf8").toString("base64");

      console.error(
        `[DeviceType] Unicode Strategy: Base64 Injection for '${text}' -> '${base64Text}'`
      );

      try {
        // We use execAsync here because we NEED the shell expansion $() to happen ON THE ANDROID SIDE.
        // If we use spawn, we have to validly construct the shell command.
        // adb shell "command" works best.

        // Note: escaping regex special chars might be needed for the shell command string structure?
        // The base64 string itself only has A-Z, a-z, 0-9, +, / and =. All safe in quotes.

        const cmd = `input text "$(echo '${base64Text}' | base64 -d)"`;
        await execAsync(`adb -s ${deviceId} shell "${cmd}"`);
      } catch (e) {
        console.error(
          `[DeviceType] Base64 Injection failed: ${(e as Error).message}`
        );

        // Last Resort: Maestro with Escaping
        const unicodeEscaped = text
          .split("")
          .map((char) => {
            const code = char.charCodeAt(0);
            if (code > 127) {
              return "\\u" + code.toString(16).padStart(4, "0");
            }
            return char;
          })
          .join("");

        const flowYaml = `
---
- inputText: "${unicodeEscaped}"
`;
        await runMaestroFlow(deviceId, flowYaml);
      }
    }
  } else {
    // iOS
    const flowYaml = `
---
- inputText: "${text}"
`;
    await runMaestroFlow(deviceId, flowYaml);
  }
}

export async function deviceSwipe(
  deviceId: string,
  platform: "android" | "ios",
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<void> {
  if (platform === "android") {
    await execAsync(
      `adb -s ${deviceId} shell input swipe ${x1} ${y1} ${x2} ${y2}`
    );
  } else {
    const flowYaml = `
---
- swipe:
    start: ${x1},${y1}
    end: ${x2},${y2}
`;
    await runMaestroFlow(deviceId, flowYaml);
  }
}
