import type { DiffEntry } from "../acp/types";

/** Explicit syntax: a bare count removes the last N turns; `to N` keeps N. */
export function rollbackTarget(arg: string | undefined, current: number): number | undefined {
  const raw = (arg ?? "").trim().toLowerCase();
  if (!raw) return undefined;
  const match = /^(?:(to|last)\s+)?(\d+)(?:\s+(?:revert|--revert|-r))?$/.exec(raw);
  if (!match) throw new Error("Usage: /rollback [last N | to N] [revert]");
  const n = Number(match[2]);
  const target = match[1] === "to" ? n : current - n;
  if (!Number.isSafeInteger(n) || target < 0 || target > current || (match[1] !== "to" && n === 0)) throw new Error("Invalid rollback range / 回滚范围无效");
  return target;
}

/** Fold chronologically ordered turn deltas, not the diff of the target turn. */
export function foldDiffs(turns: DiffEntry[][]): DiffEntry[] {
  const files = new Map<string, DiffEntry>();
  for (const entries of turns) for (const entry of entries) {
    const previous = files.get(entry.path);
    files.set(entry.path, previous ? { ...entry, beforeText: previous.beforeText, beforeHash: previous.beforeHash,
      contested: previous.contested || entry.contested, inferred: previous.inferred || entry.inferred,
      isBinary: previous.isBinary || entry.isBinary } : { ...entry });
  }
  return [...files.values()].filter(e => e.beforeHash !== e.afterHash || e.beforeText !== e.afterText).map(e => ({ ...e,
    operation: !e.beforeHash ? "create" : !e.afterHash ? "delete" : "modify" }));
}

export type DiffLine = { kind: "same" | "add" | "remove"; text: string; before?: number; after?: number };
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : [], b = after ? after.split("\n") : [];
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length-1-suffix] === b[b.length-1-suffix]) suffix++;
  const x = a.slice(prefix, a.length-suffix), y = b.slice(prefix, b.length-suffix);
  const result: DiffLine[] = a.slice(0,prefix).map((text,i) => ({kind:"same",text,before:i+1,after:i+1}));
  let i=0,j=0;
  const table = (x.length+1) * (y.length+1) <= 2_000_000 ? Array.from({length:x.length+1}, () => new Uint32Array(y.length+1)) : undefined;
  if (table) for (let k=x.length-1;k>=0;k--) for (let l=y.length-1;l>=0;l--) table[k][l]=x[k]===y[l]?1+table[k+1][l+1]:Math.max(table[k+1][l],table[k][l+1]);
  while (i<x.length || j<y.length) {
    if (table && i<x.length && j<y.length && x[i]===y[j]) result.push({kind:"same",text:x[i++],before:prefix+i,after:prefix+(++j)});
    else if (i<x.length && (!table || j===y.length || table[i+1][j]>=table[i][j+1])) result.push({kind:"remove",text:x[i++],before:prefix+i});
    else result.push({kind:"add",text:y[j++],after:prefix+j});
  }
  for(let k=0;k<suffix;k++) result.push({kind:"same",text:a[a.length-suffix+k],before:a.length-suffix+k+1,after:b.length-suffix+k+1});
  return result;
}

export function splitDiffRows(lines: DiffLine[]): {left?: DiffLine; right?: DiffLine}[] {
  const result:{left?:DiffLine;right?:DiffLine}[]=[];
  for(let index=0;index<lines.length;){
    if(lines[index].kind==="same"){result.push({left:lines[index],right:lines[index++]});continue;}
    const left:DiffLine[]=[],right:DiffLine[]=[];
    while(index<lines.length && lines[index].kind!=="same"){const line=lines[index++];(line.kind==="remove"?left:right).push(line);}
    for(let i=0;i<Math.max(left.length,right.length);i++)result.push({left:left[i],right:right[i]});
  }
  return result;
}

export function reverseDiff(entry:DiffEntry):DiffEntry {
  return {...entry,beforeText:entry.afterText,afterText:entry.beforeText,beforeHash:entry.afterHash,afterHash:entry.beforeHash,
    operation:entry.operation==="create"?"delete":entry.operation==="delete"?"create":entry.operation};
}
