import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// Which browser the login drives (F-2). The user's DEFAULT browser is used
// when Playwright can drive it through `executablePath`: Google Chrome,
// Brave, Microsoft Edge, Vivaldi, Chromium, Opera. Safari and Firefox are
// different engines; Arc and Dia are Chromium based but do not expose a
// DevTools connection (measured: neither --remote-debugging-pipe nor
// --remote-debugging-port answers), so they cannot be driven either. In those
// cases another installed compatible browser is used with a warning, or the
// user is told what to install (or to set MERCADOLIVRE_LOGIN_BROWSER).
// Everything that touches the OS goes through a `Probe`, replaceable in tests.

export type Probe = {
  platform: string;
  home: string;
  /** stdout of a command, or undefined when it fails. */
  exec(cmd: string, args: string[]): string | undefined;
  exists(path: string): boolean;
  /** `.app` bundles in the usual application folders (macOS). */
  listApps(): string[];
};

export const systemProbe: Probe = {
  platform: process.platform,
  home: homedir(),
  exec(cmd, args) {
    try {
      return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
    } catch {
      return undefined;
    }
  },
  exists: (path) => existsSync(path),
  listApps() {
    return ["/Applications", join(homedir(), "Applications")].flatMap((dir) => {
      try {
        return readdirSync(dir)
          .filter((entry) => entry.endsWith(".app"))
          .map((entry) => join(dir, entry));
      } catch {
        return [];
      }
    });
  },
};

export type Browser = { name: string; id?: string; appPath?: string; executablePath: string };

export type DefaultBrowser = {
  name: string;
  id?: string;
  appPath?: string;
  executablePath?: string;
  /** Drivable by Playwright and resolvable on disk. */
  compatible: boolean;
  /** Why not, when not compatible. */
  reason?: string;
};

/** Drivable browsers, in fallback preference order. Ids lowercase (LaunchServices stores them so). */
const DRIVABLE_MAC: Array<{ id: string; name: string }> = [
  { id: "com.google.chrome", name: "Google Chrome" },
  { id: "com.brave.browser", name: "Brave Browser" },
  { id: "com.microsoft.edgemac", name: "Microsoft Edge" },
  { id: "org.chromium.chromium", name: "Chromium" },
  { id: "com.vivaldi.vivaldi", name: "Vivaldi" },
  { id: "com.operasoftware.opera", name: "Opera" },
  { id: "com.google.chrome.canary", name: "Google Chrome Canary" },
  { id: "com.google.chrome.beta", name: "Google Chrome Beta" },
  { id: "com.google.chrome.dev", name: "Google Chrome Dev" },
];

/** Known browsers that cannot be driven, with the reason shown to the user. */
const NOT_DRIVABLE_MAC: Record<string, { name: string; reason: string }> = {
  "company.thebrowser.browser": {
    name: "Arc",
    reason: "Arc is Chromium based but does not expose a DevTools connection, so it cannot be automated",
  },
  "company.thebrowser.dia": {
    name: "Dia",
    reason: "Dia is Chromium based but does not expose a DevTools connection, so it cannot be automated",
  },
  "com.apple.safari": { name: "Safari", reason: "Safari is not Chromium based" },
  "org.mozilla.firefox": { name: "Firefox", reason: "Firefox is not Chromium based" },
  "org.mozilla.firefoxdeveloperedition": { name: "Firefox Developer Edition", reason: "Firefox is not Chromium based" },
  "com.duckduckgo.macos.browser": { name: "DuckDuckGo", reason: "DuckDuckGo is not Chromium based" },
  "com.kagi.kagimacos": { name: "Orion", reason: "Orion is not Chromium based" },
};

const DRIVABLE_LINUX: Array<{ desktop: RegExp; bins: string[]; name: string }> = [
  { desktop: /^google-chrome/, bins: ["google-chrome", "google-chrome-stable"], name: "Google Chrome" },
  { desktop: /^chromium/, bins: ["chromium", "chromium-browser"], name: "Chromium" },
  { desktop: /^brave/, bins: ["brave-browser", "brave"], name: "Brave Browser" },
  { desktop: /^microsoft-edge/, bins: ["microsoft-edge", "microsoft-edge-stable"], name: "Microsoft Edge" },
  { desktop: /^vivaldi/, bins: ["vivaldi", "vivaldi-stable"], name: "Vivaldi" },
  { desktop: /^opera/, bins: ["opera"], name: "Opera" },
];

