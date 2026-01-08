import { exec } from "child_process";
import { promisify } from "util";
import * as xml2js from "xml2js";

const execAsync = promisify(exec);

async function getAndroidHierarchy(deviceId: string): Promise<string> {
  // Dump to sdcard, then pull
  try {
    await execAsync(
      `adb -s ${deviceId} shell uiautomator dump /sdcard/window_dump.xml`
    );
    const { stdout } = await execAsync(
      `adb -s ${deviceId} shell cat /sdcard/window_dump.xml`
    );
    return stdout;
  } catch (e) {
    throw new Error(`Failed to get Android hierarchy: ${(e as Error).message}`);
  }
}

async function getIosHierarchy(deviceId: string): Promise<string> {
  // Attempt to use maestro hierarchy if available, as 'xcrun simctl' is limited
  try {
    const { stdout } = await execAsync(
      `maestro hierarchy --device ${deviceId}`
    );
    return stdout;
  } catch (e) {
    // Fallback or error
    throw new Error(
      `Failed to get iOS hierarchy (Maestro required): ${(e as Error).message}`
    );
  }
}

interface SimplifiedNode {
  type: string;
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  bounds?: string;
  children?: SimplifiedNode[];
  clickable?: boolean;
}

function pruneAndSimplify(node: any): SimplifiedNode | null {
  // Logic to simplify the XML node
  // Android nodes usually have attributes like 'text', 'resource-id', 'content-desc', 'class'
  // iOS (Maestro) might use 'label', 'identifier', 'value'

  // Abstract attributes
  const attributes = node.$ || {};
  const text = attributes.text || attributes.label || attributes.value || "";
  const resourceId = attributes["resource-id"] || attributes.identifier || "";
  const contentDesc =
    attributes["content-desc"] || attributes.accessibilityLabel || "";
  const bounds = attributes.bounds || attributes.frame || "";
  const type = attributes.class || attributes.elementType || "unknown";
  const clickable =
    attributes.clickable === "true" || attributes.enabled === "true"; // rough approx

  const children: SimplifiedNode[] = [];

  if (node.node) {
    for (const child of node.node) {
      const result = pruneAndSimplify(child);
      if (result) {
        children.push(result);
      }
    }
  }

  // Filter logic: Keep if it has important info or has children
  const isInteractive = clickable || text || contentDesc || resourceId;

  if (!isInteractive && children.length === 0) {
    return null; // Prune empty non-interactive nodes
  }

  const simpleNode: SimplifiedNode = {
    type,
    ...(text ? { text } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(contentDesc ? { contentDesc } : {}),
    ...(bounds ? { bounds } : {}),
    ...(clickable ? { clickable } : {}),
  };

  if (children.length > 0) {
    simpleNode.children = children;
  }

  return simpleNode;
}

export async function getSemanticHierarchy(
  deviceId: string,
  platform: "android" | "ios"
): Promise<SimplifiedNode | null> {
  let xml: string;
  if (platform === "android") {
    xml = await getAndroidHierarchy(deviceId);
  } else {
    xml = await getIosHierarchy(deviceId);
  }

  const result = await xml2js.parseStringPromise(xml);
  // Usually root is 'hierarchy' -> 'node' (Android)
  return pruneAndSimplify(result.hierarchy || result);
}
