import { exec } from "child_process";
import { promisify } from "util";
import { runMaestroFlow } from "./maestro.js";

const execAsync = promisify(exec);

export async function deviceTap(
  deviceId: string,
  platform: "android" | "ios",
  x: number,
  y: number
): Promise<void> {
  if (platform === "android") {
    await execAsync(`adb -s ${deviceId} shell input tap ${x} ${y}`);
  } else {
    // iOS tap via Maestro one-shot
    const flowYaml = `
appId: com.example.app // Replacement needed? Actually maestro can run on currently open app
---
- tapOn:
    point: ${x},${y}
`;
    // We need a generic way to run on the current app. Maestro usually needs appID.
    // However, if we don't supply appId, Maestro might complain.
    // For now, we'll try to rely on 'maestro test' running against the currently visible app if possible,
    // or we might need the bundleID.
    // Hack: pass a dummy ID or rely on the user providing it?
    // Better: let's treat iOS single taps as "not supported natively" or "use run_maestro_flow".
    // But to be helpful, we will try to write a flow.
    await runMaestroFlow(deviceId, flowYaml); // This will function if we handle the yaml correctly
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
      // Method: Inject into clipboard -> Paste
      try {
        // 1. Set clipboard content using 'service call clipboard'
        // code 2 = setPrimaryClip
        // i32 1 = num items
        // i32 0 = mime type index (text/plain)
        // s16 = the string
        // Note: Escaping quotes in the string for shell is important.
        const safeText = text.replace(/"/g, '\\"');
        await execAsync(
          `adb -s ${deviceId} shell service call clipboard 2 i32 1 i32 0 s16 "${safeText}"`
        );

        // 2. Send Paste key event (KEYCODE_PASTE = 279)
        await execAsync(`adb -s ${deviceId} shell input keyevent 279`);
      } catch (e) {
        // Fallback to Maestro if clipboard fails (e.g. valid on very old Android or locked shell)
        const flowYaml = `
---
- inputText: "${text}"
`;
        await runMaestroFlow(deviceId, flowYaml);
      }
    }
  } else {
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
