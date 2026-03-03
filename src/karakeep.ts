import { config } from "./config.js";

export interface BookmarkResult {
  ok: boolean;
  error?: string;
}

export async function isAlreadyBookmarked(url: string): Promise<boolean> {
  const u = new URL(url);
  u.hash = "";
  const normalizedUrl = u.toString();
  try {
    const res = await fetch(
      `${config.karakeepApiUrl}/bookmarks/check-url?url=${encodeURIComponent(normalizedUrl)}`,
      { headers: { Authorization: `Bearer ${config.karakeepApiKey}` } },
    );
    if (!res.ok) return false; // fail open: don't block submission on API errors
    const data = (await res.json()) as { bookmarkId: string | null };
    return data.bookmarkId !== null;
  } catch {
    return false; // fail open
  }
}

export async function submitBookmark(
  url: string,
  note?: string,
): Promise<BookmarkResult> {
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
        ...(note ? { note } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { ok: false, error: `HTTP ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
