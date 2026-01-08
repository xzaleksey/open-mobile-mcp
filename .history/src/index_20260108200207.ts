#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { installDeps, runDoctor } from "./environment/doctor.js";
import { manageBundler, streamErrors } from "./environment/metro.js";
import { deviceSwipe, deviceTap, deviceType } from "./interaction/input.js";
import { runMaestroFlow } from "./interaction/maestro.js";
import { listDevices } from "./perception/device.js";
import { getSemanticHierarchy } from "./perception/hierarchy.js";
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
    if (name === "get_viewport") {
      // @ts-ignore
      const res = await getViewport(args.deviceId, args.platform);
      return { content: [{ type: "text", text: JSON.stringify(res) }] };
    }
    if (name === "get_semantic_hierarchy") {
      // @ts-ignore
      const res = await getSemanticHierarchy(args.deviceId, args.platform);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    }
    if (name === "capture_diff") {
      // @ts-ignore
      const res = await captureDiff(args.baselineBase64, args.currentBase64);
      return { content: [{ type: "text", text: JSON.stringify(res) }] };
    }
    if (name === "device_tap") {
      // @ts-ignore
      await deviceTap(args.deviceId, args.platform, args.x, args.y);
      return { content: [{ type: "text", text: "Tap executed" }] };
    }
    if (name === "device_type") {
      // @ts-ignore
      await deviceType(args.deviceId, args.platform, args.text);
      return { content: [{ type: "text", text: "Text input executed" }] };
    }
    if (name === "device_swipe") {
      // @ts-ignore
      await deviceSwipe(
        args.deviceId,
        args.platform,
        args.x1,
        args.y1,
        args.x2,
        args.y2
      );
      return { content: [{ type: "text", text: "Swipe executed" }] };
    }
    if (name === "run_maestro_flow") {
      // @ts-ignore
      const output = await runMaestroFlow(args.deviceId, args.flowYaml);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "manage_bundler") {
      // @ts-ignore
      const output = await manageBundler(args.action, args.projectPath);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "stream_errors") {
      // @ts-ignore
      const output = streamErrors(args.tailLength);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "run_doctor") {
      // @ts-ignore
      const output = await runDoctor(args.projectPath);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "install_deps") {
      // @ts-ignore
      const output = await installDeps(args.packages, args.projectPath);
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

const transport = new StdioServerTransport();
await server.connect(transport);
