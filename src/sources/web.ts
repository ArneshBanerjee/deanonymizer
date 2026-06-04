/**
 * Shallow link-follower for external sites declared in platform profile
 * fields (e.g. GitHub `blog`, Stack Overflow `website_url`). Pulls one page,
 * strips it to text, and hands it back as raw content for the analyzer.
 *
 * Deliberately not a crawler: single hop, text/* only, 10s timeout, 2 MB
 * size cap, errors swallowed. JS-rendered sites won't work without a
 * headless browser — out of scope here.
 */

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const UA = "deanonymizer/0.1 (privacy self-audit; link-follower)";

/** Coerce user-supplied blog fields like "datavorous.github.io" → a URL. */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function extractText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>(?!\n)/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchAndExtractText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)/i.test(ct)) return null;

    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return extractText(text);
    }
    let received = 0;
    const chunks: Uint8Array[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        chunks.push(value);
        if (received >= MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return extractText(buf.toString("utf8"));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
