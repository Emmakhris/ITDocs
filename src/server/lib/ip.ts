/** IPv4 helpers for IPAM. Pure functions (no DB) so they can be unit-tested and used anywhere. */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** "10.0.0.1" → 167772161, or null when not a valid dotted-quad (no leading zeros). */
export function parseIp(s: string): number | null {
  const m = IPV4.exec(s.trim());
  if (!m) return null;
  let n = 0;
  for (const part of m.slice(1)) {
    if (part.length > 1 && part.startsWith("0")) return null;
    const o = Number(part);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

export function formatIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export type Cidr = {
  /** Normalised "a.b.c.d/p" */
  cidr: string;
  prefix: number;
  network: number;
  broadcast: number;
  size: number;
  /** First and last host addresses (network/broadcast excluded except for /31 and /32) */
  firstHost: number;
  lastHost: number;
  mask: string;
};

function build(network: number, prefix: number): Cidr {
  const size = 2 ** (32 - prefix);
  const broadcast = network + size - 1;
  const pointToPoint = prefix >= 31;
  const maskN = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return {
    cidr: `${formatIp(network)}/${prefix}`,
    prefix,
    network,
    broadcast,
    size,
    firstHost: pointToPoint ? network : network + 1,
    lastHost: pointToPoint ? broadcast : broadcast - 1,
    mask: formatIp(maskN),
  };
}

/**
 * Parse "10.20.0.0/24". Throws a readable error for bad input, including host bits set
 * ("10.20.0.5/24" → suggests 10.20.0.0/24) so a typo can't silently become another range.
 */
export function parseCidr(s: string): Cidr {
  const [ip, p, ...rest] = s.trim().split("/");
  const n = parseIp(ip ?? "");
  if (n === null || rest.length || p === undefined || !/^\d{1,2}$/.test(p)) throw new Error("Enter a network in CIDR form, e.g. 10.20.0.0/24.");
  const prefix = Number(p);
  if (prefix > 32) throw new Error("Prefix length must be between 0 and 32.");
  const size = 2 ** (32 - prefix);
  const network = n - (n % size);
  if (network !== n) throw new Error(`Host bits are set — did you mean ${formatIp(network)}/${prefix}?`);
  return build(network, prefix);
}

export function tryParseCidr(s: string): Cidr | null {
  try {
    return parseCidr(s);
  } catch {
    return null;
  }
}

/** Is the address inside the subnet (network and broadcast included)? */
export function inSubnet(ip: string | number, subnet: Cidr | string): boolean {
  const n = typeof ip === "number" ? ip : parseIp(ip);
  const c = typeof subnet === "string" ? parseCidr(subnet) : subnet;
  return n !== null && n >= c.network && n <= c.broadcast;
}

/** Is the address a usable host address of the subnet (not the network or broadcast address)? */
export function isHostAddress(ip: string | number, subnet: Cidr | string): boolean {
  const n = typeof ip === "number" ? ip : parseIp(ip);
  const c = typeof subnet === "string" ? parseCidr(subnet) : subnet;
  return n !== null && n >= c.firstHost && n <= c.lastHost;
}

export function cidrsOverlap(a: Cidr | string, b: Cidr | string): boolean {
  const x = typeof a === "string" ? parseCidr(a) : a;
  const y = typeof b === "string" ? parseCidr(b) : b;
  return x.network <= y.broadcast && y.network <= x.broadcast;
}

/** First existing CIDR that overlaps `cidr`, or undefined. */
export function findOverlap<T extends { cidr: string }>(cidr: Cidr | string, existing: T[]): T | undefined {
  return existing.find((e) => cidrsOverlap(cidr, e.cidr));
}

/** Inclusive address range check; open-ended when start or end is missing. */
export function inRange(ip: string | number, start?: string | null, end?: string | null): boolean {
  const n = typeof ip === "number" ? ip : parseIp(ip);
  const s = start ? parseIp(start) : null;
  const e = end ? parseIp(end) : null;
  if (n === null || s === null || e === null) return false;
  return n >= s && n <= e;
}

/**
 * Lowest free host address in the subnet, skipping `used`, the gateway and the DHCP pool.
 * Returns null when the subnet is full.
 */
export function nextFreeIp(
  subnet: Cidr | string,
  used: Iterable<string>,
  opts: { gateway?: string | null; dhcpStart?: string | null; dhcpEnd?: string | null } = {},
): string | null {
  const c = typeof subnet === "string" ? parseCidr(subnet) : subnet;
  const taken = new Set<number>();
  for (const u of used) {
    const n = parseIp(u);
    if (n !== null) taken.add(n);
  }
  const gw = opts.gateway ? parseIp(opts.gateway) : null;
  const ds = opts.dhcpStart ? parseIp(opts.dhcpStart) : null;
  const de = opts.dhcpEnd ? parseIp(opts.dhcpEnd) : null;
  for (let n = c.firstHost; n <= c.lastHost; n++) {
    if (taken.has(n) || n === gw) continue;
    if (ds !== null && de !== null && n >= ds && n <= de) {
      n = de; // jump past the pool
      continue;
    }
    return formatIp(n);
  }
  return null;
}

/** Sort comparator for dotted-quad strings. */
export function compareIp(a: string, b: string): number {
  return (parseIp(a) ?? 0) - (parseIp(b) ?? 0);
}
