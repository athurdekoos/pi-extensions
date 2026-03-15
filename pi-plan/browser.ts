/**
 * browser.ts — Open a URL in the system browser.
 *
 * Owns: Browser detection and launch across macOS, Linux, Windows, and WSL.
 *       Honors PI_PLAN_BROWSER and BROWSER environment variables.
 *
 * Does NOT own: Server lifecycle, plan review logic, Pi API calls.
 *
 * Invariants:
 *   - Never throws. All errors are silently swallowed.
 *   - Never blocks the event loop beyond the execSync call.
 */

import { execFileSync, execSync } from "node:child_process";
import os from "node:os";

/**
 * Open a URL in the system default browser.
 *
 * Honors PI_PLAN_BROWSER (takes priority) and BROWSER env vars.
 * On macOS, PI_PLAN_BROWSER is opened via `open -a`.
 * On Windows/WSL, uses `cmd.exe /c start` (shell required for `start` builtin).
 * On Linux, uses `xdg-open` as fallback.
 *
 * Uses execFileSync with argument arrays where possible to avoid shell injection.
 * Falls back to execSync only for Windows `cmd.exe /c start` (a shell builtin).
 *
 * Silently fails if no browser can be opened.
 */
export function openBrowser(url: string): void {
  try {
    const browser = process.env.PI_PLAN_BROWSER || process.env.BROWSER;
    const platform = process.platform;
    const wsl = platform === "linux" && os.release().toLowerCase().includes("microsoft");

    if (browser) {
      if (process.env.PI_PLAN_BROWSER && platform === "darwin") {
        execFileSync("open", ["-a", browser, url], { stdio: "ignore" });
      } else if (platform === "win32" || wsl) {
        // `start` is a cmd.exe builtin — must use shell
        execSync(`cmd.exe /c start "" ${JSON.stringify(browser)} ${JSON.stringify(url)}`, { stdio: "ignore" });
      } else {
        execFileSync(browser, [url], { stdio: "ignore" });
      }
    } else if (platform === "win32" || wsl) {
      execSync(`cmd.exe /c start "" ${JSON.stringify(url)}`, { stdio: "ignore" });
    } else if (platform === "darwin") {
      execFileSync("open", [url], { stdio: "ignore" });
    } else {
      execFileSync("xdg-open", [url], { stdio: "ignore" });
    }
  } catch {
    // Silently fail — browser open is best-effort
  }
}
