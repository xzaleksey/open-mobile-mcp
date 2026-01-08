import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function runDoctor(
  projectPath: string = process.cwd()
): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync("npx expo-doctor", {
      cwd: projectPath,
    });
    return stdout + "\n" + stderr;
  } catch (error: any) {
    return error.stdout + "\n" + error.stderr;
  }
}

export async function installDeps(
  packages: string[],
  projectPath: string = process.cwd()
): Promise<string> {
  try {
    const cmd = `npx expo install ${packages.join(" ")}`;
    const { stdout } = await execAsync(cmd, { cwd: projectPath });
    return stdout;
  } catch (error: any) {
    throw new Error(`Failed to install dependencies: ${error.message}`);
  }
}
