import { describe, expect, it } from "vitest";
import { excerpt, outline, renderMarkdown } from "@/lib/markdown";
import { diffLines, diffStats } from "@/lib/text-diff";

describe("markdown rendering", () => {
  it("renders headings with unique anchors, paragraphs and inline formatting", () => {
    const html = renderMarkdown("# Downtime\n## Steps\n## Steps\nCall **x2210** then *wait* for `ack`.\nNext line ~~old~~");
    expect(html).toContain('<h1 id="downtime">Downtime</h1>');
    expect(html).toContain('<h2 id="steps">Steps</h2>');
    expect(html).toContain('<h2 id="steps-1">Steps</h2>');
    expect(html).toContain("<p>Call <strong>x2210</strong> then <em>wait</em> for <code>ack</code>.<br>Next line <del>old</del></p>");
  });

  it("renders lists, nesting, checklists, tables, callouts and code", () => {
    const html = renderMarkdown(
      ["1. First", "2. Second", "   - nested", "", "- [x] Done", "- [ ] Todo", "", "| Host | IP |", "|---|--:|", "| dc01 | 10.0.0.10 |", "", "> [!WARNING] Do not reboot", "> during clinics", "", "```bash", "echo <hi>", "```"].join("\n"),
    );
    expect(html).toContain("<ol><li>First</li><li>Second<ul><li>nested</li></ul></li></ol>");
    expect(html).toContain('<li class="task"><input type="checkbox" disabled checked> Done</li>');
    expect(html).toContain('<td style="text-align:right">10.0.0.10</td>');
    expect(html).toMatch(/<div class="callout callout-warning"><p class="callout-title">Warning<\/p><p>Do not reboot<br>during clinics<\/p><\/div>/);
    expect(html).toContain('<pre><code data-lang="bash">echo &lt;hi&gt;</code></pre>');
  });

  it("escapes raw HTML and refuses unsafe link schemes", () => {
    const evil = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[click](javascript:alert(1)) [x](//evil.example) [ok](https://a.example/?q=1&r=2 "t")\n[q](https://a.example/"onmouseover="alert(1))');
    expect(evil).not.toMatch(/<script|<img|href="javascript|href="\/\/evil|onmouseover="/);
    expect(evil).toContain("&lt;script&gt;");
    expect(evil).toContain("<br>click"); // text kept, unsafe link dropped
    expect(evil).toContain('href="https://a.example/&quot;onmouseover=&quot;alert(1"'); // quote stays inside the attribute
    expect(renderMarkdown("[home](/kb) and https://intranet.example/x.")).toContain('<a href="/kb">home</a> and <a href="https://intranet.example/x" target="_blank" rel="noopener noreferrer">https://intranet.example/x</a>.');
  });

  it("keeps snake_case and code intact", () => {
    expect(renderMarkdown("set max_retry_count and `a*b*c`")).toBe("<p>set max_retry_count and <code>a*b*c</code></p>");
  });

  it("builds an outline and plain excerpt", () => {
    expect(outline("# A & B\ntext\n## C")).toEqual([{ level: 1, text: "A & B", id: "a-b" }, { level: 2, text: "C", id: "c" }]);
    expect(excerpt("# Title\n- **Bold** [link](https://x)\n```\ncode\n```\nend", 40)).toBe("Title Bold link end");
  });
});

describe("line diff", () => {
  it("finds added, removed and unchanged lines", () => {
    const d = diffLines("a\nb\nc\nd", "a\nc\nd\ne");
    expect(d.map((l) => `${l.type[0]}${l.text}`)).toEqual(["sa", "db", "sc", "sd", "ae"]);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
  });

  it("handles identical and empty texts", () => {
    expect(diffStats(diffLines("x\ny", "x\ny"))).toEqual({ added: 0, removed: 0 });
    expect(diffLines("", "new").map((l) => l.type)).toEqual(["del", "add"]);
  });
});
