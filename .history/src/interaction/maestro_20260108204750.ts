import { exec } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function runMaestroFlow(
  deviceId: string,
  flowYaml: string
): Promise<string> {
  // Create temp file
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `maestro_flow_${Date.now()}.yaml`);

  await fs.writeFile(filePath, flowYaml, "utf8");

  try {
    // assumes maestro is in PATH
    // Use --device argument if maestro supports it (it usually selects the active one or via GUID)
    // Command: maestro --device <id> test <file>
    // The --device flag is often a global flag in newer Maestro versions, or we try env var
    // User reported "Unknown option --device" for "maestro test --device".
    // We will try command: maestro --device <id> test ...
    const { stdout, stderr } = await execAsync(
      `maestro --device ${deviceId} test "${filePath}"`
    );
    return stdout;
  } catch (error: any) {
    if (error.stdout) return error.stdout; // Return output even if failed
    throw new Error(`Maestro execution failed: ${error.message}`);
  } finally {
    // Cleanup
    await fs.unlink(filePath).catch(() => {});
  }
}
