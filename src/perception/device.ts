import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface Device {
  id: string;
  name: string;
  type: "android" | "ios";
  state: "booted" | "shutdown" | "unknown";
  screen?: {
    width: number;
    height: number;
    density?: number;
    logicalWidth?: number;
    logicalHeight?: number;
  };
}

interface SimctlDevicesJson {
  devices: {
    [runtime: string]: Array<{
      udid: string;
      name: string;
      state: string;
      isAvailable?: boolean;
      availabilityError?: string;
    }>;
  };
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
          // Try to extract model name from the line
          const modelMatch = line.match(/model:(\S+)/);
          const deviceName = modelMatch
            ? modelMatch[1].replace(/_/g, " ")
            : `Android (${id})`;

          const device: Device = {
            id,
            name: deviceName,
            type: "android",
            state: "booted",
          };

          // Fetch screen info
          try {
            const { stdout: sizeOut } = await execAsync(
              `adb -s ${id} shell wm size`
            );
            // wm size output:
            // Physical size: 1200x1920
            // Override size: 800x1280 (optional)
            const physicalSizeMatch = sizeOut.match(/Physical size: (\d+)x(\d+)/);
            if (physicalSizeMatch) {
              device.screen = {
                width: parseInt(physicalSizeMatch[1]),
                height: parseInt(physicalSizeMatch[2]),
              };

              const overrideSizeMatch = sizeOut.match(/Override size: (\d+)x(\d+)/);
              if (overrideSizeMatch) {
                device.screen.logicalWidth = parseInt(overrideSizeMatch[1]);
                device.screen.logicalHeight = parseInt(overrideSizeMatch[2]);
              } else {
                device.screen.logicalWidth = device.screen.width;
                device.screen.logicalHeight = device.screen.height;
              }
            }

            const { stdout: densityOut } = await execAsync(
              `adb -s ${id} shell wm density`
            );
            // wm density output:
            // Physical density: 320
            // Override density: 240 (optional)
            const densityMatch =
              densityOut.match(/Override density: (\d+)/) ||
              densityOut.match(/Physical density: (\d+)/);
            if (densityMatch && device.screen) {
              device.screen.density = parseInt(densityMatch[1]);
            }
          } catch (e) {
            // Ignore if wm command fails
          }

          devices.push(device);
        }
      }
    }
  } catch (error) {
    // Ignore adb errors if not installed/running
  }

  // iOS - use xcrun simctl
  try {
    const { stdout } = await execAsync("xcrun simctl list devices booted -j");
    const json: SimctlDevicesJson = JSON.parse(stdout);

    if (json.devices && typeof json.devices === "object") {
      for (const runtime of Object.keys(json.devices)) {
        const runtimeDevices = json.devices[runtime];
        if (Array.isArray(runtimeDevices)) {
          for (const device of runtimeDevices) {
            // simctl with "booted" filter should only return booted devices,
            // but double-check the state for robustness
            if (device.state === "Booted" && device.udid && device.name) {
              devices.push({
                id: device.udid,
                name: device.name,
                type: "ios",
                state: "booted",
              });
            }
          }
        }
      }
    }
  } catch (error) {
    // Ignore simctl errors (not on mac or Xcode not installed)
  }

  return devices;
}
