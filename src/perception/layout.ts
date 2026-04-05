import { getSemanticHierarchy } from "./hierarchy.js";

export interface LayoutIssue {
  type: "nesting" | "overdraw" | "off-screen" | "large-element";
  severity: "info" | "warning" | "error";
  description: string;
  elementId?: string;
  bounds?: string;
}

export interface LayoutHealthReport {
  score: number; // 0-100
  issues: LayoutIssue[];
  metrics: {
    totalElements: number;
    maxDepth: number;
    averageDepth: number;
  };
}

export async function analyzeLayoutHealth(
  deviceId: string,
  platform: "android" | "ios"
): Promise<LayoutHealthReport> {
  // Use the semantic hierarchy tool
  const hierarchy = await getSemanticHierarchy(deviceId, platform);
  const issues: LayoutIssue[] = [];
  let totalDepth = 0;
  let maxDepth = 0;
  let elementCount = 0;

  function traverse(node: any, depth: number) {
    elementCount++;
    totalDepth += depth;
    if (depth > maxDepth) maxDepth = depth;

    // Check depth
    if (depth > 15) {
      issues.push({
        type: "nesting",
        severity: "warning",
        description: `High nesting depth (${depth}). Consider flattening the layout.`,
        elementId: node.testId || node.text || node.resourceId,
        bounds: node.bounds,
      });
    }

    // Recursively traverse children
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child, depth + 1);
      }
    }
  }

  // Root node is the hierarchy object itself
  if (hierarchy) {
    traverse(hierarchy, 0);
  }

  // Scoring logic (simple example)
  let score = 100;
  score -= (maxDepth > 15 ? (maxDepth - 15) * 5 : 0);
  score -= issues.length * 2;
  score = Math.max(0, score);

  return {
    score,
    issues,
    metrics: {
      totalElements: elementCount,
      maxDepth,
      averageDepth: elementCount > 0 ? totalDepth / elementCount : 0,
    },
  };
}
