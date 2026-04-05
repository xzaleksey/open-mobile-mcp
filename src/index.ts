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
  getNetworkLogs,
  manageBundler,
  managePlatformLogs,
  streamErrors,
  waitForLog,
} from "./environment/metro.js";
import { clearAppData, devicePinch, devicePressKey, deviceRotateGesture, deviceSwipe, deviceTap, deviceType, getAppInfo } from "./interaction/input.js";
import { runMaestroFlow } from "./interaction/maestro.js";
import { setSystemLocale } from "./interaction/navigation.js";
import { openDeepLink } from "./interaction/navigation.js";
import { listDevices } from "./perception/device.js";
import {
  findElement,
  getElementImage,
  waitForElement,
  tapOnElement,
} from "./perception/element.js";
import { analyzeLayoutHealth } from "./perception/layout.js";
import { getSemanticHierarchy } from "./perception/hierarchy.js";
import { configureOcr, getScreenText } from "./perception/ocr.js";
import { captureDiff, getViewport, startRecording, stopRecording } from "./perception/screen.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
          "Capture screenshot of a device. Returns the image (resized to ~800px width for efficiency) and metadata with both resized and original dimensions. Use originalWidth/originalHeight for coordinate calculations when tapping. For Android, if logicalWidth/Height are provided, they represent the UI coordinate system which may differ from the physical screenshot pixels.",
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
          "🥇 RECOMMENDED: Tap on a UI element by selector. Finds the element and taps its center automatically. Prefer over device_tap. If observing a log triggered by this tap, spawn the wait_for_log subagent BEFORE tapping. NOTE: text matching is exact — if an element renders with an emoji prefix (e.g. '🇫🇷 French A2'), passing 'French A2' will fail. Use get_semantic_hierarchy first to see the exact text, or use contentDescription/testId strategy instead.",
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
            duration: {
              type: "number",
              description: "Optional duration in ms. If > 0, performs a long press.",
            },
          },
          required: ["deviceId", "platform", "selector", "strategy"],
        },
      },
      {
        name: "device_tap",
        description:
          "⚠️ Low-level: Tap at raw screen coordinates. Prefer tap_on_element for reliability. Use coordinates from the physical screenshot (originalWidth/originalHeight). On Android, this tool automatically scales coordinates if a display override (logical resolution) is detected.",
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
            duration: {
              type: "number",
              description: "Optional duration in ms. If > 0, performs a long press.",
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
          "⚠️ Low-level: Swipe from (x1,y1) to (x2,y2). Use this for custom gestures or when you need precise swipe control. Use coordinates from the physical screenshot (originalWidth/originalHeight). On Android, this tool automatically scales coordinates if a display override (logical resolution) is detected.",
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
            duration: {
              type: "number",
              description: "Optional duration in ms. Default is 300.",
            },
          },
          required: ["deviceId", "platform", "x1", "y1", "x2", "y2"],
        },
      },
      {
        name: "analyze_layout_health",
        description: "Analyze the UI layout for performance or health issues (e.g. deep nesting).",
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
        name: "device_pinch",
        description:
          "Perform a pinch gesture (two-finger zoom) on the device. Use 'out' to zoom in (fingers spread apart) and 'in' to zoom out (fingers come together). Works on real Android phones (no root needed) via UIAutomation MotionEvent injection.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            centerX: {
              type: "number",
              description: "X coordinate of the pinch center in original screen pixels",
            },
            centerY: {
              type: "number",
              description: "Y coordinate of the pinch center in original screen pixels",
            },
            direction: {
              type: "string",
              enum: ["in", "out"],
              description: "'out' = zoom in (spread fingers apart), 'in' = zoom out (fingers come together)",
            },
            spread: {
              type: "number",
              description: "Max distance in logical pixels each finger travels from center (default 200)",
            },
            duration: {
              type: "number",
              description: "Gesture duration in ms (default 500)",
            },
          },
          required: ["deviceId", "platform", "centerX", "centerY", "direction"],
        },
      },
      {
        name: "device_press_key",
        description:
          "Press a hardware or system key. Also accepts raw Android keycodes as numbers.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            key: {
              type: "string",
              enum: [
                "back", "home", "recents", "enter", "delete", "backspace",
                "volume_up", "volume_down", "volume_mute", "power",
                "escape", "tab", "search", "space", "camera", "call", "endcall",
                "menu", "notification", "dpad_up", "dpad_down", "dpad_left", "dpad_right", "dpad_center"
              ],
              description: "Key name or raw Android keycode number",
            },
          },
          required: ["deviceId", "platform", "key"],
        },
      },
      {
        name: "device_rotate_gesture",
        description:
          "Perform a two-finger rotation gesture (e.g. to rotate a map or image). Positive degrees = clockwise. Android only (uses UIAutomation, no root needed).",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            centerX: { type: "number", description: "X center of rotation in screen pixels" },
            centerY: { type: "number", description: "Y center of rotation in screen pixels" },
            degrees: { type: "number", description: "Degrees to rotate. Positive = clockwise." },
            radius: { type: "number", description: "Distance of each finger from center in pixels (default 120)" },
            duration: { type: "number", description: "Gesture duration in ms (default 500)" },
          },
          required: ["deviceId", "platform", "centerX", "centerY", "degrees"],
        },
      },
      {
        name: "clear_app_data",
        description: "Clear all data and cache for an app (equivalent to Settings → App → Clear Data). Resets the app to a fresh-install state. Useful for testing onboarding or reproducing first-launch bugs.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            packageId: { type: "string", description: "Android package ID or iOS bundle ID (e.g. 'com.example.app')" },
          },
          required: ["deviceId", "platform", "packageId"],
        },
      },
      {
        name: "get_app_info",
        description: "Get version, install date, SDK target, data directory, and granted/denied permissions for an installed app. Android only.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            packageId: { type: "string", description: "Android package ID (e.g. 'com.google.android.apps.maps')" },
          },
          required: ["deviceId", "platform", "packageId"],
        },
      },
      {
        name: "set_system_locale",
        description: "Set the system locale for the device (Android or iOS Simulator).",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            locale: { type: "string", description: "Locale tag, e.g. 'en-US', 'fr-FR'" },
          },
          required: ["deviceId", "platform", "locale"],
        },
      },
      {
        name: "start_recording",
        description: "Start screen recording on the device. Use an absolute path for localPath when stopping to ensure you can find the file.",
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
        name: "stop_recording",
        description: "Stop screen recording and save the file. Use an absolute path for localPath to ensure you can find the file.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            platform: { type: "string", enum: ["android", "ios"] },
            localPath: { type: "string", description: "Local destination path for the .mp4 file (e.g. C:\\Users\\...\\recording.mp4)" },
          },
          required: ["deviceId", "platform", "localPath"],
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
          "Start, stop, or restart the Metro bundler. Platform logs (Android/iOS) auto-start by default. On Android, pass both deviceId and packageId to enable PID-based log filtering — this captures only your app's logs and eliminates all system/GMS noise.",
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
                "Optional custom command. Default: 'npx expo start'. To target a specific device use 'npx expo run:android --device <deviceId>' or 'npx expo run:ios --device <deviceId>'.",
            },
            autoStartPlatformLogs: {
              type: "boolean",
              description: "Auto-start platform log capture (default true)",
            },
            showTerminal: {
              type: "boolean",
              description: "Open the bundler in a new terminal window (default true)",
            },
            deviceId: {
              type: "string",
              description: "Device/emulator ID (from device_list). Pass with packageId to enable PID-based Android log filtering that eliminates system noise.",
            },
            packageId: {
              type: "string",
              description: "Package ID of the app (e.g. 'com.example.app'). Pass with deviceId on Android for precise per-app log filtering.",
            },
            logFilter: {
              type: "string",
              description: "Optional raw log filter (adb logcat tags on Android, predicate on iOS)",
            },
          },
          required: ["action"],
        },
      },
      {
        name: "get_network_logs",
        description: "Pull network-related logs from the device using adb logcat. For Expo / React Native apps, all console.log output (including fetchApi network traces) is emitted under the 'ReactNativeJS' logcat tag — use filter 'ReactNativeJS' or leave default. For native Android HTTP clients use 'OkHttp'. Note: a recurring warning 'ReconnectingWebSocket: Couldn't connect to ws://<host>:8081/inspector/network' is harmless — it means Metro bundler's DevTools WebSocket is not reachable from the device (Metro not running or port 8081 blocked). The app still works; start Metro via 'npx expo start' or 'npx react-native start' on the same network to silence it.",
        inputSchema: {
          type: "object",
          properties: {
            deviceId: { type: "string" },
            filter: { type: "string", description: "Regex matched against logcat lines (case-insensitive). Expo/RN: 'ReactNativeJS' (all console.log including fetchApi traces). Native Android: 'OkHttp', 'Volley', 'CRONET'. Default: 'ReactNativeJS|OkHttp|Volley|CRONET'" },
            tailLength: { type: "number", description: "Number of raw logcat lines to scan before filtering (default 1000). Increase if recent logs have rolled out of the buffer." },
          },
          required: ["deviceId"],
        },
      },
      {
        name: "get_bundler_logs",
        description: "Get recent logs from Metro bundler, Android, or iOS. To wait for a specific line, use wait_for_log in a background subagent instead of polling.",
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
        name: "wait_for_log",
        description:
          "Block until a log line matching a pattern appears, or timeout. Returns {matched, line, elapsed}.\n\nALWAYS use via background subagent — never call directly or it blocks the whole conversation:\n  1. Spawn background subagent: 'Call wait_for_log(pattern, timeout). Report result.'\n  2. Then perform the action (tap/navigate) in the main agent\n  3. Main agent continues; subagent notifies when pattern matched\n\nSpawn subagent BEFORE the action that triggers the log, not after.",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Regex pattern to match against log lines (case-insensitive)",
            },
            timeout: {
              type: "number",
              description: "Max wait time in ms (default 60000). Use at least 60000 to account for subagent startup overhead.",
            },
            source: {
              type: "string",
              enum: ["metro", "android", "ios", "all"],
              description: "Which log buffer to watch (default 'all')",
            },
          },
          required: ["pattern"],
        },
      },
      {
        name: "stream_errors",
        description:
          "Get recent error logs from Metro, Android, and iOS. To wait for a specific error, use wait_for_log(pattern: 'error|exception') in a background subagent instead of polling.",
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
          "Manually start/stop platform log capture (optional - auto-starts with bundler). On Android, pass both deviceId and packageId to enable PID-based filtering — this captures only your app's logs and eliminates all system/GMS noise. Without packageId, falls back to ReactNative/AndroidRuntime tag filtering which may include unrelated system warnings.",
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
            deviceId: {
              type: "string",
              description: "Device/emulator ID (from device_list). Required for per-app PID filtering on Android.",
            },
            projectPath: {
              type: "string",
              description: "Optional path to project root",
            },
            showTerminal: {
              type: "boolean",
              description: "Open the logs in a new terminal window (default true)",
            },
            packageId: {
              type: "string",
              description: "Package ID to filter logs (e.g. 'com.example.app'). On Android, used with deviceId for precise PID-based filtering that eliminates system noise.",
            },
            logFilter: {
              type: "string",
              description: "Optional raw log filter (adb logcat tags on Android, predicate on iOS)",
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
              description: "Timeout in ms (default 20000)",
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
      const scaleX = res.originalWidth / res.width;
      const scaleY = res.originalHeight / res.height;
      return {
        content: [
          {
            type: "image",
            data: res.imageBase64,
            mimeType: "image/jpeg",
          },
          {
            type: "text",
            text: [
              `⚠️ TAP COORDINATES: use originalWidth x originalHeight (${res.originalWidth}x${res.originalHeight}), NOT the image size (${res.width}x${res.height}).`,
              `Image is scaled down by ${scaleX.toFixed(3)}x/${scaleY.toFixed(3)}y. Multiply any image pixel coordinate by this factor before tapping.`,
              `tap_coords: { x: imageX * ${scaleX.toFixed(3)}, y: imageY * ${scaleY.toFixed(3)} }`,
              "",
              JSON.stringify({
                imageWidth: res.width,
                imageHeight: res.height,
                originalWidth: res.originalWidth,
                originalHeight: res.originalHeight,
                scaleX,
                scaleY,
                ...(res.logicalWidth ? { logicalWidth: res.logicalWidth, logicalHeight: res.logicalHeight } : {}),
              }),
            ].join("\n"),
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
        safeArgs.y,
        false, // isLogical defaults to false for low-level tool
        safeArgs.duration || 0
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
        safeArgs.y2,
        false, // isLogical defaults to false for low-level tool
        safeArgs.duration || 300
      );
      return { content: [{ type: "text", text: "Swipe executed" }] };
    }
    if (name === "device_pinch") {
      await devicePinch(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.centerX,
        safeArgs.centerY,
        safeArgs.direction,
        safeArgs.spread || 200,
        safeArgs.duration || 500,
        false
      );
      return { content: [{ type: "text", text: "Pinch executed" }] };
    }
    if (name === "device_press_key") {
      await devicePressKey(safeArgs.deviceId, safeArgs.platform, safeArgs.key);
      return { content: [{ type: "text", text: `Key '${safeArgs.key}' pressed` }] };
    }
    if (name === "device_rotate_gesture") {
      await deviceRotateGesture(
        safeArgs.deviceId, safeArgs.platform,
        safeArgs.centerX, safeArgs.centerY, safeArgs.degrees,
        safeArgs.radius ?? 120, safeArgs.duration ?? 500
      );
      return { content: [{ type: "text", text: "Rotate gesture executed" }] };
    }
    if (name === "clear_app_data") {
      const output = await clearAppData(safeArgs.deviceId, safeArgs.platform, safeArgs.packageId);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "get_app_info") {
      const info = await getAppInfo(safeArgs.deviceId, safeArgs.platform, safeArgs.packageId);
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
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
        safeArgs.autoStartPlatformLogs,
        safeArgs.showTerminal,
        safeArgs.packageId,
        safeArgs.logFilter,
        safeArgs.deviceId
      );
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "get_network_logs") {
      const output = await getNetworkLogs(
        safeArgs.deviceId,
        safeArgs.filter,
        safeArgs.tailLength
      );
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "analyze_layout_health") {
      const report = await analyzeLayoutHealth(
        safeArgs.deviceId,
        safeArgs.platform
      );
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }
    if (name === "wait_for_log") {
      const result = await waitForLog(
        safeArgs.pattern,
        safeArgs.timeout,
        safeArgs.source
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
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
        safeArgs.projectPath,
        safeArgs.showTerminal,
        safeArgs.packageId,
        safeArgs.logFilter,
        safeArgs.deviceId
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
      const result = await tapOnElement(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.selector,
        safeArgs.strategy,
        safeArgs.duration || 0
      );
      return { content: [{ type: "text", text: result.message }] };
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
    if (name === "set_system_locale") {
      const output = await setSystemLocale(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.locale
      );
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "start_recording") {
      const output = await startRecording(safeArgs.deviceId, safeArgs.platform);
      return { content: [{ type: "text", text: output }] };
    }
    if (name === "stop_recording") {
      const output = await stopRecording(
        safeArgs.deviceId,
        safeArgs.platform,
        safeArgs.localPath
      );
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
