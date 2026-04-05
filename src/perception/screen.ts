import { Buffer } from "buffer";
import { exec } from "child_process";
import Jimp from "jimp";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);
const activeRecordings = new Map<string, any>();

async function getAndroidScreenshot(deviceId: string): Promise<Buffer> {
  // Use exec-out for direct binary stream, avoiding CR/LF issues
  const { stdout, stderr } = await execAsync(
    `adb -s ${deviceId} exec-out screencap -p`,
    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout;
}

async function getIosScreenshot(deviceId: string): Promise<Buffer> {
  // simctl io screenshot writes to a file. We'll use a temp file.
  // Limitation: can we stream? 'xcrun simctl io booted screenshot -' writes to stdout
  const { stdout } = await execAsync(
    `xcrun simctl io ${deviceId} screenshot -`,
    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout;
}

export async function getRawScreenshotBuffer(
  deviceId: string,
  platform: "android" | "ios"
): Promise<Buffer> {
  if (platform === "android") {
    return getAndroidScreenshot(deviceId);
  } else {
    return getIosScreenshot(deviceId);
  }
}

export async function getViewport(
  deviceId: string,
  platform: "android" | "ios"
): Promise<{
  imageBase64: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  logicalWidth?: number;
  logicalHeight?: number;
}> {
  let rawBuffer = await getRawScreenshotBuffer(deviceId, platform);

  // Resize using Jimp
  const image = await Jimp.read(rawBuffer);
  const originalWidth = image.bitmap.width;
  const originalHeight = image.bitmap.height;

  // Resize if width > 800, keeping aspect ratio
  if (image.bitmap.width > 800) {
    image.resize(800, Jimp.AUTO);
  }

  // Use JPEG for smaller payload size (default quality 75 is usually fine)
  const resizedBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
  const base64 = resizedBuffer.toString("base64");

  const result: any = {
    imageBase64: base64,
    width: image.bitmap.width,
    height: image.bitmap.height,
    originalWidth,
    originalHeight,
  };

  if (platform === "android") {
    try {
      const { stdout } = await execAsync(`adb -s ${deviceId} shell wm size`);
      const overrideMatch = stdout.match(/Override size: (\d+)x(\d+)/);
      const physicalMatch = stdout.match(/Physical size: (\d+)x(\d+)/);
      if (overrideMatch) {
        result.logicalWidth = parseInt(overrideMatch[1]);
        result.logicalHeight = parseInt(overrideMatch[2]);
      } else if (physicalMatch) {
        result.logicalWidth = parseInt(physicalMatch[1]);
        result.logicalHeight = parseInt(physicalMatch[2]);
      }
    } catch (e) {
      // Ignore
    }
  }

  return result;
}

export async function captureDiff(
  baselineBase64: string,
  currentBase64: string
): Promise<{ diffPercentage: number; diffImageBase64: string }> {
  const img1 = await Jimp.read(Buffer.from(baselineBase64, "base64"));
  const img2 = await Jimp.read(Buffer.from(currentBase64, "base64"));

  const { width, height } = img1.bitmap;
  // Ensure same dimensions or handle resize - for now assume roughly same or let pixelmatch handle/throw
  if (
    img1.bitmap.width !== img2.bitmap.width ||
    img1.bitmap.height !== img2.bitmap.height
  ) {
    img2.resize(width, height);
  }

  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(
    img1.bitmap.data,
    img2.bitmap.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );
  const diffPercentage = (numDiffPixels / (width * height)) * 100;

  return {
    diffPercentage,
    diffImageBase64: PNG.sync.write(diff).toString("base64"),
  };
}

/**
 * Start screen recording on Android
 */
export async function startRecording(
  deviceId: string,
  platform: "android" | "ios"
): Promise<string> {
  if (platform === "android") {
    if (activeRecordings.has(deviceId)) {
      throw new Error(`Recording already in progress for device ${deviceId}`);
    }

    // Start screenrecord in background
    // Limit to 180s (ADB default/max) or we can manage it
    execAsync(
      `adb -s ${deviceId} shell screenrecord --size 720x1280 /sdcard/mcp_record.mp4`
    );
    activeRecordings.set(deviceId, true); // Just a flag that it's active

    return "Recording started on /sdcard/mcp_record.mp4";
  } else {
    throw new Error("Screen recording not yet implemented for iOS");
  }
}

/**
 * Stop screen recording and pull the file
 */
export async function stopRecording(
  deviceId: string,
  platform: "android" | "ios",
  localPath: string
): Promise<string> {
  if (platform === "android") {
    if (!activeRecordings.has(deviceId)) {
      throw new Error(`No active recording found for device ${deviceId}`);
    }

    try {
      // Send SIGINT to stop screenrecord gracefully
      await execAsync(`adb -s ${deviceId} shell pkill -INT screenrecord`);
      
      // Wait a moment for file to finalize on device
      await new Promise((r) => setTimeout(r, 1500));

      // Pull the file
      const absolutePath = path.resolve(localPath);
      await execAsync(`adb -s ${deviceId} pull /sdcard/mcp_record.mp4 "${absolutePath}"`);
      
      // Clean up on device
      await execAsync(`adb -s ${deviceId} shell rm /sdcard/mcp_record.mp4`);
      
      activeRecordings.delete(deviceId);

      return `Recording saved to ${absolutePath}`;
    } catch (e: any) {
      activeRecordings.delete(deviceId);
      throw new Error(`Failed to stop/pull recording: ${e.message}`);
    }
  } else {
    throw new Error("Screen recording not yet implemented for iOS");
  }
}
