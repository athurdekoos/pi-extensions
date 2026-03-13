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

import { execSync } from "node:child_process";
import os from "node:os";

/**
 * Open a URL in the system default browser.
 *
 * Honors PI_PLAN_BROWSER (takes priority) and BROWSER env vars.
 * On macOS, PI_PLAN_BROWSER is opened via `open -a`.
 * On Windows/WSL, uses `cmd.exe /c start`.
 * On Linux, uses `xdg-open` as fallback.
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
        execSync(`open -a ${JSON.stringify(browser)} ${JSON.stringify(url)}`, { stdio: "ignore" });
      } else if (platform === "win32" || wsl) {
        execSync(`cmd.exe /c start "" ${JSON.stringify(browser)} ${JSON.stringify(url)}`, { stdio: "ignore" });
      } else {
        execSync(`${JSON.stringify(browser)} ${JSON.stringify(url)}`, { stdio: "ignore" });
      }
    } else if (platform === "win32" || wsl) {
      execSync(`cmd.exe /c start "" ${JSON.stringify(url)}`, { stdio: "ignore" });
    } else if (platform === "darwin") {
      execSync(`open ${JSON.stringify(url)}`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: "ignore" });
    }
  } catch {
    // Silently fail — browser open is best-effort
  }
}
