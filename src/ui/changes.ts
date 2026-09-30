import { matchesRecordedFile } from "../changes/disk";
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { rt, bindRuntime } from "../state/runtime";
import { resolveUiLanguage } from "../common/i18n";
import { chatPanelState } from "../common/chatPanelState";
import { foldDiffs, rollbackTarget, reverseDiff } from "../changes/model";
import { changesHtml } from "../changes/view";
import type { DiffEntry, MutationsSnapshot } from "../acp/types";

export async function openChanges(rollback: boolean, arg: string | undefined, openEntry: (entry: DiffEntry, title: string) => Promise<unknown>): Promise<void> {
  const manager=rt.sessionManager, sessionId=rt.currentSessionId;
  if (!manager || !sessionId) return;
  const zh=resolveUiLanguage(vscode.workspace.getConfiguration("chrys").get<string>("ui.language"),vscode.env.language)==="zh-CN";
  const t=(en:string,cn:string)=>zh?cn:en;
  const valid=()=>rt.sessionManager===manager && rt.currentSessionId===sessionId && manager.state==="idle";
  if(rollback && !valid()) { await vscode.window.showWarningMessage(t("Wait for the current task to finish before rollback.","请等待当前任务结束后再回滚。")); return; }
  let snapshot=await manager.mutations();
  let turn=rollback?rollbackTarget(arg,snapshot.currentTurn):undefined;
  if(rollback){
    turn ??= [...snapshot.availableRollbackTurns].filter(v=>v<snapshot.currentTurn).sort((a,b)=>b-a)[0];
    if(turn===undefined || !snapshot.availableRollbackTurns.includes(turn)) throw new Error(t("No snapshot at that rollback target.","该回滚目标没有可用快照。"));
  }
  let entries:DiffEntry[]=[],revision="",busy=false,disposed=false;
  const panel=vscode.window.createWebviewPanel("chrys.changes",rollback?t("iCode · Rollback","iCode · 回滚"):t("iCode · Changes","iCode · 变更"),vscode.ViewColumn.Active,{enableScripts:true,localResourceRoots:[]});
  const signature=(value:MutationsSnapshot)=>JSON.stringify(value);
  const refresh=async()=>{
    snapshot=await manager.mutations();
    if(rollback && !snapshot.availableRollbackTurns.includes(turn!)) throw new Error(t("Rollback snapshot expired; reopen Rollback.","回滚快照已失效，请重新打开回滚。"));
    if(rollback){
      const periods=snapshot.turns.filter(v=>turn===0 || v.turnId>turn!).sort((a,b)=>a.turnId-b.turnId);
      const deltas=await Promise.all(periods.map(v=>manager.diff(undefined,v.turnId).then(d=>d.entries)));
      const excluded=new Set(periods.flatMap((period,i)=>period.mutations.filter(m=>m.beforeSkip || m.afterSkip || m.provenance==="foreign" || m.contested || !deltas[i].some(e=>e.path===m.path)).flatMap(m=>[m.path,...(m.oldPath?[m.oldPath]:[])])));
      entries=foldDiffs(deltas).filter(e=>!excluded.has(e.path));
    }else entries=(await manager.diff(undefined,turn)).entries;
    revision=signature(snapshot);
    if(!disposed) panel.webview.html=changesHtml(snapshot,entries,turn,rollback,zh,randomBytes(16).toString("hex"), /(?:revert|--revert|-r)$/.test(arg ?? ""));
  };
  panel.onDidDispose(()=>{disposed=true;});
  panel.webview.onDidReceiveMessage(bindRuntime(async (msg:{type:string;turn?:string;index?:number;indices?:number[];revert?:boolean})=>{
    if(disposed || busy) return;
    busy=true;
    void panel.webview.postMessage({type:"status",busy:true});
    try{
      if(rt.sessionManager!==manager || rt.currentSessionId!==sessionId) throw new Error(t("Session changed. Reopen this view.","会话已变化，请重新打开此视图。"));
      if(msg.type==="close"){panel.dispose();return;}
      if(msg.type==="period"){
        const value=msg.turn===""?undefined:Number(msg.turn);
        const allowed=rollback?snapshot.availableRollbackTurns:snapshot.turns.map(v=>v.turnId);
        if(value!==undefined && (!Number.isInteger(value)||!allowed.includes(value))) return;
        if(rollback && value===undefined)return;
        turn=value;await refresh();
      }else if(msg.type==="refresh") await refresh();
      else if(msg.type==="open" && Number.isInteger(msg.index) && entries[msg.index!]) await openEntry(rollback?reverseDiff(entries[msg.index!]):entries[msg.index!],rollback?"iCode Rollback Preview":"iCode Diff");
      else if(msg.type==="rollback" && rollback && turn!==undefined){
        if(!valid())throw new Error(t("Task is busy; rollback is blocked.","任务运行中，不能回滚。"));
        const paths=Array.isArray(msg.indices)?[...new Set(msg.indices)].filter(i=>Number.isInteger(i)&&entries[i]&&!entries[i].contested).map(i=>entries[i].path):[];
        const revert=msg.revert===true && paths.length>0;
        const confirm=t("Rollback","回滚");
        const answer=await vscode.window.showWarningMessage(t(`Keep ${turn} turns and discard the rest?`,`保留前 ${turn} 轮并丢弃后续对话？`),{modal:true,detail:revert?t(`Revert ${paths.length} selected file(s). Backend safety exclusions still apply.`,`还原 ${paths.length} 个选中文件。后端仍会执行安全排除检查。`):t("Conversation only; files remain unchanged.","仅回滚对话，保留文件。")},confirm);
        if(answer!==confirm)return;
        if(!valid() || revision!==signature(await manager.mutations())){await refresh();throw new Error(t("Session changed since preview. Review the refreshed changes and confirm again.","预览后会话发生变化，请检查已刷新的改动并重新确认。"));}
        if(revert){
          const selected=entries.filter(entry=>paths.includes(entry.path));
          if(!(await Promise.all(selected.map(matchesRecordedFile))).every(Boolean))throw new Error(t("Files changed outside the recorded history. Review those edits before reverting files.","文件存在记录之外的改动，请检查这些改动后再还原文件。"));
        }
        if(!valid())throw new Error(t("Session became busy; rollback was cancelled.","会话已开始运行，本次回滚已取消。"));
        await manager.rollback(turn,revert,revert?paths:[]);
        rt.chatPanel?.setState(chatPanelState());panel.dispose();
      }
    }catch(error){if(!disposed)void panel.webview.postMessage({type:"status",busy:false,error:String(error)});return;}
    finally{busy=false;}
    if(!disposed)void panel.webview.postMessage({type:"status",busy:false});
  }));
  rt.extensionContext?.subscriptions.push(panel);
  try{await refresh();}catch(error){panel.dispose();throw error;}
}
