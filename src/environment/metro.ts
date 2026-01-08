import { ChildProcess, exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

let metroProcess: ChildProcess | null = null;
const logBuffer: string[] = [];
const MAX_LOG_LINES = 1000;

export async function manageBundler(
  action: "start" | "stop" | "restart",
  projectPath: string = process.cwd(),
  command: string = "npx expo start"
): Promise<string> {
  if (action === "stop" || action === "restart") {
    if (metroProcess) {
      metroProcess.kill();
      metroProcess = null;
    }
    // Force kill port 8081
    try {
      if (process.platform === "win32") {
        await execAsync("npx kill-port 8081"); // Assuming kill-port or similar or netstat logic
        // Windows specific port kill slightly more complex without helper, but let's try a powershell one-liner if needed.
        // or just ignore if not easy.
        // Actually, 'npx react-native start --reset-cache' handles some, but zombies persist.
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
    if (action === "stop") return "Bundler stopped and port 8081 cleared.";
  }

  if (action === "start" || action === "restart") {
    // Start Metro
    // Use provided command or default
    // We need to split command into cmd and args for spawn
    // Simple split by space (caveat: quoted args not supported in this simple version, but sufficient for 'npm run ios')
    const parts = command.split(" ");
    const cmd = parts[0];
    const args = parts.slice(1);

    metroProcess = spawn(cmd, args, {
      cwd: projectPath,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    metroProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      logBuffer.push(output);
      if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
    });

    metroProcess.stderr?.on("data", (data) => {
      const output = data.toString();
      logBuffer.push(output);
      if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
    });

    return "Bundler started on port 8081.";
  }

  return "Invalid action.";
}

export function streamErrors(tailLength: number = 50): string {
  // Filter for errors
  const errorLogs = logBuffer.filter(
    (line) =>
      line.toLowerCase().includes("error") ||
      line.toLowerCase().includes("exception") ||
      line.toLowerCase().includes("fail")
  );
  return errorLogs.slice(-tailLength).join("\n");
}

export function getLogs(tailLength: number = 100): string {
  return logBuffer.slice(-tailLength).join("\n");
}
