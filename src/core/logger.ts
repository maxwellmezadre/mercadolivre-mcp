import { appendFileSync } from "node:fs";

// Diagnostics logger (NFR-3/NFR-4): ALWAYS stderr — stdout is reserved for the
// MCP JSON-RPC stream. Optional file sink via MERCADOLIVRE_LOG_FILE. Secrets
// (cookie values) never reach a log line: every message is redacted. The
// `secrets` array is shared by reference, so the session store can append
// cookie values after the logger exists.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Logger = Record<LogLevel, (message: string) => void>;

export function redactSecrets(
  message: string,
  secrets: readonly string[],
): string {
  let output = message;
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join("***");
  }
  return output;
}

export function createLogger(opts: {
  logFile?: string;
  secrets?: readonly string[];
  /** Where lines go; defaults to stderr. Injectable for tests. */
  sink?: (line: string) => void;
}): Logger {
  const secrets = opts.secrets ?? [];
  const sink =
    opts.sink ??
    ((line: string) => {
      process.stderr.write(line);
    });

  const emit = (level: LogLevel, message: string) => {
    const line = `[${level}] ${redactSecrets(message, secrets)}\n`;
    sink(line);
    if (opts.logFile) {
      try {
        appendFileSync(opts.logFile, line);
      } catch {
        // Logging must never take the process down.
      }
    }
  };

  return {
    debug: (message) => emit("debug", message),
    info: (message) => emit("info", message),
    warn: (message) => emit("warn", message),
    error: (message) => emit("error", message),
  };
}
