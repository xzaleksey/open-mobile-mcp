# Open Mobile MCP Server 📱

An open-source **Model Context Protocol (MCP)** server for mobile automation. It provides LLMs (like Claude, Gemini) with the ability to view, control, and test Android and iOS devices.

> **Key Feature**: Robust Unicode support (Cyrillic, CJK, Emoji) via auto-switching to `ADB Keyboard` or falling back to `Maestro`.

## Features

- **Perception**: Optimized screenshots (`get_viewport`) and semantic hierarchy (`get_semantic_hierarchy`) with ~65% token reduction.
- **Interaction**: Tap, swipe, type, pinch, rotate, long-press, and hardware key presses.
- **Text Input**: International character support. Auto-detects and uses [ADB Keyboard](https://github.com/senzhk/ADBKeyBoard) for non-ASCII input, restores original keyboard automatically.
- **Logging**: PID-based Android log filtering (pass `deviceId` + `packageId` to eliminate system noise). Background log watching via `wait_for_log`.
- **Environment**: Manage Metro bundler, platform logs, app lifecycle, deep links, screen recording.

## Prerequisites

1. **Node.js** (v18+)
2. **ADB** (Android Debug Bridge) installed and in PATH.
3. **Maestro** (recommended for iOS and fallback Android input).

   - **Mac/Linux**: `curl -Ls "https://get.maestro.mobile.dev" | bash`
   - **Windows**:
     ```powershell
     powershell -Command "iwr -useb https://get.maestro.mobile.dev | iex"
     ```

4. **(Recommended) ADB Keyboard**: Required only for non-ASCII characters (Unicode, Cyrillic, Emoji).
   - Download from [GitHub](https://github.com/senzhk/ADBKeyBoard).
   - Install: `adb install ADBKeyboard.apk`.

## Installation

```bash
git clone https://github.com/xzaleksey/open-mobile-mcp.git
cd open-mobile-mcp
npm install
npm run build
```

## Configuration

**macOS / Linux**
```json
{
  "mcpServers": {
    "open-mobile-mcp": {
      "command": "node",
      "args": ["/path/to/open-mobile-mcp/build/index.js"]
    }
  }
}
```

**Windows**
```json
{
  "mcpServers": {
    "open-mobile-mcp": {
      "command": "node",
      "args": ["C:\\path\\to\\open-mobile-mcp\\build\\index.js"],
      "env": {
        "MAESTRO_HOME": "C:\\Users\\YOUR_USER\\.maestro",
        "PATH": "C:\\Users\\YOUR_USER\\.maestro\\maestro\\bin;C:\\Windows\\system32;C:\\Windows;..."
      }
    }
  }
}
```

> **Note**: On Windows, explicitly setting `MAESTRO_HOME` and `PATH` is often required for `maestro` to be found. On macOS/Linux this is usually not needed if Maestro was installed via the official script.

## Tools

### Perception
| Tool | Description |
|------|-------------|
| `device_list` | List connected Android emulators and iOS simulators |
| `get_viewport` | Screenshot (~800px wide). **Use `originalWidth`/`originalHeight` for tap coordinates** — the image is scaled down, tapping at image pixels will miss. |
| `get_semantic_hierarchy` | Token-optimized UI tree |
| `get_screen_text` | OCR via Tesseract.js (default `eng`) |
| `configure_ocr` | Set default OCR language (e.g. `eng+fra`) |
| `find_element` | Find elements by `testId`, `text`, or `contentDescription` |
| `wait_for_element` | Poll until element appears (default 20s timeout) |
| `get_element_image` | Cropped screenshot of a specific element |
| `capture_diff` | Compare two base64 images, returns diff % |
| `analyze_layout_health` | Detect deep nesting and layout performance issues |

### Interaction
| Tool | Description |
|------|-------------|
| `tap_on_element` | **Recommended** — find + tap by selector. Note: text matching is exact; emoji prefixes (e.g. `🇫🇷 French A2`) will break text matching — use `get_semantic_hierarchy` to see exact text or use `testId` strategy. |
| `device_tap` | Raw coordinate tap. Coordinates must be in original device pixels, not image pixels. |
| `device_swipe` | Swipe gesture by coordinates |
| `device_type` | Type text (handles Unicode) |
| `device_pinch` | Two-finger pinch/zoom |
| `device_press_key` | Hardware keys: `back`, `home`, `recents`, `enter`, `delete`, `volume_up`, `volume_down`, `power`, `tab`, `search`, `space`, `menu`, `dpad_*`, and more. Also accepts raw Android keycodes. |
| `device_rotate_gesture` | Two-finger rotation (Android only) |

### Environment & Logs
| Tool | Description |
|------|-------------|
| `manage_bundler` | Start/stop/restart Metro bundler. Pass `deviceId` + `packageId` on Android for PID-based log filtering (eliminates system noise). |
| `manage_platform_logs` | Manual control over `adb logcat` / `xcrun` log capture. Pass `deviceId` + `packageId` for per-app PID filtering. |
| `get_bundler_logs` | Recent logs from Metro/Android/iOS. Returns `[status]` line showing whether capture is active — if empty, capture may not be running. |
| `stream_errors` | Recent error/exception lines across all sources |
| `get_network_logs` | Network-related logcat lines. Expo/RN: use filter `ReactNativeJS`. Native: `OkHttp`. |
| `wait_for_log` | Block until a log pattern appears. **Always call from a background subagent** — calling directly blocks the conversation. Spawn subagent *before* the action that triggers the log. |
| `manage_app_lifecycle` | Launch, stop, install, or uninstall apps |
| `open_deep_link` | Open a URL or deep link on device |
| `clear_app_data` | Reset app to fresh-install state |
| `get_app_info` | Version, permissions, install date (Android) |
| `set_system_locale` | Set device locale (e.g. `fr-FR`) |
| `start_recording` / `stop_recording` | Screen recording (Android) |
| `run_maestro_flow` | Run a Maestro YAML flow |
| `run_doctor` | Run `npx expo-doctor` |
| `install_deps` | Run `npx expo install <packages>` |

### wait_for_log — Subagent Pattern

```
// 1. Spawn background subagent FIRST (before the action)
Agent(background): call wait_for_log(pattern: "route: /home", timeout: 60000)

// 2. Perform the action in the main agent
tap_on_element(...)

// 3. Main agent continues; gets notified when subagent completes
```

## License

MIT
