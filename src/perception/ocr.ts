import { Buffer } from "buffer";
import { createWorker } from "tesseract.js";
import { getViewport } from "./screen.js";

// Global state for OCR configuration
let globalDefaultLanguage = "eng";

export function configureOcr(language: string): string {
  globalDefaultLanguage = language;
  return `OCR Language set to: ${language}`;
}

export async function getScreenText(
  deviceId: string,
  platform: "android" | "ios",
  language?: string
): Promise<string> {
  // 1. Get screenshot (returns base64 JPEG)
  const { imageBase64 } = await getViewport(deviceId, platform);
  const imageBuffer = Buffer.from(imageBase64, "base64");

  // 2. Resolve language
  // Priority: Explicit Argument > Global Default > "eng"
  let paramsLang = language || globalDefaultLanguage || "eng";

  // Tesseract uses '+' for multiple languages, users might use commas
  const finalLang = paramsLang.replace(/,/g, "+");

  // 3. OCR with Tesseract
  const worker = await createWorker(finalLang);
  const ret = await worker.recognize(imageBuffer);
  const text = ret.data.text;
  await worker.terminate();

  return text.trim();
}
