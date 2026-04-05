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

/** Returns the provided deviceId, or auto-detects the first connected Android device. */
async function resolveAndroidDeviceId(deviceId?: string): Promise<string | undefined> {
  if (deviceId) return deviceId;
  try {
    const { stdout } = await execAsync("adb devices");
    const lines = stdout.split("\n").slice(1); // skip header
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[1] === "device") return parts[0];
    }
  } catch {
    // adb not available
  }
  return undefined;
}

export async function manageBundler(
  action: "start" | "stop" | "restart",
  projectPath: string = process.cwd(),
  command: string = "npx expo start",
  autoStartPlatformLogs: boolean = true,
  showTerminal: boolean = true,
  packageId?: string,
  logFilter?: string,
  deviceId?: string
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
    if (showTerminal) {
      if (process.platform === "win32") {
        // Use spawn with detached: true so it returns immediately
        // The 'start' command launches a new process, and we don't want to wait for it.
        spawn("cmd.exe", ["/c", "start", "Metro Bundler", "/d", projectPath, "cmd", "/k", command], {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        }).unref();
      } else if (process.platform === "darwin") {
        const fullCmd = `osascript -e 'tell application "Terminal" to do script "cd ${projectPath} && ${command}"'`;
        await execAsync(fullCmd);
      } else {
        // Best effort for linux
        const fullCmd = `x-terminal-emulator -e "bash -c 'cd ${projectPath} && ${command}; exec bash'"`;
        await execAsync(fullCmd).catch(() => {
          // fallback to simple spawn if no terminal emulator
        });
      }
      
      // If we show terminal, we might still want to track the process if possible, 
      // but 'start' doesn't easily give back the PID of the actual metro process.
      // For now, we return that it was started in a new terminal.
    } else {
      // Start Metro normally (internal spawn)
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
    }

    // Auto-start platform logs
    let platformLogsMsg = "";
    if (autoStartPlatformLogs) {
      // Detect platform from command or try both
      const hasAndroid = command.toLowerCase().includes("android");
      const hasIos = command.toLowerCase().includes("ios");

      if (hasAndroid) {
        await startPlatformLog("android", projectPath, showTerminal, packageId, logFilter, deviceId);
        platformLogsMsg += " Android logs started.";
      } else if (hasIos) {
        await startPlatformLog("ios", projectPath, showTerminal, packageId, logFilter, deviceId);
        platformLogsMsg += " iOS logs started.";
      } else {
        // Try starting Android logs by default (most common)
        await startPlatformLog("android", projectPath, showTerminal, packageId, logFilter, deviceId).catch(() => {
          // Android not available, try iOS
          startPlatformLog("ios", projectPath, showTerminal, packageId, logFilter, deviceId).catch(() => {
            // Neither available, silently fail
          });
        });
        platformLogsMsg += " Platform logs auto-started.";
      }
    }

    return `Bundler started${showTerminal ? " in a new terminal" : ""} on port 8081.${platformLogsMsg}`;
  }

  return "Invalid action.";
}

// Internal helper to start platform logs without returning messages
async function startPlatformLog(
  platform: "android" | "ios",
  projectPath: string,
  showTerminal: boolean = false,
  packageId?: string,
  logFilter?: string,
  deviceId?: string
): Promise<void> {
  const logProcess = platform === "android" ? androidLogProcess : iosLogProcess;
  const logBuffer = platform === "android" ? androidLogBuffer : iosLogBuffer;

  if (logProcess) {
    return; // Already running
  }

  let command: string;

  if (platform === "android") {
    const resolvedDeviceId = await resolveAndroidDeviceId(deviceId);
    if (packageId && resolvedDeviceId) {
      let pidFlag = "";
      try {
        const { stdout } = await execAsync(`adb -s ${resolvedDeviceId} shell pidof -s ${packageId}`);
        const pid = stdout.trim();
        if (pid) pidFlag = `--pid=${pid}`;
      } catch {
        // app not running yet or pidof unavailable — fall back to tag filter
      }
      command = `adb -s ${resolvedDeviceId} logcat *:S ReactNative:V ReactNativeJS:V AndroidRuntime:E${pidFlag ? ` ${pidFlag}` : ""}`;
    } else {
      const deviceFlag = resolvedDeviceId ? `-s ${resolvedDeviceId} ` : "";
      command = `adb ${deviceFlag}logcat *:S ReactNative:V ReactNativeJS:V AndroidRuntime:E`;
      if (logFilter) command += ` ${logFilter}`;
    }
  } else {
    command = 'xcrun simctl spawn booted log stream --predicate \'process == "SpringBoard" OR processImagePath CONTAINS "app"\'';
    if (packageId || logFilter) {
      const customFilter = logFilter || `processImagePath CONTAINS "${packageId}"`;
      command = `xcrun simctl spawn booted log stream --predicate 'process == "SpringBoard" OR processImagePath CONTAINS "app" OR ${customFilter}'`;
    }
  }

  if (showTerminal) {
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", `${platform.toUpperCase()} Logs`, "cmd", "/k", command], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      }).unref();
    } else if (process.platform === "darwin") {
      const fullCmd = `osascript -e 'tell application "Terminal" to do script "${command}"'`;
      exec(fullCmd);
    }
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
}

