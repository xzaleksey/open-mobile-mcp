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

      // Strategy 1: "ADB Keyboard" (The "Correct" native way)
      // Check if the user has ADB Keyboard installed.
      // If yes, use the broadcast intent.

      let hasAdbKeyboard = false;
      try {
        const { stdout } = await execAsync(
          `adb -s ${deviceId} shell pm list packages com.android.adbkeyboard`
        );
        if (stdout.includes("package:com.android.adbkeyboard")) {
          hasAdbKeyboard = true;
        }
      } catch (e) {
        // Ignore error, assume not installed
      }

      if (hasAdbKeyboard) {
        console.error(
          `[DeviceType] Unicode Strategy: ADB Keyboard Broadcast for '${text}'`
        );
        // 1. Set IME to ADB Keyboard
        await execAsync(
          `adb -s ${deviceId} shell ime set com.android.adbkeyboard/.AdbIME`
        );

        // 2. Broadcast Text
        // We need to escape single quotes for the shell command: ' -> '\''
        const safeText = text.replace(/'/g, "'\\''");
        await execAsync(
          `adb -s ${deviceId} shell am broadcast -a ADB_INPUT_TEXT --es msg '${safeText}'`
        );

        // We do NOT switch the IME back automatically to avoid erratic behavior,
        // but the user might prefer their original keyboard.
        // For automation, staying on AdbIME is usually fine.
      } else {
        // Strategy 2: Maestro (Raw UTF-8)
        // Previously we tried escaping (\uXXXX) which likely resulted in literal backslashes
        // or produced no output if Maestro didn't unescape.
        // Since we write the YAML file as UTF-8, we should trust Maestro to read it correctly.

        console.error(
          `[DeviceType] Unicode Strategy: Maestro (Raw UTF-8) for '${text}'`
        );

        const flowYaml = `
---
- inputText: "${text}"
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
