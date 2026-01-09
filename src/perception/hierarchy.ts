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
  // Use maestro hierarchy which outputs JSON for iOS
  try {
    const { stdout } = await execAsync(
      `maestro --device ${deviceId} hierarchy`
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
  enabled?: boolean;
  focused?: boolean;
  selected?: boolean;
}

/**
 * Maestro iOS TreeNode structure from JSON output:
 * {
 *   attributes: { [key: string]: string },
 *   children: TreeNode[],
 *   clickable?: boolean,
 *   enabled?: boolean,
 *   focused?: boolean,
 *   checked?: boolean,
 *   selected?: boolean
 * }
 *
 * Common attributes from iOS:
 * - accessibilityText (label)
 * - title
 * - value
 * - text
 * - hintText (placeholder)
 * - resource-id (identifier)
 * - bounds (format: "[left,top][right,bottom]")
 * - enabled, focused, selected, checked
 */
interface MaestroTreeNode {
  attributes?: { [key: string]: string };
  children?: MaestroTreeNode[];
  clickable?: boolean;
  enabled?: boolean;
  focused?: boolean;
  checked?: boolean;
  selected?: boolean;
}

function pruneAndSimplifyMaestroNode(
  node: MaestroTreeNode,
  depth: number = 0
): SimplifiedNode | null {
  const attributes = node.attributes || {};

  // Extract text from various iOS/Maestro attributes
  let text =
    attributes.text ||
    attributes.accessibilityText ||
    attributes.title ||
    attributes.value ||
    "";
  const resourceId = attributes["resource-id"] || "";
  const contentDesc = attributes.accessibilityText || attributes.hintText || "";
  const bounds = attributes.bounds || "";

  // Type is not directly provided in Maestro output, use a generic type or derive from attributes
  const type = "UIElement";

  const clickable = node.clickable === true;
  const enabled = node.enabled === true;
  const focused = node.focused === true;
  const selected = node.selected === true;

  // Truncate long text
  if (text.length > 50) {
    text = text.substring(0, 50) + "...";
  }

  const children: SimplifiedNode[] = [];

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const result = pruneAndSimplifyMaestroNode(child, depth + 1);
      if (result) {
        children.push(result);
      }
    }
  }

  const hasContent = text || contentDesc;
  const isLeaf = children.length === 0;

  // Flattening Rule:
  // If this node is a generic container (no ID, no Text, no Desc) AND has exactly ONE child,
  // we can skip this node and return the child directly.
  if (!isLeaf && children.length === 1) {
    const isGeneric = !resourceId && !hasContent;
    const child = children[0];

    if (isGeneric) {
      if (
        !clickable ||
        (clickable &&
          (child.clickable ||
            child.type.includes("Button") ||
            child.type.includes("Text")))
      ) {
        return child;
      }
    }
  }

  // Pruning Rule:
  // If it's a leaf, it MUST have some content or be clickable or have a resourceId to be interesting.
  if (isLeaf) {
    if (!hasContent && !clickable && !resourceId) {
      return null;
    }
  }

  const simpleNode: SimplifiedNode = {
    type,
    ...(text ? { text } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(contentDesc ? { contentDesc } : {}),
    ...(bounds ? { bounds } : {}),
    ...(clickable ? { clickable } : {}),
    ...(enabled ? { enabled } : {}),
    ...(focused ? { focused } : {}),
    ...(selected ? { selected } : {}),
  };

  if (children.length > 0) {
    simpleNode.children = children;
  }

  return simpleNode;
}

function pruneAndSimplifyAndroidNode(
  node: any,
  depth: number = 0
): SimplifiedNode | null {
  // Logic to simplify the XML node
  // Android nodes usually have attributes like 'text', 'resource-id', 'content-desc', 'class'

  const attributes = node.$ || {};
  let text = attributes.text || "";
  const resourceId = attributes["resource-id"] || "";
  const contentDesc = attributes["content-desc"] || "";
  const bounds = attributes.bounds || "";
  const type = attributes.class || "unknown";
  const clickable = attributes.clickable === "true";
  const enabled = attributes.enabled === "true";
  const focused = attributes.focused === "true";
  const selected = attributes.selected === "true";

  // Truncate long text
  if (text.length > 50) {
    text = text.substring(0, 50) + "...";
  }

  const children: SimplifiedNode[] = [];

  if (node.node) {
    for (const child of node.node) {
      const result = pruneAndSimplifyAndroidNode(child, depth + 1);
      if (result) {
        children.push(result);
      }
    }
  }

  const hasContent = text || contentDesc;
  const isLeaf = children.length === 0;

  // Flattening Rule:
  // If this node is a generic container (no ID, no Text, no Desc) AND has exactly ONE child,
  // we can skip this node and return the child directly.
  if (!isLeaf && children.length === 1) {
    const isGeneric = !resourceId && !hasContent;
    const child = children[0];

    if (isGeneric) {
      if (
        !clickable ||
        (clickable &&
          (child.clickable ||
            child.type.includes("Button") ||
            child.type.includes("Text")))
      ) {
        return child;
      }
    }
  }

  // Pruning Rule:
  // If it's a leaf, it MUST have some content or be clickable or have a resourceId to be interesting.
  if (isLeaf) {
    if (!hasContent && !clickable && !resourceId) {
      return null;
    }
  }

  const simpleNode: SimplifiedNode = {
    type,
    ...(text ? { text } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(contentDesc ? { contentDesc } : {}),
    ...(bounds ? { bounds } : {}),
    ...(clickable ? { clickable } : {}),
    ...(enabled ? { enabled } : {}),
    ...(focused ? { focused } : {}),
    ...(selected ? { selected } : {}),
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
  if (platform === "android") {
    const xml = await getAndroidHierarchy(deviceId);
    const result = await xml2js.parseStringPromise(xml);
    // Android: root is 'hierarchy' -> 'node'
    const rootNode = result.hierarchy?.node?.[0] || result.hierarchy || result;
    return pruneAndSimplifyAndroidNode(rootNode);
  } else {
    // iOS: Maestro outputs JSON (sometimes with a prefix line like "None: ")
    const rawOutput = await getIosHierarchy(deviceId);

    // Strip any prefix before the JSON object starts
    // Maestro may output "None: " or similar prefix before the JSON
    const jsonStartIndex = rawOutput.indexOf("{");
    if (jsonStartIndex === -1) {
      throw new Error(
        `No JSON found in Maestro hierarchy output: ${rawOutput.substring(
          0,
          200
        )}`
      );
    }
    const jsonString = rawOutput.substring(jsonStartIndex);

    // Parse the JSON output from Maestro
    let parsedJson: MaestroTreeNode;
    try {
      parsedJson = JSON.parse(jsonString);
    } catch (parseError) {
      throw new Error(
        `Failed to parse iOS hierarchy JSON: ${
          (parseError as Error).message
        }. Raw: ${jsonString.substring(0, 200)}`
      );
    }

    return pruneAndSimplifyMaestroNode(parsedJson);
  }
}
