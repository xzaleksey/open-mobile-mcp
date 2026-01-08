import { exec, spawn } from "child_process";
import { promisify } from "util";
import { runMaestroFlow } from "./maestro.js";

const execAsync = promisify(exec);

// Helper to run spawn as promise for safer arg passing (bypassing shell)
function spawnAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args);
    let stderr = "";
    process.stderr.on("data", (d) => (stderr += d.toString()));
    process.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}: ${stderr}`));
    });
  });
}

export async function deviceTap(
  deviceId: string,
  platform: "android" | "ios",
  x: number,
  y: number
): Promise<void> {
  if (platform === "android") {
    await execAsync(`adb -s ${deviceId} shell input tap ${x} ${y}`);
  } else {
    // iOS tap via Maestro flow
    const flowYaml = `
---
- tapOn:
    point: ${x},${y}
`;
    await runMaestroFlow(deviceId, flowYaml);
  }
}

export async function deviceType(
  deviceId: string,
  platform: "android" | "ios",
  text: string
): Promise<void> {
  if (platform === "android") {
    // Check for non-ASCII characters
    // eslint-disable-next-line no-control-regex
    const isAscii = /^[\x00-\x7F]*$/.test(text);

    if (isAscii) {
      // Fast path for simple text
      const escapedText = text.replace(/\s/g, "%s");
      await execAsync(`adb -s ${deviceId} shell input text "${escapedText}"`);
    } else {
      // Fallback for Unicode (Cyrillic, etc.)
      // "adb shell input text" fails.
      // "service call clipboard" fails on API 29+.
      // Maestro failed silently, likely due to Windows file encoding issues when reading the YAML.

      // SOLUTION: Escape the characters in the YAML string itself.
      // YAML supports double-quoted strings with \uXXXX escapes.
      // We convert "музей" -> "\u043c\u0443\u0437\u0435\u0439"
      // This keeps the YAML file pure ASCII, bypassing shell/cmd/fs encoding bugs.

      const unicodeEscaped = text
        .split("")
        .map((char) => {
          const code = char.charCodeAt(0);
          if (code > 127) {
            // zero-pad to 4 digits
            return "\\u" + code.toString(16).padStart(4, "0");
          }
          return char;
        })
        .join("");

      // We need to double-escape backslashes because we are writing a JS string -> YAML string
      // Actually, in YAML "..." allows \u.
      // In JS string literal `...${unicodeEscaped}...` -> the backslash is literally there.
      // So "\u043c" in JS string becomes \u043c in file. Correct.

      const flowYaml = `
---
- inputText: "${unicodeEscaped}"
`;
      await runMaestroFlow(deviceId, flowYaml);
    }
  } else {
    const flowYaml = `
---
- inputText: "${text}"
`;
    await runMaestroFlow(deviceId, flowYaml);
  }
}

export async function deviceSwipe(
  deviceId: string,
  platform: "android" | "ios",
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<void> {
  if (platform === "android") {
    await execAsync(
      `adb -s ${deviceId} shell input swipe ${x1} ${y1} ${x2} ${y2}`
    );
  } else {
    const flowYaml = `
---
- swipe:
    start: ${x1},${y1}
    end: ${x2},${y2}
`;
    await runMaestroFlow(deviceId, flowYaml);
  }
}