const DRIVABLE_WINDOWS: Array<{ name: string; paths: string[] }> = [
  {
    name: "Google Chrome",
    paths: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
  },
  { name: "Microsoft Edge", paths: ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"] },
];

export const INSTALL_HINT =
  "The login drives your default browser, which must be Google Chrome or another Chromium-based browser " +
  "that exposes DevTools (Brave, Microsoft Edge, Vivaldi, Chromium). Install one — https://www.google.com/chrome " +
  "— and make it the default, or point MERCADOLIVRE_LOGIN_BROWSER at its .app or executable. " +
  "Without any browser, set MERCADOLIVRE_COOKIE instead.";

// ------------------------------------------------------------------- macOS

function macHandlerId(probe: Probe): string {
  const plist = join(
    probe.home,
    "Library",
    "Preferences",
    "com.apple.LaunchServices",
    "com.apple.launchservices.secure.plist",
  );
  try {
    const parsed = JSON.parse(probe.exec("plutil", ["-convert", "json", "-o", "-", plist]) ?? "{}") as {
      LSHandlers?: Array<{ LSHandlerURLScheme?: string; LSHandlerRoleAll?: string }>;
    };
    const handler = (scheme: string) =>
      parsed.LSHandlers?.find((entry) => entry.LSHandlerURLScheme === scheme)?.LSHandlerRoleAll;
    // No registered handler means the system default: Safari.
    return (handler("https") ?? handler("http") ?? "com.apple.safari").toLowerCase();
  } catch {
    return "com.apple.safari";
  }
}

function macAppInfo(appPath: string, probe: Probe): { id?: string; executable?: string; name?: string } {
  try {
    const info = JSON.parse(
      probe.exec("plutil", ["-convert", "json", "-o", "-", join(appPath, "Contents", "Info.plist")]) ?? "",
    ) as { CFBundleIdentifier?: string; CFBundleExecutable?: string; CFBundleDisplayName?: string; CFBundleName?: string };
    return { id: info.CFBundleIdentifier, executable: info.CFBundleExecutable, name: info.CFBundleDisplayName ?? info.CFBundleName };
  } catch {
    return {};
  }
}

/** LaunchServices first (works even when Spotlight has not indexed the app), then Spotlight, then a scan. */
function macFindApp(id: string, probe: Probe): string | undefined {
  const viaLaunchServices = probe
    .exec("osascript", ["-e", `POSIX path of (path to application id "${id}")`])
    ?.trim()
    .replace(/\/+$/, "");
  if (viaLaunchServices && probe.exists(viaLaunchServices)) return viaLaunchServices;
  const viaSpotlight = probe
    .exec("mdfind", [`kMDItemCFBundleIdentifier == '${id}'c`])
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (viaSpotlight && probe.exists(viaSpotlight)) return viaSpotlight;
  return probe.listApps().find((app) => macAppInfo(app, probe).id?.toLowerCase() === id.toLowerCase());
}

function macBrowser(appPath: string, probe: Probe, fallback: { id?: string; name?: string } = {}): Browser | undefined {
  const info = macAppInfo(appPath, probe);
  if (!info.executable) return undefined;
  return {
    name: info.name ?? fallback.name ?? basename(appPath, ".app"),
    id: info.id ?? fallback.id,
    appPath,
    executablePath: join(appPath, "Contents", "MacOS", info.executable),
  };
}

function macDefault(probe: Probe): DefaultBrowser {
  const id = macHandlerId(probe);
  const drivable = DRIVABLE_MAC.find((entry) => entry.id === id);
  if (drivable) {
    const appPath = macFindApp(id, probe);
    const browser = appPath ? macBrowser(appPath, probe, drivable) : undefined;
    return browser
      ? { ...browser, compatible: true }
      : { name: drivable.name, id, compatible: false, reason: `${drivable.name} is the default browser but its application could not be found` };
  }
  const known = NOT_DRIVABLE_MAC[id];
  if (known) return { name: known.name, id, compatible: false, reason: known.reason };
  const appPath = macFindApp(id, probe);
  const info = appPath ? macAppInfo(appPath, probe) : {};
  const name = info.name ?? id;
  return { name, id, appPath, compatible: false, reason: `${name} is not known to be a Chromium-based browser that exposes DevTools` };
}

function macFallback(probe: Probe): Browser | undefined {
  for (const entry of DRIVABLE_MAC) {
    const appPath = macFindApp(entry.id, probe);
    const browser = appPath ? macBrowser(appPath, probe, entry) : undefined;
    if (browser) return browser;
  }
  return undefined;
}

// ------------------------------------------------------------------- Linux

function linuxBin(bins: string[], probe: Probe): string | undefined {
  for (const bin of bins) {
    const path = probe.exec("which", [bin])?.trim();
    if (path && probe.exists(path)) return path;
  }
  return undefined;
}

function linuxDefault(probe: Probe): DefaultBrowser | undefined {
  const desktop = probe.exec("xdg-settings", ["get", "default-web-browser"])?.trim();
  if (!desktop) return undefined;
  const name = desktop.replace(/\.desktop$/, "");
  const entry = DRIVABLE_LINUX.find((candidate) => candidate.desktop.test(desktop));
  if (!entry) {
    return { name, compatible: false, reason: `${name} is not a Chromium-based browser that exposes DevTools` };
  }
  const executablePath = linuxBin(entry.bins, probe);
  return executablePath
    ? { name: entry.name, executablePath, compatible: true }
    : { name: entry.name, compatible: false, reason: `${entry.name} is the default browser but its executable is not on PATH` };
}

function linuxFallback(probe: Probe): Browser | undefined {
  for (const entry of DRIVABLE_LINUX) {
    const executablePath = linuxBin(entry.bins, probe);
    if (executablePath) return { name: entry.name, executablePath };
  }
  return undefined;
}

// ----------------------------------------------------------------- Windows

function windowsFallback(probe: Probe): Browser | undefined {
  for (const entry of DRIVABLE_WINDOWS) {
    const executablePath = entry.paths.find((path) => probe.exists(path));
    if (executablePath) return { name: entry.name, executablePath };
  }
  return undefined;
}

// ------------------------------------------------------------------ public

/** The system default browser and whether the login can drive it. */
export function detectDefaultBrowser(probe: Probe = systemProbe): DefaultBrowser | undefined {
  if (probe.platform === "darwin") return macDefault(probe);
  if (probe.platform === "linux") return linuxDefault(probe);
  return undefined;
}

function installedFallback(probe: Probe): Browser | undefined {
  if (probe.platform === "darwin") return macFallback(probe);
  if (probe.platform === "linux") return linuxFallback(probe);
  if (probe.platform === "win32") return windowsFallback(probe);
  return undefined;
}

/** MERCADOLIVRE_LOGIN_BROWSER: an .app bundle, an executable, or a bundle id. */
function resolveOverride(value: string, probe: Probe): Browser {
  const fail = (reason: string) =>
    new Error(`MERCADOLIVRE_LOGIN_BROWSER points to ${value}, ${reason}. ${INSTALL_HINT}`);
  if (/\.app\/?$/i.test(value)) {
    const appPath = value.replace(/\/+$/, "");
    if (!probe.exists(appPath)) throw fail("which does not exist");
    const browser = macBrowser(appPath, probe);
    if (!browser) throw fail("whose Info.plist has no executable");
    return browser;
  }
  if (probe.exists(value)) return { name: basename(value), executablePath: value };
  if (probe.platform === "darwin" && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value)) {
    const appPath = macFindApp(value, probe);
    const browser = appPath ? macBrowser(appPath, probe, { id: value }) : undefined;
    if (browser) return browser;
    throw fail("a bundle id no installed application answers to");
  }
  throw fail("which does not exist");
}

/**
 * The browser the login will open: the override when set, else the default
 * browser when it can be driven, else an installed drivable browser (with a
 * warning), else an error telling the user what to install.
 */
export function resolveLoginBrowser(
  opts: { override?: string },
  probe: Probe = systemProbe,
): { browser: Browser; warnings: string[] } {
  if (opts.override) return { browser: resolveOverride(opts.override, probe), warnings: [] };

  const found = detectDefaultBrowser(probe);
  if (found?.compatible && found.executablePath) {
    const { name, id, appPath, executablePath } = found;
    return { browser: { name, ...(id ? { id } : {}), ...(appPath ? { appPath } : {}), executablePath }, warnings: [] };
  }

  const reason =
    found === undefined
      ? `Could not detect the default browser on ${probe.platform}.`
      : `Your default browser (${found.name}) is not compatible with the login: ${found.reason}.`;

  const fallback = installedFallback(probe);
  if (fallback) {
    return {
      browser: fallback,
      warnings: [`${reason} Using ${fallback.name} (${fallback.appPath ?? fallback.executablePath}) instead.`],
    };
  }
  throw new Error(`${reason} ${INSTALL_HINT}`);
}
