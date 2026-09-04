import { describe, expect, test } from "bun:test";
import { detectDefaultBrowser, resolveLoginBrowser, type Probe } from "../src/auth/browser.js";

// The login opens the user's DEFAULT browser when Playwright can drive it
// (Chrome, Brave, Edge, Vivaldi, Chromium...). Safari and Firefox are other
// engines; Arc and Dia are Chromium based but expose no DevTools connection.
// Those cases fall back to an installed drivable browser with a warning, or
// tell the user what to install. Everything OS-bound goes through a probe.

type App = { id: string; exe: string; name: string };

function probeFor(opts: {
  platform?: string;
  https?: string | null;
  apps?: Record<string, App>;
  launchServices?: boolean;
  spotlight?: boolean;
  files?: string[];
  xdg?: string;
  which?: Record<string, string>;
}): Probe {
  const apps = opts.apps ?? {};
  const byId = (id: string) => Object.entries(apps).find(([, app]) => app.id.toLowerCase() === id.toLowerCase())?.[0];
  return {
    platform: opts.platform ?? "darwin",
    home: "/Users/test",
    exists: (path) => Object.keys(apps).some((app) => path === app || path.startsWith(`${app}/`)) || (opts.files ?? []).includes(path),
    listApps: () => Object.keys(apps),
    exec: (cmd, args) => {
      const last = args[args.length - 1] ?? "";
      if (cmd === "plutil" && last.endsWith("launchservices.secure.plist")) {
        const handlers = [{ LSHandlerURLScheme: "mailto", LSHandlerRoleAll: "com.apple.mail" }];
        if (opts.https !== null) handlers.push({ LSHandlerURLScheme: "https", LSHandlerRoleAll: opts.https ?? "com.google.chrome" });
        return JSON.stringify({ LSHandlers: handlers });
      }
      if (cmd === "plutil" && last.endsWith("Info.plist")) {
        const app = Object.entries(apps).find(([path]) => last.startsWith(path))?.[1];
        return app ? JSON.stringify({ CFBundleIdentifier: app.id, CFBundleExecutable: app.exe, CFBundleName: app.name }) : undefined;
      }
      if (cmd === "osascript") {
        if (opts.launchServices === false) return undefined;
        const id = /application id "([^"]+)"/.exec(last)?.[1] ?? "";
        const path = byId(id);
        return path ? `${path}/\n` : undefined;
      }
      if (cmd === "mdfind") {
        if (opts.spotlight === false) return "";
        const id = /== '([^']+)'/.exec(last)?.[1] ?? "";
        return byId(id) ?? "";
      }
      if (cmd === "xdg-settings") return opts.xdg;
      if (cmd === "which") return opts.which?.[args[0] ?? ""];
      return undefined;
    },
  };
}

const CHROME: App = { id: "com.google.Chrome", exe: "Google Chrome", name: "Google Chrome" };
const ARC: App = { id: "company.thebrowser.Browser", exe: "Arc", name: "Arc" };
const SAFARI: App = { id: "com.apple.Safari", exe: "Safari", name: "Safari" };
const BRAVE: App = { id: "com.brave.Browser", exe: "Brave Browser", name: "Brave Browser" };

