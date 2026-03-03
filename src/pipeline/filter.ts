import { config } from "../config.js";

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

export function filterByDomain(url: string): FilterResult {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { passed: false, reason: "invalid URL" };
  }

  const blocked = config.blockedDomains.find(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );

  if (blocked) {
    return { passed: false, reason: `domain ${hostname} is blocked` };
  }

  return { passed: true };
}
