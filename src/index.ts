#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { installDeps, runDoctor } from "./environment/doctor.js";
import { manageAppLifecycle } from "./environment/lifecycle.js";
import { manageBundler, streamErrors } from "./environment/metro.js";
import { deviceSwipe, deviceTap, deviceType } from "./interaction/input.js";
import { runMaestroFlow } from "./interaction/maestro.js";
import { openDeepLink } from "./interaction/navigation.js";
import { listDevices } from "./perception/device.js";
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
          "Capture screenshot of a device, resized to ~1024px width.",
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
        name: "device_tap",
        description: "Tap at coordinates (Android) or via flow (iOS).",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            x: { type: "number" },
            y: { type: "number" },
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
        description: "Swipe on the device.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            x1: { type: "number" },
            y1: { type: "number" },
            x2: { type: "number" },
            y2: { type: "number" },
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
        description: "Start, stop, or restart the Metro bundler.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["start", "stop", "restart"] },
            projectPath: {
              type: "string",
              description: "Optional path to project root",
            },
          },
          required: ["action"],
        },
      },
      {
        name: "stream_errors",
        description: "Get recent error logs from the bundler.",
        inputSchema: {
          type: "object",
          properties: {
            tailLength: { type: "number" },
          },
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
      return { content: [{ type: "text", text: JSON.stringify(res) }] };
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
      const output = await manageBundler(safeArgs.action, safeArgs.projectPath);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "stream_errors") {
      const output = streamErrors(safeArgs.tailLength);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "run_doctor") {
      const output = await runDoctor(safeArgs.projectPath);
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
