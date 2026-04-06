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
  flowYaml: string,
  timeout?: number
): Promise<string> {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `maestro_flow_${Date.now()}.yaml`);

  const flowWithConfig = flowYaml.includes("appId:")
    ? flowYaml
    : `appId: ""
${flowYaml}`;

  await fs.writeFile(filePath, flowWithConfig, "utf8");

  const effectiveTimeout = timeout ?? MAESTRO_TIMEOUT_MS;

  try {
    const { stdout, stderr } = await execAsync(
      `maestro test "${filePath}"`,
      { timeout: effectiveTimeout }
    );
    return stdout + (stderr ? "\n" + stderr : "");
  } catch (error: any) {
    if (error.killed) {
      throw new Error(
        `Maestro execution timed out after ${effectiveTimeout}ms`
      );
    }
    if (error.stdout) return error.stdout;
    throw new Error(`Maestro execution failed: ${error.message}`);
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
}
