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
  y: number,
  isLogical: boolean = false
): Promise<void> {
  if (platform === "android") {
    // Android: scale coordinates if we have physical pixels but shell expects logical
    let targetX = x;
    let targetY = y;

    if (!isLogical) {
      try {
        const { stdout } = await execAsync(`adb -s ${deviceId} shell wm size`);
        const overrideMatch = stdout.match(/Override size: (\d+)x(\d+)/);
        const physicalMatch = stdout.match(/Physical size: (\d+)x(\d+)/);

        if (overrideMatch && physicalMatch) {
          const physW = parseInt(physicalMatch[1]);
          const physH = parseInt(physicalMatch[2]);
          const logW = parseInt(overrideMatch[1]);
          const logH = parseInt(overrideMatch[2]);

          targetX = Math.round(x * (logW / physW));
          targetY = Math.round(y * (logH / physH));
        }
      } catch (e) {
        // Ignore and use raw
      }
    }

    await execAsync(`adb -s ${deviceId} shell input tap ${targetX} ${targetY}`);
  } else {
    // iOS tap via Maestro flow
    // Note: Maestro expects point as a quoted string "x, y"
    const flowYaml = `
---
- tapOn:
    point: "${x}, ${y}"
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

        // 0. Save current keyboard
        let originalIme = "";
        try {
          // 'settings get' returns the ID with a newline
          const { stdout } = await execAsync(
            `adb -s ${deviceId} shell settings get secure default_input_method`
          );
          originalIme = stdout.trim();
        } catch (e) {
          console.error(
            `[DeviceType] Failed to get current IME: ${(e as Error).message}`
          );
        }

        // 1. Enable & Set IME to ADB Keyboard
        await execAsync(
          `adb -s ${deviceId} shell ime enable com.android.adbkeyboard/.AdbIME`
        );
        await execAsync(
          `adb -s ${deviceId} shell ime set com.android.adbkeyboard/.AdbIME`
        );

        // 2. Wait for the keyboard to actually "pop"
        await new Promise((r) => setTimeout(r, 600));

        // 3. Broadcast Base64 using spawnAsync
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

        // 4. Restore original keyboard
        if (originalIme && originalIme !== "com.android.adbkeyboard/.AdbIME") {
          // Small delay to ensure broadcast is processed before switching away
          await new Promise((r) => setTimeout(r, 200));
          try {
            await execAsync(`adb -s ${deviceId} shell ime set ${originalIme}`);
            console.error(`[DeviceType] Restored keyboard to: ${originalIme}`);
          } catch (e) {
            console.error(
              `[DeviceType] Failed to restore keyboard: ${(e as Error).message}`
            );
          }
        }
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
  y2: number,
  isLogical: boolean = false
): Promise<void> {
  if (platform === "android") {
    let tx1 = x1,
      ty1 = y1,
      tx2 = x2,
      ty2 = y2;

    if (!isLogical) {
      try {
        const { stdout } = await execAsync(`adb -s ${deviceId} shell wm size`);
        const overrideMatch = stdout.match(/Override size: (\d+)x(\d+)/);
        const physicalMatch = stdout.match(/Physical size: (\d+)x(\d+)/);

        if (overrideMatch && physicalMatch) {
          const physW = parseInt(physicalMatch[1]);
          const physH = parseInt(physicalMatch[2]);
          const logW = parseInt(overrideMatch[1]);
          const logH = parseInt(overrideMatch[2]);

          const sx = logW / physW;
          const sy = logH / physH;

          tx1 = Math.round(x1 * sx);
          ty1 = Math.round(y1 * sy);
          tx2 = Math.round(x2 * sx);
          ty2 = Math.round(y2 * sy);
        }
      } catch (e) {
        // Ignore
      }
    }

    await execAsync(
      `adb -s ${deviceId} shell input swipe ${tx1} ${ty1} ${tx2} ${ty2}`
    );
  } else {
    // iOS swipe via Maestro - coordinates as quoted strings "x, y"
    const flowYaml = `
---
- swipe:
    start: "${x1}, ${y1}"
    end: "${x2}, ${y2}"
`;
    await runMaestroFlow(deviceId, flowYaml);
  }
}
