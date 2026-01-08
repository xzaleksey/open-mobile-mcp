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
      console.error(
        `[DeviceType] Unicode Strategy: Host Clipboard Sync (PowerShell) for '${text}'`
      );

      try {
        // 1. Set Host Clipboard via PowerShell
        // PowerShell handles Unicode arguments correctly if passed via spawn.
        await spawnAsync("powershell", [
          "-command",
          `Set-Clipboard -Value "${text}"`,
        ]);

        // Small delay to allow emulator to sync (heuristic)
        await new Promise((r) => setTimeout(r, 500));

        // 2. Send Paste to Device
        await execAsync(`adb -s ${deviceId} shell input keyevent 279`);
      } catch (e) {
        console.error(
          `[DeviceType] Host Clipboard failed: ${(e as Error).message}`
        );
        // Fallback to Maestro with escaping
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
