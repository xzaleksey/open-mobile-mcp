import { exec, execSync, ChildProcess } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

// Timeout in milliseconds for Maestro commands
const MAESTRO_TIMEOUT_MS = 30000;

export async function runMaestroFlow(
  deviceId: string,
  flowYaml: string
): Promise<string> {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `maestro_flow_${Date.now()}.yaml`);

  // Maestro requires an appId config section before the flow commands
  // Only prepend if not provided by user
  const flowWithConfig = flowYaml.includes("appId:")
    ? flowYaml
    : `appId: ""
${flowYaml}`;

  await fs.writeFile(filePath, flowWithConfig, "utf8");

  try {
    // assumes maestro is in PATH
    // Command in 2.0.5+: maestro test <file>
    const { stdout, stderr } = await execAsync(
      `maestro test "${filePath}"`,
      { timeout: MAESTRO_TIMEOUT_MS }
    );
    return stdout + (stderr ? "\n" + stderr : "");
  } catch (error: any) {
    if (error.killed) {
      throw new Error(
        `Maestro execution timed out after ${MAESTRO_TIMEOUT_MS}ms`
      );
    }
    if (error.stdout) return error.stdout; // Return output even if failed
    throw new Error(`Maestro execution failed: ${error.message}`);
  } finally {
    // Cleanup
    await fs.unlink(filePath).catch(() => {});
  }
}
