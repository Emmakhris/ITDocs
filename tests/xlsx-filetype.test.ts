import { describe, expect, it } from "vitest";
import { buildXlsx, crc32, zipStored } from "@/server/lib/xlsx";
import { sniffFile } from "@/server/lib/filetype";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Reads a stored zip back via its central directory, checking CRCs. */
function unzip(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(buf.slice(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + v.getUint16(local + 26, true);
    const data = buf.slice(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    out[name] = dec.decode(data);
    p += 46 + nameLen;
  }
  return out;
}

describe("xlsx writer", () => {
  it("computes standard CRC-32", () => {
    expect(crc32(enc.encode("123456789")).toString(16)).toBe("cbf43926");
  });

  it("round-trips a stored zip", () => {
    const z = zipStored([{ name: "a.txt", data: enc.encode("hello") }, { name: "dir/b.txt", data: enc.encode("wörld") }]);
    expect(unzip(z)).toEqual({ "a.txt": "hello", "dir/b.txt": "wörld" });
  });

  it("writes a workbook with typed cells and no formulas", () => {
    const x = unzip(buildXlsx("Assets: 2026/Q4", ["Tag", "Cost", "Ok", "When"], [["=HYPERLINK(\"evil\")", 12.5, true, new Date(2026, 0, 2, 3, 4)], ["<b>&\u0001", null, false, null]]));
    expect(Object.keys(x).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(x["xl/workbook.xml"]).toContain('name="Assets  2026 Q4"');
    const sheet = x["xl/worksheets/sheet1.xml"];
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;evil&quot;)</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>12.5</v></c>');
    expect(sheet).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(sheet).toMatch(/<c r="D2" s="2"><v>46024\.12\d*<\/v><\/c>/);
    expect(sheet).toContain("&lt;b&gt;&amp;</t>");
    expect(sheet).toContain('<autoFilter ref="A1:D3"/>');
  });
});

describe("file sniffing", () => {
  it("identifies by content, not by name", () => {
    expect(sniffFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "x.pdf").mime).toBe("image/png");
    expect(sniffFile(enc.encode("%PDF-1.7\n")).kind).toBe("pdf");
    expect(sniffFile(enc.encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')).kind).toBe("svg");
    expect(sniffFile(enc.encode('<mxfile host="app.diagrams.net"><diagram/></mxfile>')).kind).toBe("drawio");
    expect(sniffFile(enc.encode("<html><script>alert(1)</script>"), "plan.png").kind).toBe("other");
  });
});
