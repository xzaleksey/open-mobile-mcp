# Open Mobile MCP Server 📱

An open-source **Model Context Protocol (MCP)** server for mobile automation. It provides LLMs (like Claude, Gemini) with the ability to view, control, and test Android and iOS devices.

> **Key Feature**: Robust Unicode support (Cyrillic, CJK, Emoji) via auto-switching to `ADB Keyboard` or falling back to `Maestro`.

## Features

- **Perception**: Get optimized screenshots (`get_viewport`) and semantic hierarchy (`get_semantic_hierarchy`) with roughly 65% token reduction optimization.
- **Interaction**: Tap, swipe, and type (`device_type`) on any visible UI element.
- **Text Input**: Solid international character support. Auto-detects and uses [ADB Keyboard](https://github.com/senzhk/ADBKeyBoard) for reliable non-ASCII input, restores your original keyboard (Gboard/SwiftKey) automatically.
- **Environment**: Manage ADB/Maestro services.

## Prerequisites

1.  **Node.js** (v18+)
2.  **ADB** (Android Debug Bridge) installed and in your PATH.
3.  **Maestro** (Recommended for iOS and fallback Android input).
    - **Mac/Linux**: `curl -Ls "https://get.maestro.mobile.dev" | bash`
    - **Windows**: See [Official Guide](https://docs.maestro.dev/getting-started/installing-maestro/windows)
      ```powershell
      powershell -Command "iwr -useb https://get.maestro.mobile.dev | iex"
      ```
4.  **(Recommended) ADB Keyboard**: For the best text input experience on Android.
    - Download from [GitHub](https://github.com/senzhk/ADBKeyBoard).
    - Install: `adb install ADBKeyboard.apk`.

## Installation

```bash
git clone https://github.com/your-username/open-mobile-mcp.git
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
```

## Usage

The server exposes the following tools to the LLM:

- `get_connected_devices`: List all Android/iOS simulators and devices.
- `device_type(deviceId, platform, text)`: Type text. Handles Unicode transparently.
- `device_tap(deviceId, platform, x, y)`: Touch interactions.
- `device_swipe(...)`: Gestures.
- `get_viewport(...)`: Get a compressed JPEG screenshot.
- `get_semantic_hierarchy(...)`: Get a token-optimized UI tree.

## License

MIT
