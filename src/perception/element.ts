import Jimp from "jimp";
import { getSemanticHierarchy } from "./hierarchy.js";
import { getRawScreenshotBuffer } from "./screen.js";

interface ElementNode {
  type: string;
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  bounds?: string;
  children?: ElementNode[];
  clickable?: boolean;
}

export async function findElement(
  deviceId: string,
  platform: "android" | "ios",
  selector: string,
  strategy: "testId" | "text" | "contentDescription"
): Promise<ElementNode[]> {
  const root = await getSemanticHierarchy(deviceId, platform);
  if (!root) return [];

  const matches: ElementNode[] = [];

  function traverse(node: ElementNode) {
    let match = false;
    if (strategy === "testId") {
      // Android: resource-id, iOS: identifier (mapped to resourceId in hierarchy.ts)
      if (node.resourceId && node.resourceId.endsWith(selector)) {
        match = true;
      }
    } else if (strategy === "text") {
      if (
        node.text &&
        node.text.toLowerCase().includes(selector.toLowerCase())
      ) {
        match = true;
      }
    } else if (strategy === "contentDescription") {
      if (
        node.contentDesc &&
        node.contentDesc.toLowerCase().includes(selector.toLowerCase())
      ) {
        match = true;
      }
    }

    if (match) {
      // Return a copy without children to keep result minimal
      const { children, ...cleanNode } = node;
      matches.push(cleanNode);
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return matches;
}

export async function waitForElement(
  deviceId: string,
  platform: "android" | "ios",
  selector: string,
  strategy: "testId" | "text" | "contentDescription",
  timeoutMs: number = 10000
): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const elements = await findElement(deviceId, platform, selector, strategy);
    if (elements.length > 0) {
      return `Found ${elements.length} element(s) matching "${selector}"`;
    }
    // Wait 1s
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(
    `Timeout waiting for element "${selector}" after ${timeoutMs}ms`
  );
}

export async function getElementImage(
  deviceId: string,
  platform: "android" | "ios",
  selector: string,
  strategy: "testId" | "text" | "contentDescription"
): Promise<string> {
  // 1. Find Element
  const elements = await findElement(deviceId, platform, selector, strategy);
  if (elements.length === 0) {
    throw new Error(`Element "${selector}" not found.`);
  }
  const element = elements[0];
  if (!element.bounds) {
    throw new Error(`Element "${selector}" found but has no bounds.`);
  }

  // 2. Parse Bounds "[x1,y1][x2,y2]"
  const boundsMatch = element.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!boundsMatch) {
    throw new Error(`Invalid bounds format: ${element.bounds}`);
  }

  let x1 = parseInt(boundsMatch[1]);
  let y1 = parseInt(boundsMatch[2]);
  let x2 = parseInt(boundsMatch[3]);
  let y2 = parseInt(boundsMatch[4]);

  const w = x2 - x1;
  const h = y2 - y1;

  // 3. Get Screenshot (Raw)
  const rawBuffer = await getRawScreenshotBuffer(deviceId, platform);
  const image = await Jimp.read(rawBuffer);

  // 4. Crop
  // Ensure we don't go out of bounds (just in case)
  x1 = Math.max(0, x1);
  y1 = Math.max(0, y1);
  const cropW = Math.min(w, image.bitmap.width - x1);
  const cropH = Math.min(h, image.bitmap.height - y1);

  image.crop(x1, y1, cropW, cropH);

  const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
  return buffer.toString("base64");
}
