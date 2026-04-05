import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function openDeepLink(
  deviceId: string,
  platform: "android" | "ios",
  url: string
): Promise<string> {
  if (platform === "android") {
    // am start -a android.intent.action.VIEW -d "url"
    await execAsync(
      `adb -s ${deviceId} shell am start -a android.intent.action.VIEW -d "${url}"`
    );
  } else {
    // xcrun simctl openurl booted "url"
    await execAsync(`xcrun simctl openurl ${deviceId} "${url}"`);
  }
  return `Opened URL: ${url}`;
}

/**
 * Set the system locale on Android
 */
export async function setSystemLocale(
  deviceId: string,
  platform: "android" | "ios",
  locale: string
): Promise<string> {
  if (platform === "android") {
    // Note: This often requires a permission: adb shell pm grant com.learningai.client android.permission.CHANGE_CONFIGURATION
    // But on many emulators/debug builds, the broadcast works or we can use settings put
    // Most reliable for AI context is broadcast + settings put
    try {
      await execAsync(
        `adb -s ${deviceId} shell "settings put global system_locales ${locale} && am broadcast -a android.intent.action.LOCALE_CHANGED"`
      );
      return `Locale set to ${locale} (Broadcast sent)`;
    } catch (e: any) {
      throw new Error(`Failed to set locale: ${e.message}`);
    }
  } else {
    throw new Error("Set locale not yet implemented for iOS");
  }
}
