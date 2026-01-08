# Open Mobile MCP Server 📱

An open-source **Model Context Protocol (MCP)** server for mobile automation. It provides LLMs (like Claude, Gemini) with the ability to view, control, and test Android and iOS devices.

> **Key Feature**: Robust Unicode support (Cyrillic, CJK, Emoji) via auto-switching to `ADB Keyboard` or falling back to `Maestro`.

## Features

- **Perception**: Get optimized screenshots (`get_viewport`) and semantic hierarchy (`get_semantic_hierarchy`) with roughly 65% token reduction optimization.
- **Interaction**: Tap, swipe, and type (`device_type`) on any visible UI element.
- **Text Input**: Solid international character support. Auto-detects and uses [ADB Keyboard](https://github.com/senzhk/ADBKeyBoard) for reliable non-ASCII input, restores your original keyboard (Gboard/SwiftKey) automatically.
- **Environment**: Manage ADB/Maestro services.

## Prerequisites

1. **Node.js** (v18+)
2. **ADB** (Android Debug Bridge) installed and in your PATH.
3. **Maestro** (Recommended for iOS and fallback Android input).

   - **Mac/Linux**: `curl -Ls "https://get.maestro.mobile.dev" | bash`
   - **Windows**: See [Official Guide](https://docs.maestro.dev/getting-started/installing-maestro/windows)

     ```powershell
     powershell -Command "iwr -useb https://get.maestro.mobile.dev | iex"
     ```

4. **(Recommended) ADB Keyboard**: Required _only_ for non-standard characters (Unicode, Cyrillic, Emoji). Standard English input works fine without it.
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

Configure your MCP client (e.g., Claude Desktop, Cursor) to use this server:

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

> **Note**: On Windows, explicitly setting `MAESTRO_HOME` and `PATH` in the config is often required for the server to find the `maestro` executable.

## Usage

The server exposes the following tools to the LLM:

- **`manage_bundler`**
    - `action` (string): 'start', 'stop', or 'restart'.
    - `command` (optional string): Custom command (e.g. `npm run android:prod`). Default: `npx expo start`.
    - Usage: Control the Metro bundler. The server captures stdout/stderr.
- `get_bundler_logs`
    - `tailLength` (optional, default 100): Number of lines to return.
    - Usage: Get recent Metro logs (stdout+stderr), including normal app logs.
- `stream_errors`
    - `tailLength` (number): Number of error lines to retrieve.
    - Usage: Get recent error/exception logs from Metro.
- `get_connected_devices`: List all Android/iOS simulators and devices.
- `device_type(deviceId, platform, text)`: Type text. Handles Unicode transparently.
- `device_tap(deviceId, platform, x, y)`: Touch interactions.
- `device_swipe(...)`: Gestures.
- `get_viewport(...)`: Get a compressed JPEG screenshot.
- `get_semantic_hierarchy(...)`: Get a token-optimized UI tree.
- `manage_app_lifecycle(action, deviceId, platform, target)`: App management (`launch`, `stop`, `install`, `uninstall`).
- `open_deep_link(deviceId, platform, url)`: Universal deep linking (`adb shell am start` / `xcrun simctl openurl`).
- `get_screen_text(deviceId, platform, language?)`: **OCR**. Get raw text from the screen using Tesseract.js. Supports multiple languages (default `eng`).
- `configure_ocr(language)`: Set the default language for all future `get_screen_text` calls (e.g. `eng+fra`).
- `find_element(selector, strategy)`: Find UI elements by `testId` (resource-id), `text`, or `contentDescription`. Returns bounds/visibility.
- `wait_for_element(selector, strategy, timeout)`: Server-side polling to wait for an element to appear.
- `get_element_image(selector, strategy)`: Get a cropped screenshot of just the specific element (useful for visual verification).

## License

MIT
```
