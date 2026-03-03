import { load } from "cheerio";
import { config } from "../config.js";

export interface UrlMetadata {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  ogType?: string;
  keywords?: string;
  fetchFailed: boolean;
}

export async function fetchMetadata(url: string): Promise<UrlMetadata> {
  const domain = new URL(url).hostname;
  const base: UrlMetadata = { url, domain, fetchFailed: true };

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return base;

    const $ = load(await res.text());
    return {
      url,
      domain,
      fetchFailed: false,
      title:
        $("title").first().text().trim() ||
        $('meta[property="og:title"]').attr("content")?.trim(),
      description:
        $('meta[name="description"]').attr("content")?.trim() ||
        $('meta[property="og:description"]').attr("content")?.trim(),
      ogType: $('meta[property="og:type"]').attr("content")?.trim(),
      keywords: $('meta[name="keywords"]').attr("content")?.trim(),
    };
  } catch {
    return base;
  }
}
