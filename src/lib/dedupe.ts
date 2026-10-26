import type { RawLead } from "@/types/lead";

/**
 * A stable identity for a business across imports, so re-importing an
 * export updates the existing lead instead of creating a duplicate.
 *
 * Preference order:
 *  1. Trustpilot review slug (`tp:`), the business's own domain.
 *  2. Google Maps feature id (`gm:fid:`), the `!1s0x…:0x…` segment, which
 *     survives zoom/viewport changes in the URL.
 *  3. Google Maps `cid` (`gm:cid:`).
 *  4. The normalised Maps URL (`gm:url:`).
 */
export function dedupeKey(raw: Pick<RawLead, "mapsUrl" | "trustpilotUrl">): string {
  const tp = raw.trustpilotUrl ? trustpilotSlug(raw.trustpilotUrl) : null;
  if (tp) return `tp:${tp}`;

  const fid = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(raw.mapsUrl);
  if (fid) return `gm:fid:${fid[1].toLowerCase()}`;

  const url = parseUrl(raw.mapsUrl);
  const cid = url?.searchParams.get("cid");
  if (cid && /^\d+$/.test(cid)) return `gm:cid:${cid}`;

  return `gm:url:${url ? normaliseUrl(url) : raw.mapsUrl.trim().toLowerCase()}`;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function trustpilotSlug(value: string): string | null {
  const url = parseUrl(value);
  if (!url) return null;
  const match = /^\/review\/([^/?#]+)/i.exec(url.pathname);
  if (!match) return null;
  return decodeURIComponent(match[1]).toLowerCase().replace(/^www\./, "");
}

const TRACKING_PARAM = /^(utm_.+|gclid|fbclid|hl|gl|entry|g_ep|authuser)$/i;

function normaliseUrl(url: URL): string {
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}${query}`;
}
