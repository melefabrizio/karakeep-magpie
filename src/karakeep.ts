import { config } from "./config.js";

export interface BookmarkResult {
  ok: boolean;
  error?: string;
}

export async function submitBookmark(url: string, tags: string[]): Promise<BookmarkResult> {
  try {
    const res = await fetch(`${config.karakeepApiUrl}/bookmarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.karakeepApiKey}`,
      },
      body: JSON.stringify({
        type: "link",
        url,
        tags: tags?.map((name) => ({ name })),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { ok: false, error: `HTTP ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
