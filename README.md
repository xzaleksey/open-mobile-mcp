# Open Mobile MCP Server 📱

An open-source **Model Context Protocol (MCP)** server for mobile automation. Give any LLM eyes and hands on a real Android or iOS device — screenshot, tap, swipe, read logs, and verify your app without writing test code.

Works with **Claude Code**, **Claude Desktop**, **Cursor**, and any other MCP-compatible client.

## Features

- **Perception**: Screenshots, semantic UI hierarchy, OCR, element finder, layout health analysis.
- **Interaction**: Tap, swipe, type, pinch, rotate, long-press, hardware key presses.
- **Logging**: Per-app Android log filtering via PID (pass `deviceId` + `packageId` to eliminate system noise). Background log watching via `wait_for_log`.
- **Environment**: Metro bundler management, app lifecycle, deep links, screen recording, locale switching.
- **Text Input**: Unicode/Cyrillic/CJK/Emoji support via [ADB Keyboard](https://github.com/senzhk/ADBKeyBoard) with automatic keyboard restore.

## Prerequisites

1. **Node.js** (v18+)
2. **ADB** installed and in PATH (for Android).
3. **Maestro** (required for iOS; fallback for Android input).

   - **Mac/Linux**: `curl -Ls "https://get.maestro.mobile.dev" | bash`

   - **Windows**:

      ```powershell
     powershell -Command "iwr -useb https://get.maestro.mobile.dev | iex"
     ```

4. **(Optional) ADB Keyboard** — only needed for non-ASCII input (Unicode, Cyrillic, Emoji).
   - Download from [GitHub](https://github.com/senzhk/ADBKeyBoard) and install: `adb install ADBKeyboard.apk`.

## Configuration

### macOS / Linux

```json
{
  "mcpServers": {
    "open-mobile-mcp": {
      "command": "npx",
      "args": ["open-mobile-mcp"]
    }
  }
}
```

### Windows

```json
{
  "mcpServers": {
    "open-mobile-mcp": {
      "command": "npx",
      "args": ["open-mobile-mcp"],
      "env": {
        "MAESTRO_HOME": "C:\\Users\\YOUR_USER\\.maestro",
        "PATH": "C:\\Users\\YOUR_USER\\.maestro\\maestro\\bin;C:\\Windows\\system32;C:\\Windows;..."
      }
    }
  }
}
```

> **Note**: On Windows, explicitly setting `MAESTRO_HOME` and `PATH` is often required for `maestro` to be found.

<details>
<summary>Running from source</summary>

```bash
git clone https://github.com/xzaleksey/open-mobile-mcp.git
cd open-mobile-mcp
npm install && npm run build
```

Then use `"command": "node", "args": ["/path/to/open-mobile-mcp/build/index.js"]` in your MCP config.
</details>

## Tools

### Perception

| Tool | Platform | Description |
| :--- | :--- | :--- |
| `device_list` | Android/iOS | List connected emulators and simulators |
| `get_viewport` | Android/iOS | Screenshot (~800px wide). **Use `originalWidth`/`originalHeight` for tap coordinates** — the image is scaled down, tapping at image pixels will miss. |
| `get_semantic_hierarchy` | Android/iOS | Pruned UI tree as JSON |
| `get_screen_text` | Android/iOS | OCR via Tesseract.js (default `eng`) |
| `configure_ocr` | Android/iOS | Set default OCR language (e.g. `eng+fra`) |
| `find_element` | Android/iOS | Find elements by `testId`, `text`, or `contentDescription` |
| `wait_for_element` | Android/iOS | Poll until element appears (default 20s) |
| `get_element_image` | Android/iOS | Cropped screenshot of a specific element |
| `capture_diff` | — | Compare two base64 screenshots, returns diff % |
| `analyze_layout_health` | Android/iOS | Detect deep nesting and layout performance issues |

### Interaction

| Tool | Platform | Description |
| :--- | :--- | :--- |
| `tap_on_element` | Android/iOS | **Recommended** — find + tap by selector. Note: text matching is exact; emoji prefixes (e.g. `🇫🇷 French A2`) break text matching — check `get_semantic_hierarchy` for exact text first. |
| `device_tap` | Android/iOS | Raw coordinate tap. Must use original device pixels, not screenshot pixels. |
| `device_swipe` | Android/iOS | Swipe by coordinates |
| `device_type` | Android/iOS | Type text (handles Unicode) |
| `device_pinch` | Android | Two-finger pinch/zoom |
| `device_rotate_gesture` | Android | Two-finger rotation |
| `device_press_key` | Android/iOS | Hardware keys: `back`, `home`, `recents`, `enter`, `delete`, `volume_up`, `volume_down`, `power`, `tab`, `search`, `space`, `menu`, `dpad_*`. Also accepts raw Android keycodes. |

### Environment & Logs

| Tool | Platform | Description |
| :--- | :--- | :--- |
| `manage_bundler` | Android/iOS | Start/stop/restart Metro. Pass `deviceId` + `packageId` for PID-based Android log filtering. |
| `manage_platform_logs` | Android/iOS | Manual control over `adb logcat` / `xcrun` capture. Pass `deviceId` + `packageId` for per-app filtering. |
| `get_bundler_logs` | Android/iOS | Recent Metro/Android/iOS logs. Returns `[status]` line — if buffer is empty, capture may not be running. |
| `stream_errors` | Android/iOS | Recent error/exception lines across all sources |
| `get_network_logs` | Android/iOS | Network logcat lines. For iOS, filters the internal log capture buffer (enable via `manage_platform_logs`). |
| `wait_for_log` | Android/iOS | Block until a log pattern matches. See subagent pattern below. |
| `manage_app_lifecycle` | Android/iOS | Launch, stop, install, or uninstall apps |
| `open_deep_link` | Android/iOS | Open a URL or deep link |
| `clear_app_data` | Android/iOS | Reset app to fresh-install state |
| `get_app_info` | Android | Version, permissions, install date |
| `set_system_locale` | Android/iOS | Set device locale (e.g. `fr-FR`) |
| `start_recording` / `stop_recording` | Android/iOS | Screen recording to `.mp4` (Android uses `screenrecord`, iOS uses `simctl io`). |
| `run_maestro_flow` | Android/iOS | Run a Maestro YAML flow |
| `run_doctor` | — | Run `npx expo-doctor` |
| `install_deps` | — | Run `npx expo install <packages>` |

### wait_for_log — Background Subagent Pattern

`wait_for_log` blocks until a pattern appears in the log buffer. Calling it directly in the main agent freezes the conversation. Always delegate it to a background subagent in Claude Code:

```typescript
// Step 1 — spawn the watcher BEFORE the action that will trigger the log
// (In Claude Code, use Agent tool with run_in_background: true)
// Subagent prompt: "Call wait_for_log with pattern 'route: /home', timeout 60000. Report the result."

// Step 2 — perform the action in the main agent
tap_on_element({ selector: "Home", strategy: "text" });

// Step 3 — main agent continues freely; gets notified when subagent finishes
```

## License

MIT