describe("macOS default browser", () => {
  test("uses the default browser when Playwright can drive it (lowercase id in the plist)", () => {
    const probe = probeFor({ https: "com.brave.browser", apps: { "/Applications/Brave Browser.app": BRAVE, "/Applications/Google Chrome.app": CHROME }, spotlight: false });

    const { browser, warnings } = resolveLoginBrowser({}, probe);

    expect(browser).toEqual({ name: "Brave Browser", id: "com.brave.Browser", appPath: "/Applications/Brave Browser.app", executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" });
    expect(warnings).toEqual([]);
  });

  test("finds the app through spotlight or the applications folder when launchservices does not answer", () => {
    const apps = { "/Users/test/Applications/Google Chrome.app": CHROME };
    const spotlight = resolveLoginBrowser({}, probeFor({ apps, launchServices: false }));
    const scan = resolveLoginBrowser({}, probeFor({ apps, launchServices: false, spotlight: false }));

    expect(spotlight.browser.executablePath).toBe("/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(scan.browser.executablePath).toBe(spotlight.browser.executablePath);
  });

  test("Arc as default: cannot be automated, so an installed Chrome is used with a warning", () => {
    const probe = probeFor({ https: "company.thebrowser.browser", apps: { "/Applications/Arc.app": ARC, "/Applications/Google Chrome.app": CHROME }, spotlight: false });

    expect(detectDefaultBrowser(probe)).toMatchObject({ name: "Arc", compatible: false, reason: expect.stringMatching(/DevTools/) });
    const { browser, warnings } = resolveLoginBrowser({}, probe);
    expect(browser.name).toBe("Google Chrome");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Arc/);
    expect(warnings[0]).toMatch(/not compatible/i);
    expect(warnings[0]).toMatch(/DevTools/);
    expect(warnings[0]).toMatch(/Google Chrome/);
  });

  test("no https handler means Safari: warns and falls back to an installed drivable browser", () => {
    const probe = probeFor({ https: null, apps: { "/Applications/Safari.app": SAFARI, "/Applications/Brave Browser.app": BRAVE } });

    expect(detectDefaultBrowser(probe)).toMatchObject({ name: "Safari", compatible: false });
    const { browser, warnings } = resolveLoginBrowser({}, probe);
    expect(browser.name).toBe("Brave Browser");
    expect(warnings[0]).toMatch(/Safari.*not compatible/i);
    expect(warnings[0]).toMatch(/Brave Browser/);
  });

  test("tells the user to install Chrome or another drivable browser when none is available", () => {
    const probe = probeFor({ https: "org.mozilla.firefox", apps: { "/Applications/Firefox.app": { id: "org.mozilla.firefox", exe: "firefox", name: "Firefox" }, "/Applications/Safari.app": SAFARI } });

    expect(() => resolveLoginBrowser({}, probe)).toThrow(/Firefox.*not compatible[\s\S]*Google Chrome[\s\S]*Brave/);
  });

  test("an unknown browser is not trusted; the message points at the override", () => {
    const probe = probeFor({ https: "com.example.mystery", apps: { "/Applications/Mystery.app": { id: "com.example.mystery", exe: "Mystery", name: "Mystery" } } });

    expect(() => resolveLoginBrowser({}, probe)).toThrow(/Mystery[\s\S]*MERCADOLIVRE_LOGIN_BROWSER/);
  });
});

describe("override", () => {
  test("accepts an .app path, an executable path or a bundle id", () => {
    const apps = { "/Applications/Brave Browser.app": BRAVE, "/Applications/Google Chrome.app": CHROME };
    const app = resolveLoginBrowser({ override: "/Applications/Brave Browser.app" }, probeFor({ https: null, apps }));
    const exe = resolveLoginBrowser({ override: "/opt/chromium/chrome" }, probeFor({ https: null, apps, files: ["/opt/chromium/chrome"] }));
    const id = resolveLoginBrowser({ override: "com.google.Chrome" }, probeFor({ https: null, apps, spotlight: false }));

    expect(app.browser.executablePath).toBe("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser");
    expect(exe.browser).toEqual({ name: "chrome", executablePath: "/opt/chromium/chrome" });
    expect(id.browser.name).toBe("Google Chrome");
  });

  test("a missing override is an error, not a silent fallback", () => {
    expect(() => resolveLoginBrowser({ override: "/Applications/Nope.app" }, probeFor({}))).toThrow(/MERCADOLIVRE_LOGIN_BROWSER[\s\S]*Nope\.app/);
  });
});

describe("linux", () => {
  test("uses the xdg default when drivable, otherwise the first drivable browser on PATH", () => {
    const chrome = resolveLoginBrowser({}, probeFor({ platform: "linux", xdg: "google-chrome.desktop\n", which: { "google-chrome": "/usr/bin/google-chrome" }, files: ["/usr/bin/google-chrome"] }));
    const firefox = resolveLoginBrowser({}, probeFor({ platform: "linux", xdg: "firefox.desktop\n", which: { chromium: "/usr/bin/chromium" }, files: ["/usr/bin/chromium"] }));

    expect(chrome.browser).toMatchObject({ name: "Google Chrome", executablePath: "/usr/bin/google-chrome" });
    expect(chrome.warnings).toEqual([]);
    expect(firefox.browser.executablePath).toBe("/usr/bin/chromium");
    expect(firefox.warnings[0]).toMatch(/firefox/i);
    expect(() => resolveLoginBrowser({}, probeFor({ platform: "linux", xdg: "firefox.desktop\n" }))).toThrow(/Google Chrome/);
  });
});
