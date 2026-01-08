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
