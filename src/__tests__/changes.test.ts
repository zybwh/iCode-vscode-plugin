import {describe,it,expect} from "vitest";
import {diffLines,foldDiffs,rollbackTarget} from "../changes/model";
import {changesHtml} from "../changes/view";
import type {DiffEntry} from "../acp/types";
const entry=(before:string,after:string):DiffEntry=>({path:"/src/a.ts",operation:"modify",beforeHash:before,afterHash:after,beforeText:before,afterText:after,isBinary:false,bytesChanged:true});
describe("changes and rollback ranges",()=>{
 it("distinguishes last N from absolute target and rejects malformed destructive arguments",()=>{
  expect(rollbackTarget("2 revert",5)).toBe(3);expect(rollbackTarget("last 2",5)).toBe(3);expect(rollbackTarget("to 2 revert",5)).toBe(2);expect(rollbackTarget("to 0",5)).toBe(0);
  for(const bad of ["bad","to -1","0","6","to 9","1 ignored"] )expect(()=>rollbackTarget(bad,5)).toThrow();
 });
 it("folds every discarded turn and retains provenance",()=>{
  expect(foldDiffs([[{...entry("a","b"),contested:true}],[entry("b","c")]])).toEqual([{...entry("a","c"),contested:true,inferred:undefined}]);
  expect(foldDiffs([[entry("a","b")],[entry("b","a")]])).toEqual([]);
 });
 it("preserves both sources with insertions and deletions",()=>{
  const before="first\nremoved\nlast",after="first\nadded\nlast";
  const lines=diffLines(before,after);
  expect(lines.filter(l=>l.kind!=="add").map(l=>l.text).join("\n")).toBe(before);
  expect(lines.filter(l=>l.kind!=="remove").map(l=>l.text).join("\n")).toBe(after);
  expect(lines.find(l=>l.kind==="add")).toMatchObject({after:2});
 });
 it("escapes file content, reverses rollback preview, and disables contested files",()=>{
  const html=changesHtml({sessionId:"s",currentTurn:2,turns:[],files:[],availableRollbackTurns:[0,1]},[{...entry("before","<script>after</script>"),contested:true}],1,true,true,"test");
  expect(html).toContain('data-excluded="true"');expect(html).not.toContain('<script>after');expect(html).toContain('&lt;script&gt;after');expect(html).toMatch(/line remove[^]*?after/);expect(html).toContain("保留至");
 });
});

describe("rollback external edit protection",()=>{
 it("compares actual bytes to the recorded snapshot and handles deletion",async()=>{
  const fs=await import("node:fs/promises"),os=await import("node:os"),path=await import("node:path"),crypto=await import("node:crypto");
  const {matchesRecordedFile}=await import("../changes/disk");
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"icode-rollback-"));const file=path.join(directory,"fixture.txt");
  try{
   await fs.writeFile(file,"recorded");const snapshot={...entry("before","recorded"),path:file,afterHash:crypto.createHash("sha256").update("recorded").digest("hex")};
   expect(await matchesRecordedFile(snapshot)).toBe(true);await fs.writeFile(file,"external edit");expect(await matchesRecordedFile(snapshot)).toBe(false);
   await fs.unlink(file);expect(await matchesRecordedFile(snapshot)).toBe(false);expect(await matchesRecordedFile({...snapshot,afterHash:null})).toBe(true);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
 });
});
