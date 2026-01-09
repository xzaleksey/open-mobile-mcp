#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { installDeps, runDoctor } from "./environment/doctor.js";
import { manageAppLifecycle } from "./environment/lifecycle.js";
import {
  getLogs,
  manageBundler,
  managePlatformLogs,
  streamErrors,
} from "./environment/metro.js";
import { deviceSwipe, deviceTap, deviceType } from "./interaction/input.js";
import { runMaestroFlow } from "./interaction/maestro.js";
import { openDeepLink } from "./interaction/navigation.js";
import { listDevices } from "./perception/device.js";
import {
  findElement,
  getElementImage,
  waitForElement,
  tapOnElement,
} from "./perception/element.js";
import { getSemanticHierarchy } from "./perception/hierarchy.js";
import { configureOcr, getScreenText } from "./perception/ocr.js";
import { captureDiff, getViewport } from "./perception/screen.js";

const server = new Server(
  {
    name: "open-mobile-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "device_list",
        description:
          "List connected active Android emulators and iOS simulators.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_viewport",
        description:
          "Capture screenshot of a device. Returns the image (resized to ~800px width for efficiency) and metadata with both resized and original dimensions. Use originalWidth/originalHeight for coordinate calculations when tapping.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
          },
          required: ["deviceId", "platform"],
        },
      },
      {
        name: "get_semantic_hierarchy",
        description: "Get pruned, semantic UI hierarchy as JSON.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
          },
          required: ["deviceId", "platform"],
        },
      },
      {
        name: "capture_diff",
        description: "Compare two base64 images and return diff percentage.",
        inputSchema: {
          type: "object",
          properties: {
            baselineBase64: { type: "string" },
            currentBase64: { type: "string" },
          },
          required: ["baselineBase64", "currentBase64"],
        },
      },
      {
        name: "tap_on_element",
        description:
          "🥇 RECOMMENDED: Tap on a UI element by selector. This is the most reliable way to tap - it finds the element and taps its center automatically. Use this instead of device_tap with raw coordinates whenever possible.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            selector: {
              type: "string",
              description: "Text, testId, or content description to find",
            },
            strategy: {
              type: "string",
              enum: ["testId", "text", "contentDescription"],
              description:
                "How to find the element: 'text' (visible text), 'testId' (accessibility ID), or 'contentDescription'",
            },
          },
          required: ["deviceId", "platform", "selector", "strategy"],
        },
      },
      {
        name: "device_tap",
        description:
          "⚠️ Low-level: Tap at raw screen coordinates. Prefer tap_on_element for reliability. Only use this when you have exact coordinates from find_element bounds or need pixel-precise tapping. Coordinates must be in original screen pixels (not the resized screenshot dimensions).",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            x: {
              type: "number",
              description: "X coordinate in original screen pixels",
            },
            y: {
              type: "number",
              description: "Y coordinate in original screen pixels",
            },
          },
          required: ["deviceId", "platform", "x", "y"],
        },
      },
      {
        name: "device_type",
        description: "Type text into the device.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            text: { type: "string" },
          },
          required: ["deviceId", "platform", "text"],
        },
      },
      {
        name: "device_swipe",
        description:
          "⚠️ Low-level: Swipe from (x1,y1) to (x2,y2). Use this for custom gestures or when you need precise swipe control.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            x1: {
              type: "number",
              description: "Start X coordinate in original screen pixels",
            },
            y1: {
              type: "number",
              description: "Start Y coordinate in original screen pixels",
            },
            x2: {
              type: "number",
              description: "End X coordinate in original screen pixels",
            },
            y2: {
              type: "number",
              description: "End Y coordinate in original screen pixels",
            },
          },
          required: ["deviceId", "platform", "x1", "y1", "x2", "y2"],
        },
      },
      {
        name: "run_maestro_flow",
        description: "Run a complex Maestro flow via YAML.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            flowYaml: { type: "string" },
          },
          required: ["deviceId", "flowYaml"],
        },
      },
      {
        name: "manage_bundler",
        description:
          "Start, stop, or restart the Metro bundler. Platform logs (Android/iOS) auto-start by default.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["start", "stop", "restart"] },
            projectPath: {
              type: "string",
              description: "Optional path to project root",
            },
            command: {
              type: "string",
              description:
                "Optional custom command (e.g. 'npm run android'). Default: 'npx expo start'",
            },
            autoStartPlatformLogs: {
              type: "boolean",
              description: "Auto-start platform log capture (default true)",
            },
          },
          required: ["action"],
        },
      },
      {
        name: "get_bundler_logs",
        description: "Get recent logs from Metro bundler, Android, or iOS.",
        inputSchema: {
          type: "object",
          properties: {
            tailLength: {
              type: "number",
              description: "Number of lines to return (default 100)",
            },
            source: {
              type: "string",
              enum: ["metro", "android", "ios", "all"],
              description:
                "Log source: 'metro', 'android', 'ios', or 'all' (default 'all')",
            },
          },
        },
      },
      {
        name: "stream_errors",
        description:
          "Get recent error logs from Metro, Android, and iOS (all sources).",
        inputSchema: {
          type: "object",
          properties: {
            tailLength: { type: "number" },
          },
        },
      },
      {
        name: "manage_platform_logs",
        description:
          "Manually start/stop platform log capture (optional - auto-starts with bundler).",
        inputSchema: {
          type: "object",
          properties: {
            platform: {
              type: "string",
              enum: ["android", "ios"],
              description: "Platform to capture logs from",
            },
            action: {
              type: "string",
              enum: ["start", "stop"],
              description: "Start or stop log capture",
            },
            projectPath: {
              type: "string",
              description: "Optional path to project root",
            },
          },
          required: ["platform", "action"],
        },
      },
      {
        name: "run_doctor",
        description: "Run npx expo-doctor.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: { type: "string" },
          },
        },
      },
      {
        name: "install_deps",
        description: "Install dependencies using npx expo install.",
        inputSchema: {
          type: "object",
          properties: {
            packages: { type: "array", items: { type: "string" } },
            projectPath: { type: "string" },
          },
          required: ["packages"],
        },
      },

      {
        name: "manage_app_lifecycle",
        description: "Launch, stop, install, or uninstall apps.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["launch", "stop", "install", "uninstall"],
            },
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            target: {
              type: "string",
              description: "Package ID/Bundle ID or file path",
            },
          },
          required: ["action", "deviceId", "platform", "target"],
        },
      },
      {
        name: "open_deep_link",
        description: "Open a deep link or URL on the device.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            url: { type: "string" },
          },
          required: ["deviceId", "platform", "url"],
        },
      },
      {
        name: "get_screen_text",
        description: "Get all text visible on screen using OCR.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            language: {
              type: "string",
              description:
                "OCR language code (e.g. 'eng', 'fra', 'deu'). Default: 'eng'",
            },
          },
          required: ["deviceId", "platform"],
        },
      },
      {
        name: "configure_ocr",
        description: "Set the default OCR language for the session.",
        inputSchema: {
          type: "object",
          properties: {
            language: {
              type: "string",
              description: "Language code(s), e.g., 'eng', 'eng+fra', 'jpa'.",
            },
          },
          required: ["language"],
        },
      },
      {
        name: "find_element",
        description:
          "Find UI elements by selector. Returns elements with pre-parsed coordinates (centerX, centerY, left, top, right, bottom, width, height) ready for use. For tapping, prefer tap_on_element which does find+tap in one step.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            selector: { type: "string" },
            strategy: {
              type: "string",
              enum: ["testId", "text", "contentDescription"],
            },
          },
          required: ["deviceId", "platform", "selector", "strategy"],
        },
      },
      {
        name: "wait_for_element",
        description: "Wait for a UI element to appear (polls every 1s).",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            selector: { type: "string" },
            strategy: {
              type: "string",
              enum: ["testId", "text", "contentDescription"],
            },
            timeout: {
              type: "number",
              description: "Timeout in ms (default 10000)",
            },
          },
          required: ["deviceId", "platform", "selector", "strategy"],
        },
      },
      {
        name: "get_element_image",
        description: "Get a cropped screenshot of a specific UI element.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            selector: { type: "string" },
            strategy: {
              type: "string",
              enum: ["testId", "text", "contentDescription"],
            },
          },
          required: ["deviceId", "platform", "selector", "strategy"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "device_list") {
      const devices = await listDevices();
      return {
        content: [{ type: "text", text: JSON.stringify(devices, null, 2) }],
      };
    }

    const safeArgs = (args as any) || {};

    if (name === "get_viewport") {
      const res = await getViewport(safeArgs.deviceId, safeArgs.platform);
      return {
        content: [
          {
            type: "image",
            data: res.imageBase64,
            mimeType: "image/jpeg",
          },
          {
            type: "text",
            text: JSON.stringify({
              width: res.width,
              height: res.height,
              originalWidth: res.originalWidth,
              originalHeight: res.originalHeight,
            }),
          },
        ],
      };
    }
    if (name === "get_semantic_hierarchy") {
      const res = await getSemanticHierarchy(
        safeArgs.deviceId,
        safeArgs.platform
      );
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    }
    if (name === "capture_diff") {
      const res = await captureDiff(
        safeArgs.baselineBase64,
        safeArgs.currentBase64
      );
      return { content: [{ type: "text", text: JSON.stringify(res) }] };
    }
    if (name === "device_tap") {
      await deviceTap(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.x,
        safeArgs.y
      );
      return { content: [{ type: "text", text: "Tap executed" }] };
    }
    if (name === "device_type") {
      await deviceType(safeArgs.deviceId, safeArgs.platform, safeArgs.text);
      return { content: [{ type: "text", text: "Text input executed" }] };
    }
    if (name === "device_swipe") {
      await deviceSwipe(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.x1,
        safeArgs.y1,
        safeArgs.x2,
        safeArgs.y2
      );
      return { content: [{ type: "text", text: "Swipe executed" }] };
    }
    if (name === "run_maestro_flow") {
      const output = await runMaestroFlow(safeArgs.deviceId, safeArgs.flowYaml);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "manage_bundler") {
      const output = await manageBundler(
        safeArgs.action,
        safeArgs.projectPath,
        safeArgs.command,
        safeArgs.autoStartPlatformLogs
      );
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "stream_errors") {
      const output = streamErrors(safeArgs.tailLength);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "get_bundler_logs") {
      const output = getLogs(safeArgs.tailLength, safeArgs.source);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "run_doctor") {
      const output = await runDoctor(safeArgs.projectPath);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "manage_platform_logs") {
      const output = await managePlatformLogs(
        safeArgs.platform,
        safeArgs.action,
        safeArgs.projectPath
      );
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "install_deps") {
      const output = await installDeps(safeArgs.packages, safeArgs.projectPath);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "manage_app_lifecycle") {
      const output = await manageAppLifecycle(
        safeArgs.action,
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.target
      );
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "open_deep_link") {
      const output = await openDeepLink(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.url
      );
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "get_screen_text") {
      const output = await getScreenText(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.language
      );
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "configure_ocr") {
      const output = configureOcr(safeArgs.language);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "find_element") {
      const output = await findElement(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.selector,
        safeArgs.strategy
      );
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    }
    if (name === "tap_on_element") {
      const output = await tapOnElement(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.selector,
        safeArgs.strategy
      );
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    }
    if (name === "wait_for_element") {
      const output = await waitForElement(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.selector,
        safeArgs.strategy,
        safeArgs.timeout
      );
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "get_element_image") {
      const output = await getElementImage(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.selector,
        safeArgs.strategy
      );
      return {
        content: [
          {
            type: "image",
            data: output,
            mimeType: "image/png",
          },
        ],
      };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }

  throw new Error(`Tool ${name} not found`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
