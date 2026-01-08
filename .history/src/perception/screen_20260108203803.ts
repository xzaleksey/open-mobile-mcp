import { Buffer } from "buffer";
import { exec } from "child_process";
import Jimp from "jimp";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { promisify } from "util";

const execAsync = promisify(exec);

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

export async function getViewport(
  deviceId: string,
  platform: "android" | "ios"
): Promise<{ imageBase64: string; width: number; height: number }> {
  let rawBuffer: Buffer;

  if (platform === "android") {
    rawBuffer = await getAndroidScreenshot(deviceId);
  } else {
    rawBuffer = await getIosScreenshot(deviceId);
  }

  // Resize using Jimp
  const image = await Jimp.read(rawBuffer);

  // Resize if width > 800, keeping aspect ratio
  if (image.bitmap.width > 800) {
    image.resize(800, Jimp.AUTO);
  }

  // Use JPEG for smaller payload size (default quality 75 is usually fine)
  const resizedBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
  const base64 = resizedBuffer.toString("base64");

  return {
    imageBase64: base64,
    width: image.bitmap.width,
    height: image.bitmap.height,
  };
}

export async function captureDiff(
  baselineBase64: string,
  currentBase64: string
): Promise<{ diffPercentage: number; diffImageBase64: string }> {
  const img1 = PNG.sync.read(Buffer.from(baselineBase64, "base64"));
  const img2 = PNG.sync.read(Buffer.from(currentBase64, "base64"));

  const { width, height } = img1;
  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(
    img1.data,
    img2.data,
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
