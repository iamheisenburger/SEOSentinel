"use node";

import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ALLOWED_CONTENT_TYPES = [
  /^text\/(?:html|plain|css)(?:;|$)/i,
  /^application\/(?:xhtml\+xml|json|manifest\+json)(?:;|$)/i,
];

type ResolvedAddress = { address: string; family: number };

export type SafePublicTextOptions = {
  expectedHost?: string;
  sameHostRedirects?: boolean;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
  allowedContentTypes?: RegExp[];
  headers?: Record<string, string>;
};

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function ipv6Hextets(address: string): number[] | null {
  let normalized = address.toLowerCase();
  if (normalized.includes("%")) return null;

  const dottedSuffix = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedSuffix) {
    const octets = dottedSuffix.split(".").map(Number);
    if (
      octets.length !== 4 ||
      octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) return null;
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${(
      (octets[2] << 8) |
      octets[3]
    ).toString(16)}`;
    normalized = normalized.slice(0, -dottedSuffix.length) + replacement;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const omitted = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (omitted < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const raw = [...left, ...Array.from({ length: omitted }, () => "0"), ...right];
  if (raw.length !== 8 || raw.some((part) => !/^[a-f0-9]{1,4}$/.test(part))) {
    return null;
  }
  return raw.map((part) => Number.parseInt(part, 16));
}

function isNativeGlobalUnicastV6(address: string): boolean {
  const hextets = ipv6Hextets(address);
  if (!hextets) return false;
  const [first, second] = hextets;

  // Public native IPv6 is currently allocated from 2000::/3. Everything else
  // (ULA, link/site-local, multicast, loopback, IPv4-compatible/mapped, NAT64,
  // and unallocated space) is rejected rather than blocklisted piecemeal.
  if (first < 0x2000 || first > 0x3fff) return false;

  // IETF special-purpose/transition ranges inside 2000::/3 are not ordinary
  // globally routed destinations and can tunnel an IPv4 target.
  if (first === 0x2001 && second <= 0x01ff) return false; // includes Teredo/ORCHID/benchmarking
  if (first === 0x2001 && second === 0x0db8) return false; // documentation
  if (first === 0x2002) return false; // 6to4 embeds IPv4
  if (first === 0x3ffe) return false; // retired 6bone
  if (first === 0x3fff && second <= 0x0fff) return false; // documentation 3fff::/20

  // ISATAP embeds an IPv4 address in the interface identifier even when the
  // outer prefix looks globally routed.
  if (
    (hextets[4] === 0x0000 || hextets[4] === 0x0200) &&
    hextets[5] === 0x5efe
  ) return false;

  return true;
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;
    const [a, b, c] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(normalized) === 6) {
    return !isNativeGlobalUnicastV6(normalized);
  }
  return true;
}

async function resolvePinnedPublicUrl(
  input: string,
  expectedHost?: string,
): Promise<{ url: URL; address: ResolvedAddress }> {
  const candidate = /^https?:\/\//i.test(input.trim())
    ? input.trim()
    : `https://${input.trim()}`;
  const url = new URL(candidate);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    hostname === "localhost" ||
    hostname === "localhost.localdomain" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (expectedHost && normalizedHost(hostname) !== normalizedHost(expectedHost))
  ) {
    throw new Error("Outbound URL is not an allowed public HTTPS destination");
  }

  const literalFamily = isIP(hostname);
  const addresses: ResolvedAddress[] = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateOrReservedAddress(address))
  ) {
    throw new Error("Outbound URL resolves to a private or reserved address");
  }
  url.hash = "";
  return { url, address: addresses[0] };
}

/** Validate a public HTTPS URL. Fetches must still use safeFetchPublicText so
 * the resolved address is pinned to the actual socket and cannot DNS-rebind. */
export async function validatePublicHttpsUrl(
  input: string,
  expectedHost?: string,
): Promise<URL> {
  return (await resolvePinnedPublicUrl(input, expectedHost)).url;
}

function requestPinnedText(
  target: { url: URL; address: ResolvedAddress },
  options: Required<Pick<SafePublicTextOptions, "maxBytes" | "timeoutMs">> &
    SafePublicTextOptions,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: "https:",
        hostname: target.url.hostname,
        servername: target.url.hostname,
        port: 443,
        method: "GET",
        path: `${target.url.pathname}${target.url.search}`,
        headers: {
          "User-Agent": "Pentra/1.0 (content research)",
          Accept: "text/html,text/plain,application/xhtml+xml,application/json,text/css",
          "Accept-Encoding": "identity",
          ...options.headers,
        },
        lookup: (_hostname, _lookupOptions, callback) => {
          callback(null, target.address.address, target.address.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (declaredLength > options.maxBytes) {
          response.destroy();
          reject(new Error("Outbound response is too large"));
          return;
        }

        const redirect = status >= 300 && status < 400;
        const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
        if (
          !redirect &&
          !options.allowedContentTypes!.some((pattern) => pattern.test(contentType))
        ) {
          response.destroy();
          reject(new Error(`Unsupported outbound content type: ${contentType || "missing"}`));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.byteLength;
          if (total > options.maxBytes) {
            response.destroy(new Error("Outbound response exceeded the size limit"));
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () => {
          resolve({
            status,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );
    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error("Outbound request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetch untrusted public text with a DNS-pinned TLS socket. Every redirect is
 * separately parsed, resolved, checked, and pinned before another connection.
 */
export async function safeFetchPublicText(
  input: string,
  options: SafePublicTextOptions = {},
): Promise<{ url: string; text: string }> {
  const maxRedirects = options.maxRedirects ?? 3;
  const requestOptions = {
    ...options,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    allowedContentTypes: options.allowedContentTypes ?? DEFAULT_ALLOWED_CONTENT_TYPES,
  };
  let target = await resolvePinnedPublicUrl(input, options.expectedHost);
  const originalHost = target.url.hostname;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await requestPinnedText(target, requestOptions);
    if (response.status >= 300 && response.status < 400) {
      const locationHeader = response.headers.location;
      const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
      if (!location || redirectCount === maxRedirects) {
        throw new Error("Unsafe or excessive redirect chain");
      }
      const redirected = new URL(location, target.url);
      target = await resolvePinnedPublicUrl(
        redirected.href,
        options.sameHostRedirects ? originalHost : options.expectedHost,
      );
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Outbound page returned HTTP ${response.status}`);
    }
    return { url: target.url.href, text: response.text };
  }
  throw new Error("Outbound redirect limit exceeded");
}
