import Jimp from "jimp";
import { getSemanticHierarchy } from "./hierarchy.js";
import { getRawScreenshotBuffer } from "./screen.js";
import { deviceTap, deviceSwipe } from "../interaction/input.js";

interface ElementNode {
  type: string;
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  bounds?: string;
  children?: ElementNode[];
  clickable?: boolean;
  enabled?: boolean;
}

/** Element with parsed coordinates for easy use */
export interface ElementWithCoordinates extends Omit<ElementNode, "children"> {
  // Parsed from bounds
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  centerX?: number;
  centerY?: number;
  width?: number;
  height?: number;
}

/**
 * Parse bounds string "[left,top][right,bottom]" into coordinates
 */
export function parseBounds(bounds: string): {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
} | null {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;

  const left = parseInt(match[1]);
  const top = parseInt(match[2]);
  const right = parseInt(match[3]);
  const bottom = parseInt(match[4]);

  return {
    left,
    top,
    right,
    bottom,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
    width: right - left,
    height: bottom - top,
  };
}

export async function findElement(
  deviceId: string,
  platform: "android" | "ios",
  selector: string,
  strategy: "testId" | "text" | "contentDescription"
): Promise<ElementWithCoordinates[]> {
  const root = await getSemanticHierarchy(deviceId, platform);
  if (!root) return [];

  const matches: ElementWithCoordinates[] = [];

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
      // Return a copy without children, with parsed coordinates
      const { children, ...cleanNode } = node;
      const elementWithCoords: ElementWithCoordinates = { ...cleanNode };

      // Parse bounds and add coordinates
      if (cleanNode.bounds) {
        const parsed = parseBounds(cleanNode.bounds);
        if (parsed) {
          elementWithCoords.left = parsed.left;
          elementWithCoords.top = parsed.top;
          elementWithCoords.right = parsed.right;
          elementWithCoords.bottom = parsed.bottom;
          elementWithCoords.centerX = parsed.centerX;
          elementWithCoords.centerY = parsed.centerY;
          elementWithCoords.width = parsed.width;
          elementWithCoords.height = parsed.height;
        }
      }

      matches.push(elementWithCoords);
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

/**
 * Find an element and tap on its center. Most reliable way to interact with UI.
 */
export async function tapOnElement(
  deviceId: string,
  platform: "android" | "ios",
  selector: string,
  strategy: "testId" | "text" | "contentDescription"
): Promise<{
  success: boolean;
  element: ElementWithCoordinates;
  message: string;
}> {
  const elements = await findElement(deviceId, platform, selector, strategy);

  if (elements.length === 0) {
    throw new Error(
      `Element not found with ${strategy}="${selector}". Try using get_semantic_hierarchy to see available elements.`
    );
  }

  const element = elements[0];

  if (element.centerX === undefined || element.centerY === undefined) {
    throw new Error(
      `Element "${selector}" found but has no valid bounds for tapping.`
    );
  }

  // Tap on the center of the element
  await deviceTap(deviceId, platform, element.centerX, element.centerY);

  return {
    success: true,
    element,
    message: `Tapped on "${element.text || selector}" at (${element.centerX}, ${
      element.centerY
    })`,
  };
}

/**
 * Scroll in a direction until an element is found, or timeout.
 * Useful for elements that are off-screen.
 */
export async function scrollToElement(
  deviceId: string,
  platform: "android" | "ios",
  selector: string,
  strategy: "testId" | "text" | "contentDescription",
  direction: "up" | "down" | "left" | "right" = "down",
  maxScrolls: number = 5,
  scrollDurationMs: number = 300
): Promise<{
  success: boolean;
  element: ElementWithCoordinates;
  scrollCount: number;
}> {
  // First check if element is already visible
  let elements = await findElement(deviceId, platform, selector, strategy);
  if (elements.length > 0) {
    return { success: true, element: elements[0], scrollCount: 0 };
  }

  // Get screen dimensions for scroll coordinates
  // For iOS, use points (hierarchy coordinates), not pixels
  // iOS Retina displays have 3x scale, so we use smaller coordinates
  const { getViewport } = await import("./screen.js");
  const viewport = await getViewport(deviceId, platform);

  // iOS uses points (typically 1/3 of pixels for 3x Retina)
  // Android uses actual pixels
  const scaleFactor = platform === "ios" ? 3 : 1;
  const screenWidth = Math.round(viewport.originalWidth / scaleFactor);
  const screenHeight = Math.round(viewport.originalHeight / scaleFactor);

  const centerX = Math.round(screenWidth / 2);
  const centerY = Math.round(screenHeight / 2);

  // Calculate scroll vectors (swipe in opposite direction of desired scroll)
  const scrollDistance = Math.round(screenHeight / 3);
  let swipeCoords: { x1: number; y1: number; x2: number; y2: number };

  switch (direction) {
    case "down": // Swipe up to scroll down
      swipeCoords = {
        x1: centerX,
        y1: centerY + scrollDistance / 2,
        x2: centerX,
        y2: centerY - scrollDistance / 2,
      };
      break;
    case "up": // Swipe down to scroll up
      swipeCoords = {
        x1: centerX,
        y1: centerY - scrollDistance / 2,
        x2: centerX,
        y2: centerY + scrollDistance / 2,
      };
      break;
    case "right": // Swipe left to scroll right
      swipeCoords = {
        x1: centerX + scrollDistance / 2,
        y1: centerY,
        x2: centerX - scrollDistance / 2,
        y2: centerY,
      };
      break;
    case "left": // Swipe right to scroll left
      swipeCoords = {
        x1: centerX - scrollDistance / 2,
        y1: centerY,
        x2: centerX + scrollDistance / 2,
        y2: centerY,
      };
      break;
  }

  for (let i = 0; i < maxScrolls; i++) {
    // Perform swipe
    await deviceSwipe(
      deviceId,
      platform,
      swipeCoords.x1,
      swipeCoords.y1,
      swipeCoords.x2,
      swipeCoords.y2
    );

    // Wait for scroll animation and Maestro to fully complete
    // iOS/Maestro needs longer delays between commands to avoid getting stuck
    const delayMs = platform === "ios" ? 1500 : scrollDurationMs + 200;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // Check if element is now visible
    elements = await findElement(deviceId, platform, selector, strategy);
    if (elements.length > 0) {
      return { success: true, element: elements[0], scrollCount: i + 1 };
    }
  }

  throw new Error(
    `Element "${selector}" not found after ${maxScrolls} scrolls ${direction}. It may not exist or be in a different scroll direction.`
  );
}
