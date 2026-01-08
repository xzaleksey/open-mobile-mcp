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

function pruneAndSimplify(node: any, depth: number = 0): SimplifiedNode | null {
  if (depth > 50) return null; // Safety break for too deep recursion

  // Logic to simplify the XML node
  // Android nodes usually have attributes like 'text', 'resource-id', 'content-desc', 'class'
  // iOS (Maestro) might use 'label', 'identifier', 'value'

  // Abstract attributes
  const attributes = node.$ || {};
  let text = attributes.text || attributes.label || attributes.value || "";
  const resourceId = attributes["resource-id"] || attributes.identifier || "";
  const contentDesc =
    attributes["content-desc"] || attributes.accessibilityLabel || "";
  const bounds = attributes.bounds || attributes.frame || "";
  const type = attributes.class || attributes.elementType || "unknown";
  const clickable =
    attributes.clickable === "true" || attributes.enabled === "true"; // rough approx

  // Truncate long text
  if (text.length > 50) {
    text = text.substring(0, 50) + "...";
  }

  const children: SimplifiedNode[] = [];

  if (node.node) {
    for (const child of node.node) {
      const result = pruneAndSimplify(child, depth + 1);
      if (result) {
        children.push(result);
      }
    }
  }

  // Stricter Filter Logic:
  // We keep a node if:
  // 1. It is directly interactive (clickable)
  // 2. It has semantic content (text or contentDesc)
  // 3. It has attributes that might be critical for identification (resourceId) AND has children (implied structural container)
  //    OR it is a leaf with resourceId (often a specific UI element without text).
  //
  // We PRUNE if:
  // - It's just a structural container (no text/desc/resourceId) and has no relevant children.
  // - It has a resourceId but no other content and NO children (empty container?).

  const hasContent = text || contentDesc;
  const isLeaf = children.length === 0;

  // If it's a leaf, it MUST have some content or be clickable or have a resourceId to be interesting.
  if (isLeaf) {
    if (!hasContent && !clickable && !resourceId) {
      return null;
    }
  }

  // If it's a container (has children), we generally keep it if it has some identity,
  // BUT we can flatten if it adds nothing.
  // For now, let's keep it simple: if it has children, we keep it to preserve structure,
  // unless it's completely anonymous AND not clickable.
  if (!isLeaf) {
    const isAnonymous = !resourceId && !hasContent && !clickable;
    if (isAnonymous) {
      // It's an anonymous container.
      // Optimization: if it has only 1 child, we could technically skip it and return the child?
      // Let's stick to just pruning empty ones for now to avoid breaking hierarchy paths too much.
      // Actually, the previous logic "if children.length > 0 keep" is safe.
      // Let's try to be a bit more aggressive on "anonymous wrappers".
      // If a node is anonymous and not clickable, maybe we don't *need* to see it,
      // but its bounds might be relevant. Let's keep it if children exist.
    }
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
