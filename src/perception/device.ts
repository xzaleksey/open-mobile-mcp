import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface Device {
  id: string;
  name: string;
  type: "android" | "ios";
  state: "booted" | "shutdown" | "unknown";
}

export async function listDevices(): Promise<Device[]> {
  const devices: Device[] = [];

  // Android
  try {
    const { stdout } = await execAsync("adb devices -l");
    const lines = stdout
      .split("\n")
      .filter(
        (line) => line.trim() !== "" && !line.startsWith("List of devices")
      );

    for (const line of lines) {
      // Example: emulator-5554   device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emulator64_x86_64 transport_id:1
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const id = parts[0];
        const stateRaw = parts[1];
        if (stateRaw === "device") {
          devices.push({
            id,
            name: `Android Emulator (${id})`, // Parse model if needed
            type: "android",
            state: "booted",
          });
        }
      }
    }
  } catch (error) {
    // Ignore adb errors if not installed/running
  }

  // iOS
  try {
    const { stdout } = await execAsync("xcrun simctl list devices booted -j");
    const json = JSON.parse(stdout);
    for (const runtime in json.devices) {
      const runtimeDevices = json.devices[runtime];
      for (const device of runtimeDevices) {
        if (device.state === "Booted") {
          devices.push({
            id: device.udid,
            name: device.name,
            type: "ios",
            state: "booted",
          });
        }
      }
    }
  } catch (error) {
    // Ignore simctl errors (not on mac)
  }

  return devices;
}
