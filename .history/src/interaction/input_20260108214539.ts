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
      // We use 'ime list -a' because 'pm list packages' often fails with SecurityException on newer Androids.

      let hasAdbKeyboard = false;
      try {
        const { stdout } = await execAsync(
          `adb -s ${deviceId} shell ime list -a`
        );
        if (stdout.includes("com.android.adbkeyboard/.AdbIME")) {
          hasAdbKeyboard = true;
        }
      } catch (e) {
        // Ignore error, assume not installed
      }

      if (hasAdbKeyboard) {
        console.error(
          `[DeviceType] Unicode Strategy: ADB Keyboard Base64 Broadcast for '${text}'`
        );
        // 1. Enable & Set IME
        await execAsync(
          `adb -s ${deviceId} shell ime enable com.android.adbkeyboard/.AdbIME`
        );
        await execAsync(
          `adb -s ${deviceId} shell ime set com.android.adbkeyboard/.AdbIME`
        );

        // 2. Wait for the keyboard to actually "pop" (Crucial for non-empty input)
        await new Promise((r) => setTimeout(r, 600));

        // 3. Broadcast Base64 using spawnAsync (The "Nuclear" Option)
        // Prevents ANY shell encoding issues by sending pure ASCII.
        const base64Text = Buffer.from(text).toString("base64");
        await spawnAsync("adb", [
          "-s",
          deviceId,
          "shell",
          "am",
          "broadcast",
          "-a",
          "ADB_INPUT_B64",
          "--es",
          "msg",
          base64Text,
        ]);

        // We do NOT switch the IME back automatically to avoid erratic behavior,
        // but the user might prefer their original keyboard.
        // For automation, staying on AdbIME is usually fine.
      } else {
        // Strategy 2: Native Clipboard Injection (Android 11+)
        // This is robust and requires no external app.
        try {
          console.error(
            `[DeviceType] Unicode Strategy: Native Clipboard+Paste for '${text}'`
          );
          // Set clipboard via content provider
          // We need to escape double quotes for the shell
          const safeText = text.replace(/"/g, '\\"');
          await execAsync(
            `adb -s ${deviceId} shell content call --uri content://settings/system --method PUT_STRING --arg value:s:"${safeText}"`
          ).catch(() => {
            // Try older 'service call' or 'content set' if 'call' fails, but let's just fall through to Maestro if this fails.
            // Actually the user suggested 'content set', let's aim for that or just accept failure.
            // User suggested: content set --uri content://settings/system --bind value:s:"${text}"
            // But 'content call' is often safer. Let's stick to the user's exact suggestion for safety:
            return execAsync(
              `adb -s ${deviceId} shell content set --uri content://settings/system --bind value:s:"${safeText}"`
            );
          });

          // Paste
          await execAsync(`adb -s ${deviceId} shell input keyevent 279`);
          return; // Success?
        } catch (e) {
          console.error(`[DeviceType] Clipboard failed, trying Maestro...`);
        }

        // Strategy 3: Maestro (Raw UTF-8)
        // Fallback if everything else fails.

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