export async function managePlatformLogs(
  platform: "android" | "ios",
  action: "start" | "stop",
  projectPath: string = process.cwd(),
  showTerminal: boolean = true,
  packageId?: string,
  logFilter?: string,
  deviceId?: string
): Promise<string> {
  const logProcess = platform === "android" ? androidLogProcess : iosLogProcess;
  const logBuffer = platform === "android" ? androidLogBuffer : iosLogBuffer;

  let command: string;

  if (platform === "android") {
    const resolvedDeviceId = await resolveAndroidDeviceId(deviceId);
    if (packageId && resolvedDeviceId) {
      // Resolve PID at start time and filter by it — eliminates all system noise
      let pidFlag = "";
      try {
        const { stdout } = await execAsync(`adb -s ${resolvedDeviceId} shell pidof -s ${packageId}`);
        const pid = stdout.trim();
        if (pid) pidFlag = `--pid=${pid}`;
      } catch {
        // pidof not available or app not running — fall back to tag filter
      }
      command = `adb -s ${resolvedDeviceId} logcat *:S ReactNative:V ReactNativeJS:V AndroidRuntime:E${pidFlag ? ` ${pidFlag}` : ""}`;
    } else {
      const deviceFlag = resolvedDeviceId ? `-s ${resolvedDeviceId} ` : "";
      command = `adb ${deviceFlag}logcat *:S ReactNative:V ReactNativeJS:V AndroidRuntime:E`;
      if (logFilter) command += ` ${logFilter}`;
    }
  } else {
    command = 'xcrun simctl spawn booted log stream --predicate \'process == "SpringBoard" OR processImagePath CONTAINS "app"\'';
    if (packageId || logFilter) {
      const customFilter = logFilter || `processImagePath CONTAINS "${packageId}"`;
      command = `xcrun simctl spawn booted log stream --predicate 'process == "SpringBoard" OR processImagePath CONTAINS "app" OR ${customFilter}'`;
    }
  }

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
    if (logProcess && !showTerminal) {
      return `${platform} log capture is already running.`;
    }

    if (showTerminal) {
      if (process.platform === "win32") {
        spawn("cmd.exe", ["/c", "start", `${platform.toUpperCase()} Logs`, "cmd", "/k", command], {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        }).unref();
      } else if (process.platform === "darwin") {
        const fullCmd = `osascript -e 'tell application "Terminal" to do script "${command}"'`;
        exec(fullCmd);
      }
    }

    if (logProcess) {
       return `${platform} log capture started in new terminal.`;
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
  const status = [
    `[status] metro=${metroProcess ? "running" : "stopped"}`,
    `android=${androidLogProcess ? "capturing" : "stopped"}`,
    `ios=${iosLogProcess ? "capturing" : "stopped"}`,
  ].join(" ");

  let lines: string[];
  switch (source) {
    case "metro":
      lines = logBuffer.slice(-tailLength);
      break;
    case "android":
      lines = androidLogBuffer.slice(-tailLength);
      break;
    case "ios":
      lines = iosLogBuffer.slice(-tailLength);
      break;
    case "all":
    default:
      lines = [
        ...logBuffer.map((line) => `[Metro] ${line}`),
        ...androidLogBuffer.map((line) => `[Android] ${line}`),
        ...iosLogBuffer.map((line) => `[iOS] ${line}`),
      ].slice(-tailLength);
  }

  if (lines.length === 0) {
    return `${status}\n[no logs captured — use manage_bundler or manage_platform_logs to start capture]`;
  }
  return `${status}\n${lines.join("\n")}`;
}

/**
 * Poll the in-memory log buffers until a pattern is matched or timeout expires.
 * Designed to be called from a background subagent so the main agent isn't blocked.
 */
export async function waitForLog(
  pattern: string,
  timeoutMs: number = 60000,
  source: "metro" | "android" | "ios" | "all" = "all"
): Promise<{ matched: boolean; line?: string; elapsed: number }> {
  const regex = new RegExp(pattern, "i");
  const start = Date.now();
  const pollInterval = 500;

  const getBuffer = () => {
    switch (source) {
      case "metro": return logBuffer;
      case "android": return androidLogBuffer;
      case "ios": return iosLogBuffer;
      default: return [...logBuffer, ...androidLogBuffer, ...iosLogBuffer];
    }
  };

  // Track how many lines we've already seen so we only check new ones
  let seenCount = getBuffer().length;

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollInterval));
    const buf = getBuffer();
    const newLines = buf.slice(seenCount);
    seenCount = buf.length;
    for (const line of newLines) {
      if (regex.test(line)) {
        return { matched: true, line, elapsed: Date.now() - start };
      }
    }
  }

  return { matched: false, elapsed: Date.now() - start };
}

/**
 * Filter platform logs for network tags or regex.
 */
export async function getNetworkLogs(
  deviceId: string,
  platform: "android" | "ios" = "android",
  filter: string = "ReactNativeJS|OkHttp|Volley|CRONET",
  tailLength: number = 1000
): Promise<string> {
  const regex = new RegExp(filter, "i");

  if (platform === "android") {
    const { stdout } = await execAsync(
      `adb -s ${deviceId} logcat -d -t ${tailLength}`
    );
    return stdout
      .split("\n")
      .filter((line) => regex.test(line))
      .join("\n");
  } else {
    // iOS: Filter the internal log buffer
    // Note: This requires that manage_platform_logs or manage_bundler was already called for iOS.
    if (iosLogBuffer.length === 0) {
      return "[no iOS logs captured — use manage_platform_logs(platform: 'ios', action: 'start') to enable capture]";
    }
    return iosLogBuffer
      .slice(-tailLength)
      .filter((line) => regex.test(line))
      .join("\n");
  }
}
