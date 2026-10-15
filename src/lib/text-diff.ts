/** Line-based diff (LCS) for comparing article versions. */

export type DiffLine = { type: "same" | "add" | "del"; text: string; a?: number; b?: number };

const MAX_CELLS = 4_000_000; // beyond this the changed middle is shown as replaced wholesale

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, "\n").split("\n");
  const b = after.replace(/\r\n?/g, "\n").split("\n");
  // Trim the common head and tail first; edits are usually local
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ type: "same", text: a[i], a: i + 1, b: i + 1 });

  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);
  const n = ma.length;
  const m = mb.length;
  if (n * m > MAX_CELLS) {
    ma.forEach((t, i) => out.push({ type: "del", text: t, a: start + i + 1 }));
    mb.forEach((t, j) => out.push({ type: "add", text: t, b: start + j + 1 }));
  } else {
    // dp[i][j] = LCS length of ma[i..] and mb[j..], stored flat
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) dp[i * w + j] = ma[i] === mb[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ma[i] === mb[j]) {
        out.push({ type: "same", text: ma[i], a: start + i + 1, b: start + j + 1 });
        i++;
        j++;
      } else if (i < n && (j === m || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) {
        // Removals before additions when both are possible, so a changed line reads old → new
        out.push({ type: "del", text: ma[i], a: start + i + 1 });
        i++;
      } else {
        out.push({ type: "add", text: mb[j], b: start + j + 1 });
        j++;
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) out.push({ type: "same", text: a[endA + k], a: endA + k + 1, b: endB + k + 1 });
  return out;
}

export function diffStats(d: DiffLine[]) {
  return { added: d.filter((l) => l.type === "add").length, removed: d.filter((l) => l.type === "del").length };
}
