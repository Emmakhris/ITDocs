import { describe, expect, it } from "vitest";
import { cidrsOverlap, compareIp, findOverlap, formatIp, inRange, inSubnet, isHostAddress, nextFreeIp, parseCidr, parseIp } from "@/server/lib/ip";

describe("IPv4 parsing", () => {
  it("parses and formats dotted quads", () => {
    expect(parseIp("10.0.0.1")).toBe(167772161);
    expect(parseIp("255.255.255.255")).toBe(4294967295);
    expect(formatIp(167772161)).toBe("10.0.0.1");
    expect(formatIp(4294967295)).toBe("255.255.255.255");
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["10.0.0", "10.0.0.256", "10.0.0.01", "a.b.c.d", "10.0.0.1/24", "", " 1.2.3.4.5"]) expect(parseIp(bad)).toBeNull();
  });

  it("sorts numerically, not lexically", () => {
    expect(["10.0.0.10", "10.0.0.9", "10.0.0.100"].sort(compareIp)).toEqual(["10.0.0.9", "10.0.0.10", "10.0.0.100"]);
  });
});

describe("CIDR parsing", () => {
  it("computes network facts", () => {
    const c = parseCidr("192.168.10.0/24");
    expect(c).toMatchObject({ cidr: "192.168.10.0/24", prefix: 24, size: 256, mask: "255.255.255.0" });
    expect(formatIp(c.firstHost)).toBe("192.168.10.1");
    expect(formatIp(c.lastHost)).toBe("192.168.10.254");
    expect(formatIp(c.broadcast)).toBe("192.168.10.255");
  });

  it("handles /31, /32 and /0", () => {
    const p2p = parseCidr("10.0.0.0/31");
    expect([formatIp(p2p.firstHost), formatIp(p2p.lastHost)]).toEqual(["10.0.0.0", "10.0.0.1"]);
    expect(parseCidr("10.1.1.1/32").size).toBe(1);
    expect(parseCidr("0.0.0.0/0").mask).toBe("0.0.0.0");
  });

  it("rejects host bits with a suggestion, and garbage", () => {
    expect(() => parseCidr("10.20.0.5/24")).toThrow(/10\.20\.0\.0\/24/);
    for (const bad of ["10.0.0.0", "10.0.0.0/33", "10.0.0.0/", "10.0.0.0/24/1", "nope/8"]) expect(() => parseCidr(bad)).toThrow();
  });
});

describe("membership and ranges", () => {
  it("validates address-in-subnet", () => {
    expect(inSubnet("10.0.5.200", "10.0.4.0/23")).toBe(true);
    expect(inSubnet("10.0.6.1", "10.0.4.0/23")).toBe(false);
    expect(inSubnet("junk", "10.0.4.0/23")).toBe(false);
    expect(isHostAddress("10.0.4.0", "10.0.4.0/23")).toBe(false); // network
    expect(isHostAddress("10.0.5.255", "10.0.4.0/23")).toBe(false); // broadcast
    expect(isHostAddress("10.0.5.254", "10.0.4.0/23")).toBe(true);
  });

  it("checks inclusive ranges", () => {
    expect(inRange("10.0.0.100", "10.0.0.100", "10.0.0.200")).toBe(true);
    expect(inRange("10.0.0.201", "10.0.0.100", "10.0.0.200")).toBe(false);
    expect(inRange("10.0.0.150", null, "10.0.0.200")).toBe(false);
  });
});

describe("overlap detection", () => {
  it("detects containment and partial overlap", () => {
    expect(cidrsOverlap("10.0.0.0/16", "10.0.42.0/24")).toBe(true);
    expect(cidrsOverlap("10.0.42.0/24", "10.0.0.0/16")).toBe(true);
    expect(cidrsOverlap("10.0.0.0/24", "10.0.0.0/24")).toBe(true);
    expect(cidrsOverlap("10.0.0.0/24", "10.0.1.0/24")).toBe(false); // adjacent
    expect(cidrsOverlap("10.0.0.0/23", "10.0.1.0/24")).toBe(true);
  });

  it("finds the conflicting subnet", () => {
    const existing = [{ id: "a", cidr: "10.10.0.0/24" }, { id: "b", cidr: "10.20.0.0/22" }];
    expect(findOverlap("10.20.3.0/24", existing)?.id).toBe("b");
    expect(findOverlap("10.30.0.0/24", existing)).toBeUndefined();
  });
});

describe("next free IP", () => {
  it("skips used addresses, gateway and the DHCP pool", () => {
    const opts = { gateway: "10.0.0.1", dhcpStart: "10.0.0.4", dhcpEnd: "10.0.0.250" };
    expect(nextFreeIp("10.0.0.0/24", [], opts)).toBe("10.0.0.2");
    expect(nextFreeIp("10.0.0.0/24", ["10.0.0.2", "10.0.0.3"], opts)).toBe("10.0.0.251");
  });

  it("returns null when the subnet is full", () => {
    expect(nextFreeIp("10.0.0.0/30", ["10.0.0.1", "10.0.0.2"])).toBeNull();
    expect(nextFreeIp("10.0.0.0/30", ["10.0.0.1"])).toBe("10.0.0.2");
  });
});
