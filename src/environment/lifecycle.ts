import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function manageAppLifecycle(
  action: "launch" | "stop" | "install" | "uninstall",
  deviceId: string,
  platform: "android" | "ios",
  target: string // bundleId for launch/stop/uninstall, path for install
): Promise<string> {
  if (platform === "android") {
    switch (action) {
      case "launch":
        // am start -n com.package/.Activity or just monkey -p com.package (but monkey is chaotic).
        // Best generic way: am start -p com.package (if main intent exists) or monkey -p com.package 1
        // 'monkey -p' is a trick to launch the default activity without knowing the activity name.
        await execAsync(
          `adb -s ${deviceId} shell monkey -p ${target} -c android.intent.category.LAUNCHER 1`
        );
        return `Launched ${target}`;
      case "stop":
        await execAsync(`adb -s ${deviceId} shell am force-stop ${target}`);
        return `Stopped ${target}`;
      case "install":
        await execAsync(`adb -s ${deviceId} install -r "${target}"`);
        return `Installed ${target}`;
      case "uninstall":
        await execAsync(`adb -s ${deviceId} uninstall ${target}`);
        return `Uninstalled ${target}`;
    }
  } else {
    // iOS
    switch (action) {
      case "launch":
        await execAsync(`xcrun simctl launch ${deviceId} ${target}`);
        return `Launched ${target}`;
      case "stop":
        await execAsync(`xcrun simctl terminate ${deviceId} ${target}`);
        return `Stopped ${target}`;
      case "install":
        await execAsync(`xcrun simctl install ${deviceId} "${target}"`);
        return `Installed ${target}`;
      case "uninstall":
        await execAsync(`xcrun simctl uninstall ${deviceId} ${target}`);
        return `Uninstalled ${target}`;
    }
  }
  throw new Error(`Unknown action ${action} or platform ${platform}`);
}
