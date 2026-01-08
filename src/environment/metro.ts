import { ChildProcess, exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

let metroProcess: ChildProcess | null = null;
let androidLogProcess: ChildProcess | null = null;
let iosLogProcess: ChildProcess | null = null;

const logBuffer: string[] = [];
const androidLogBuffer: string[] = [];
const iosLogBuffer: string[] = [];
const MAX_LOG_LINES = 10000;

export async function manageBundler(
  action: "start" | "stop" | "restart",
  projectPath: string = process.cwd(),
  command: string = "npx expo start",
  autoStartPlatformLogs: boolean = true
): Promise<string> {
  if (action === "stop" || action === "restart") {
    if (metroProcess) {
      metroProcess.kill();
      metroProcess = null;
    }

    // Also stop platform logs
    if (androidLogProcess) {
      androidLogProcess.kill();
      androidLogProcess = null;
    }
    if (iosLogProcess) {
      iosLogProcess.kill();
      iosLogProcess = null;
    }

    // Force kill port 8081
    try {
      if (process.platform === "win32") {
        await execAsync("npx kill-port 8081");
        const { stdout } = await execAsync("netstat -ano | findstr :8081");
        if (stdout) {
          const pid = stdout.split(/\s+/).pop();
          if (pid) await execAsync(`taskkill /F /PID ${pid}`);
        }
      } else {
        await execAsync("lsof -ti:8081 | xargs kill -9").catch(() => {});
      }
    } catch (e) {
      // Ignore if no process on port
    }
    if (action === "stop") return "Bundler and platform logs stopped.";
  }

  if (action === "start" || action === "restart") {
    // Start Metro
    const parts = command.split(" ");
    const cmd = parts[0];
    const args = parts.slice(1);

    metroProcess = spawn(cmd, args, {
      cwd: projectPath,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "1",
        TERM: "xterm-256color",
      },
    });

    metroProcess.stdin?.end();

    metroProcess.stdout?.on("data", (data) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line) {
          logBuffer.push(line);
          if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
        }
      }
    });

    metroProcess.stderr?.on("data", (data) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line) {
          logBuffer.push(line);
          if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
        }
      }
    });

    // Auto-start platform logs
    let platformLogsMsg = "";
    if (autoStartPlatformLogs) {
      // Detect platform from command or try both
      const hasAndroid = command.toLowerCase().includes("android");
      const hasIos = command.toLowerCase().includes("ios");

      if (hasAndroid) {
        await startPlatformLog("android", projectPath);
        platformLogsMsg += " Android logs started.";
      } else if (hasIos) {
        await startPlatformLog("ios", projectPath);
        platformLogsMsg += " iOS logs started.";
      } else {
        // Try starting Android logs by default (most common)
        await startPlatformLog("android", projectPath).catch(() => {
          // Android not available, try iOS
          startPlatformLog("ios", projectPath).catch(() => {
            // Neither available, silently fail
          });
        });
        platformLogsMsg += " Platform logs auto-started.";
      }
    }

    return `Bundler started on port 8081.${platformLogsMsg}`;
  }

  return "Invalid action.";
}

// Internal helper to start platform logs without returning messages
async function startPlatformLog(
  platform: "android" | "ios",
  projectPath: string
): Promise<void> {
  const logProcess = platform === "android" ? androidLogProcess : iosLogProcess;
  const logBuffer = platform === "android" ? androidLogBuffer : iosLogBuffer;

  if (logProcess) {
    return; // Already running
  }

  const command =
    platform === "android"
      ? "adb logcat *:S ReactNative:V ReactNativeJS:V"
      : 'xcrun simctl spawn booted log stream --predicate \'process == "SpringBoard" OR processImagePath CONTAINS "app"\'';

  const parts = command.split(" ");
  const cmd = parts[0];
  const args = parts.slice(1);

  const platformLogProcess = spawn(cmd, args, {
    cwd: projectPath,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
  });

  platformLogProcess.stdin?.end();

  platformLogProcess.stdout?.on("data", (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line) {
        logBuffer.push(line);
        if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
      }
    }
  });

  platformLogProcess.stderr?.on("data", (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line) {
        logBuffer.push(line);
        if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
      }
    }
  });

  platformLogProcess.on("exit", () => {
    if (platform === "android") {
      androidLogProcess = null;
    } else {
      iosLogProcess = null;
    }
  });

  if (platform === "android") {
    androidLogProcess = platformLogProcess;
  } else {
    iosLogProcess = platformLogProcess;
  }
}

export async function managePlatformLogs(
  platform: "android" | "ios",
  action: "start" | "stop",
  projectPath: string = process.cwd()
): Promise<string> {
  const logProcess = platform === "android" ? androidLogProcess : iosLogProcess;
  const logBuffer = platform === "android" ? androidLogBuffer : iosLogBuffer;

  // Use native commands instead of react-native CLI
  const command =
    platform === "android"
      ? "adb logcat *:S ReactNative:V ReactNativeJS:V"
      : 'xcrun simctl spawn booted log stream --predicate \'process == "SpringBoard" OR processImagePath CONTAINS "app"\'';

  if (action === "stop") {
    if (logProcess) {
      logProcess.kill();
      if (platform === "android") {
        androidLogProcess = null;
      } else {
        iosLogProcess = null;
      }
    }
    return `${platform} log capture stopped.`;
  }

  if (action === "start") {
    if (logProcess) {
      return `${platform} log capture is already running.`;
    }

    const parts = command.split(" ");
    const cmd = parts[0];
    const args = parts.slice(1);

    const platformLogProcess = spawn(cmd, args, {
      cwd: projectPath,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
    });

    platformLogProcess.stdin?.end();

    platformLogProcess.stdout?.on("data", (data) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line) {
          logBuffer.push(line);
          if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
        }
      }
    });

    platformLogProcess.stderr?.on("data", (data) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line) {
          logBuffer.push(line);
          if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
        }
      }
    });

    platformLogProcess.on("exit", () => {
      if (platform === "android") {
        androidLogProcess = null;
      } else {
        iosLogProcess = null;
      }
    });

    if (platform === "android") {
      androidLogProcess = platformLogProcess;
    } else {
      iosLogProcess = platformLogProcess;
    }

    return `${platform} log capture started.`;
  }

  return "Invalid action.";
}

export function streamErrors(tailLength: number = 50): string {
  // Filter for errors across all logs
  const allLogs = [...logBuffer, ...androidLogBuffer, ...iosLogBuffer];
  const errorLogs = allLogs.filter(
    (line) =>
      line.toLowerCase().includes("error") ||
      line.toLowerCase().includes("exception") ||
      line.toLowerCase().includes("fail")
  );
  return errorLogs.slice(-tailLength).join("\n");
}

export function getLogs(
  tailLength: number = 100,
  source: "metro" | "android" | "ios" | "all" = "all"
): string {
  switch (source) {
    case "metro":
      return logBuffer.slice(-tailLength).join("\n");
    case "android":
      return androidLogBuffer.slice(-tailLength).join("\n");
    case "ios":
      return iosLogBuffer.slice(-tailLength).join("\n");
    case "all":
      const allLogs = [
        ...logBuffer.map((line) => `[Metro] ${line}`),
        ...androidLogBuffer.map((line) => `[Android] ${line}`),
        ...iosLogBuffer.map((line) => `[iOS] ${line}`),
      ];
      return allLogs.slice(-tailLength).join("\n");
    default:
      return logBuffer.slice(-tailLength).join("\n");
  }
}
