import * as vscode from "vscode";
export interface TextAttachment { id: string; label: string; text: string }
let sequence=0;
export function attachment(label:string,text:string):TextAttachment{return {id:`context-${Date.now()}-${++sequence}`,label,text};}
export function editorAttachment():TextAttachment|undefined {
  const editor=vscode.window.activeTextEditor;if(!editor)return;
  const selection=editor.selection;
  const range=selection.isEmpty?new vscode.Range(Math.max(0,selection.active.line-25),0,Math.min(editor.document.lineCount-1,selection.active.line+25),Number.MAX_SAFE_INTEGER):selection;
  const label=`${vscode.workspace.asRelativePath(editor.document.uri)}:${range.start.line+1}-${range.end.line+1}`;
  const text=editor.document.getText(range);
  return attachment(label,`@file ${label}\n${text.slice(0,120000)}${text.length>120000?"\n[truncated / 已截断]":""}`);
}
export function problemsAttachment():TextAttachment {
  const lines:string[]=[];
  for(const [uri,diagnostics] of vscode.languages.getDiagnostics())for(const d of diagnostics){
    if(lines.length>=200)break;
    lines.push(`${vscode.workspace.asRelativePath(uri)}:${d.range.start.line+1}:${d.range.start.character+1} [${["error","warning","information","hint"][d.severity]}] ${d.source??""} ${d.message}`);
  }
  return attachment(`Problems (${lines.length}${lines.length===200?"+":""})`, `@problems\n${lines.join("\n")||"No diagnostics / 无诊断"}${lines.length===200?"\n[First 200 / 前 200 条]":""}`);
}
