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
  isLogical: boolean = false,
  duration: number = 0,
): Promise<void> {
  if (duration > 0) {
    return deviceSwipe(deviceId, platform, x, y, x, y, isLogical, duration);
  }

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
  text: string,
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
          `adb -s ${deviceId} shell ime list -a`,
        );
        if (stdout.includes("com.android.adbkeyboard/.AdbIME")) {
          hasAdbKeyboard = true;
        }
      } catch (e) {
        // Ignore error, assume not installed
      }

      if (hasAdbKeyboard) {
        console.error(
          `[DeviceType] Unicode Strategy: ADB Keyboard Base64 Broadcast for '${text}'`,
        );

        // 0. Save current keyboard
        let originalIme = "";
        try {
          // 'settings get' returns the ID with a newline
          const { stdout } = await execAsync(
            `adb -s ${deviceId} shell settings get secure default_input_method`,
          );
          originalIme = stdout.trim();
        } catch (e) {
          console.error(
            `[DeviceType] Failed to get current IME: ${(e as Error).message}`,
          );
        }

        // 1. Enable & Set IME to ADB Keyboard
        await execAsync(
          `adb -s ${deviceId} shell ime enable com.android.adbkeyboard/.AdbIME`,
        );
        await execAsync(
          `adb -s ${deviceId} shell ime set com.android.adbkeyboard/.AdbIME`,
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
              `[DeviceType] Failed to restore keyboard: ${(e as Error).message}`,
            );
          }
        }
      } else {
        // Strategy 2: Native Clipboard Injection (Android 11+)
        // This is robust and requires no external app.
        try {
          console.error(
            `[DeviceType] Unicode Strategy: Native Clipboard+Paste for '${text}'`,
          );
          // Set clipboard via content provider
          // We need to escape double quotes for the shell
          const safeText = text.replace(/"/g, '\\"');
          await execAsync(
            `adb -s ${deviceId} shell content call --uri content://settings/system --method PUT_STRING --arg value:s:"${safeText}"`,
          ).catch(() => {
            // Try older 'service call' or 'content set' if 'call' fails, but let's just fall through to Maestro if this fails.
            // Actually the user suggested 'content set', let's aim for that or just accept failure.
            // User suggested: content set --uri content://settings/system --bind value:s:"${text}"
            // But 'content call' is often safer. Let's stick to the user's exact suggestion for safety:
            return execAsync(
              `adb -s ${deviceId} shell content set --uri content://settings/system --bind value:s:"${safeText}"`,
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
          `[DeviceType] Unicode Strategy: Maestro (Raw UTF-8) for '${text}'`,
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

// Path to the bundled UIAutomator instrumentation APK (relative to this file's location at build time)
const PINCH_APK_PATH = new URL(
  "../../assets/android/pinch-driver.apk",
  import.meta.url,
).pathname.replace(/^\/([A-Z]:)/, "$1");
const PINCH_PACKAGE = "com.openmobilemcp.driver";
const PINCH_RUNNER = `${PINCH_PACKAGE}/.PinchInstrumentation`;

async function ensurePinchApkInstalled(deviceId: string): Promise<void> {
  // Check if already installed
  const { stdout } = await execAsync(
    `adb -s ${deviceId} shell pm list packages ${PINCH_PACKAGE}`,
  ).catch(() => ({ stdout: "" }));
  if (stdout.includes(PINCH_PACKAGE)) return;

  // Install from bundled APK
  await execAsync(`adb -s ${deviceId} install -t "${PINCH_APK_PATH}"`);
}

export async function devicePinch(
  deviceId: string,
  platform: "android" | "ios",
  centerX: number,
  centerY: number,
  direction: "in" | "out",
  spread: number = 200,
  duration: number = 500,
  isLogical: boolean = false,
): Promise<void> {
  if (platform === "ios") {
    // iOS: sequential Maestro swipes as best-effort approximation
    const near = Math.round(spread * 0.15);
    const far = spread;
    const [x1s, x1e] =
      direction === "out"
        ? [centerX - near, centerX - far]
        : [centerX - far, centerX - near];
    const [x2s, x2e] =
      direction === "out"
        ? [centerX + near, centerX + far]
        : [centerX + far, centerX + near];
    const flowYaml = `
---
- swipe:
    start: "${x1s}, ${centerY}"
    end: "${x1e}, ${centerY}"
- swipe:
    start: "${x2s}, ${centerY}"
    end: "${x2e}, ${centerY}"
`;
    await runMaestroFlow(deviceId, flowYaml);
    return;
  }

  // Android: inject a real two-finger MotionEvent via UIAutomation instrumentation APK.
  // Uses UiAutomation.injectInputEvent() — works on production devices without root.
  await ensurePinchApkInstalled(deviceId);

  // Apply display override scaling if coordinates are physical (not logical)
  let cx = centerX,
    cy = centerY;
  if (!isLogical) {
    try {
      const { stdout } = await execAsync(`adb -s ${deviceId} shell wm size`);
      const overrideMatch = stdout.match(/Override size: (\d+)x(\d+)/);
      const physicalMatch = stdout.match(/Physical size: (\d+)x(\d+)/);
      if (overrideMatch && physicalMatch) {
        cx = Math.round(
          centerX * (parseInt(overrideMatch[1]) / parseInt(physicalMatch[1])),
        );
        cy = Math.round(
          centerY * (parseInt(overrideMatch[2]) / parseInt(physicalMatch[2])),
        );
      }
    } catch (e) {}
  }

  const { stdout, stderr } = await execAsync(
    `adb -s ${deviceId} shell am instrument -w ` +
      `-e centerX ${cx} -e centerY ${cy} ` +
      `-e direction ${direction} -e spread ${spread} -e duration ${duration} ` +
      PINCH_RUNNER,
    { timeout: duration + 15000 },
  );

  if (!stdout.includes("result=ok")) {
    throw new Error(`Pinch failed: ${stdout} ${stderr}`);
  }
}

// Key name → Android keycode
const KEY_CODES: Record<string, number> = {
  back: 4,
  home: 3,
  recents: 187,
  app_switch: 187,
  enter: 66,
  delete: 67,
  backspace: 67,
  forward_delete: 112,
  volume_up: 24,
  volume_down: 25,
  volume_mute: 164,
  power: 26,
  escape: 111,
  tab: 61,
  search: 84,
  menu: 82,
  space: 62,
  camera: 27,
  dpad_up: 19,
  dpad_down: 20,
  dpad_left: 21,
  dpad_right: 22,
  dpad_center: 23,
};

export async function devicePressKey(
  deviceId: string,
  platform: "android" | "ios",
  key: string,
): Promise<void> {
  if (platform === "ios") {
    const flowYaml = `\n---\n- pressKey: ${key}\n`;
    await runMaestroFlow(deviceId, flowYaml);
    return;
  }

  const code = KEY_CODES[key.toLowerCase()] ?? parseInt(key);
  if (isNaN(code)) throw new Error(`Unknown key: ${key}`);
  await execAsync(`adb -s ${deviceId} shell input keyevent ${code}`);
}

export async function deviceRotateGesture(
  deviceId: string,
  platform: "android" | "ios",
  centerX: number,
  centerY: number,
  degrees: number,
  radius: number = 120,
  duration: number = 500,
): Promise<void> {
  if (platform === "ios") {
    throw new Error("device_rotate_gesture is not supported on iOS yet");
  }

  await ensurePinchApkInstalled(deviceId);
  const { stdout, stderr } = await execAsync(
    `adb -s ${deviceId} shell am instrument -w ` +
      `-e action rotate -e centerX ${centerX} -e centerY ${centerY} ` +
      `-e degrees ${degrees} -e radius ${radius} -e duration ${duration} ` +
      PINCH_RUNNER,
    { timeout: duration + 15000 },
  );

  if (!stdout.includes("result=ok")) {
    throw new Error(`Rotate gesture failed: ${stdout} ${stderr}`);
  }
}

export async function clearAppData(
  deviceId: string,
  platform: "android" | "ios",
  packageId: string,
): Promise<string> {
  if (platform === "ios") {
    // iOS: clear via Maestro clearState
    const flowYaml = `\n---\n- clearState: ${packageId}\n`;
    await runMaestroFlow(deviceId, flowYaml);
    return "App data cleared";
  }
  const { stdout } = await execAsync(
    `adb -s ${deviceId} shell pm clear ${packageId}`,
  );
  return stdout.trim();
}

export async function getAppInfo(
  deviceId: string,
  platform: "android" | "ios",
  packageId: string,
): Promise<object> {
  if (platform === "ios") {
    throw new Error(
      "get_app_info is Android-only; use get_semantic_hierarchy for iOS app details",
    );
  }
  const { stdout } = await execAsync(
    `adb -s ${deviceId} shell dumpsys package ${packageId}`,
  );

  const versionName = stdout.match(/versionName=([^\s]+)/)?.[1] ?? null;
  const versionCode = stdout.match(/versionCode=(\d+)/)?.[1] ?? null;
  const firstInstall =
    stdout.match(/firstInstallTime=([^\n]+)/)?.[1]?.trim() ?? null;
  const lastUpdate =
    stdout.match(/lastUpdateTime=([^\n]+)/)?.[1]?.trim() ?? null;
  const targetSdk = stdout.match(/targetSdk=(\d+)/)?.[1] ?? null;
  const dataDir = stdout.match(/dataDir=([^\s]+)/)?.[1] ?? null;

  const granted: string[] = [];
  const denied: string[] = [];
  const permBlock =
    stdout.match(/install permissions:([\s\S]*?)(?=\n\S|\nUser #)/)?.[1] ?? "";
  for (const line of permBlock.split("\n")) {
    const m = line.match(/android\.permission\.(\w+):\s*granted=(\w+)/);
    if (m) (m[2] === "true" ? granted : denied).push(m[1]);
  }

  return {
    packageId,
    versionName,
    versionCode,
    firstInstall,
    lastUpdate,
    targetSdk,
    dataDir,
    grantedPermissions: granted,
    deniedPermissions: denied,
  };
}

export async function deviceSwipe(
  deviceId: string,
  platform: "android" | "ios",
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  isLogical: boolean = false,
  duration: number = 300,
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
      `adb -s ${deviceId} shell input swipe ${tx1} ${ty1} ${tx2} ${ty2} ${duration}`,
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
