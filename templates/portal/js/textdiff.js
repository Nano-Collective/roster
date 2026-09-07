/* A unified diff between two strings, in the format `renderDiff` already parses.
 *
 * Editing a layer changes a file, but what you meant to change is the composed prompt, and
 * those are not the same thing: a line added to one fragment can land three times or not at
 * all. Showing the file diff would answer a question nobody asked.
 *
 * There is no git here, so the diff is computed in the page. Plain LCS: these are a few
 * hundred lines of prose, and anything cleverer would be solving a problem this does not have.
 */

export function unifiedDiff(before, after, name, context = 3) {
  const a = String(before).split("\n");
  const b = String(after).split("\n");
  const ops = lcsOps(a, b);
  if (!ops.some((o) => o.op !== " ")) return "";

  /* Only the neighbourhood of a change is worth printing. A whole 400-line prompt with six
     lines highlighted is not a diff, it is the prompt again. */
  const keep = new Set();
  ops.forEach((o, i) => {
    if (o.op === " ") return;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) {
      keep.add(j);
    }
  });

  const out = ["diff --git a/" + name + " b/" + name];
  let i = 0;
  let oldNo = 1;
  let newNo = 1;
  // Walk once, emitting a hunk each time the kept region starts again.
  const lineNos = ops.map((o) => {
    const at = { old: oldNo, new: newNo };
    if (o.op !== "+") oldNo++;
    if (o.op !== "-") newNo++;
    return at;
  });

  while (i < ops.length) {
    if (!keep.has(i)) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < ops.length && keep.has(end + 1)) end++;
    const rows = ops.slice(i, end + 1);
    const oldCount = rows.filter((o) => o.op !== "+").length;
    const newCount = rows.filter((o) => o.op !== "-").length;
    out.push(`@@ -${lineNos[i].old},${oldCount} +${lineNos[i].new},${newCount} @@`);
    for (const row of rows) out.push(row.op + row.text);
    i = end + 1;
  }
  return out.join("\n");
}

/** Longest common subsequence, as a flat list of ` `, `-` and `+` rows. */
function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const grid = new Uint32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      grid[at(i, j)] =
        a[i] === b[j]
          ? grid[at(i + 1, j + 1)] + 1
          : Math.max(grid[at(i + 1, j)], grid[at(i, j + 1)]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: " ", text: a[i] });
      i++;
      j++;
    } else if (grid[at(i + 1, j)] >= grid[at(i, j + 1)]) {
      ops.push({ op: "-", text: a[i++] });
    } else {
      ops.push({ op: "+", text: b[j++] });
    }
  }
  while (i < n) ops.push({ op: "-", text: a[i++] });
  while (j < m) ops.push({ op: "+", text: b[j++] });
  return ops;
}

/** How much moved, for a one-line summary beside the commit. */
export function diffStat(before, after) {
  const ops = lcsOps(String(before).split("\n"), String(after).split("\n"));
  return {
    added: ops.filter((o) => o.op === "+").length,
    removed: ops.filter((o) => o.op === "-").length,
  };
}
