type Level = "info" | "warn" | "error" | "debug";

export function log(
  level: Level,
  message: string,
  data?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level,
      message,
      ts: new Date().toISOString(),
      ...data,
    }),
  );
}
