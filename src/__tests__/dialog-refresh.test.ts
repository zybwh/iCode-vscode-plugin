// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { setApprovalDialogState, setAskUserDialogState, setInlineDialogState } from "../chat/webview/components/dialogs";
import type { ChatAskUserDialogState, ChatInlineDialogState } from "../chat/panel";
import { state } from "../chat/webview/state";
const host={postMessage:vi.fn()};
beforeEach(()=>{document.body.innerHTML="";host.postMessage.mockClear();state.uiLanguage="zh-CN";});
function mount(body:string){const element=document.createElement('div');element.className='hidden';element.innerHTML=body;document.body.append(element);return element;}
it("retains an approval reason for repeated snapshots but resets for the next request",()=>{
  const dialog=mount('<h2 class="tui-modal-title"></h2><div class="tui-modal-subtitle"></div><div class="approval-dialog-body"></div><div class="approval-dialog-actions"></div>');
  const snapshot={requestId:'one',title:'Approval',subtitle:'',detail:'Run command',reasonEnabled:true,options:[{optionId:'yes',kind:'allow_once' as const,name:'Allow'}]};
  setApprovalDialogState(snapshot,dialog,host);
  dialog.querySelector<HTMLTextAreaElement>('.approval-reason')!.value='my draft';
  setApprovalDialogState({...snapshot},dialog,host);
  expect(dialog.querySelector<HTMLTextAreaElement>('.approval-reason')!.value).toBe('my draft');
  setApprovalDialogState({...snapshot,requestId:'two'},dialog,host);
  expect(dialog.querySelector<HTMLTextAreaElement>('.approval-reason')!.value).toBe('');
});
it("retains AskUser answers on a repeated snapshot and clears them after cancellation",()=>{
  const dialog=mount('<h2 class="tui-modal-title"></h2><div class="tui-modal-subtitle"></div><div class="askuser-tabs"></div><div class="askuser-question"></div><div class="askuser-options"></div><textarea class="askuser-response"></textarea><button class="askuser-submit"></button><button class="askuser-cancel"></button><button class="askuser-previous"></button><button class="askuser-next"></button>');
  const snapshot:ChatAskUserDialogState={requestId:'one',title:'Question',subtitle:'',questions:[{question:'Explain?',options:[]}],responsePlaceholder:'answer',notePlaceholder:'note',reviewLabel:'Review',reviewTitle:'Review',editLabel:'Edit',unansweredLabel:'Empty',submitLabel:'Submit',previousLabel:'Previous',nextLabel:'Next',skipLabel:'Skip'};
  setAskUserDialogState(snapshot,dialog,host);
  const input=dialog.querySelector<HTMLTextAreaElement>('.askuser-response')!;input.value='unfinished answer';input.dispatchEvent(new Event('input'));
  setAskUserDialogState({...snapshot},dialog,host);
  expect(input.value).toBe('unfinished answer');
  dialog.querySelector<HTMLButtonElement>('.askuser-submit')!.click();
  dialog.querySelector<HTMLButtonElement>('.askuser-submit')!.click();
  expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'askUserDialogResponse',answers:[{values:['unfinished answer'],note:''}]}));
  setAskUserDialogState({...snapshot,requestId:'two'},dialog,host);
  expect(input.value).toBe('');
});
it("retains session selection on refresh, searches full paths, and cannot act on hidden selections",()=>{
  const dialog=mount('<section role="dialog"><h2 class="tui-modal-title"></h2><div class="tui-modal-subtitle"></div><div class="tui-modal-actions"><button>Close</button></div><div class="inline-dialog-body"></div><div class="inline-dialog-footer"></div></section>');
  const snapshot:ChatInlineDialogState={kind:'sessions',title:'Sessions',subtitle:'',sessions:[{sessionId:'aaaa1111',title:'First',cwd:'/projects/one'},{sessionId:'bbbb2222',title:'Second',cwd:'/projects/two'}]};
  setInlineDialogState(snapshot,dialog,host);
  dialog.querySelector<HTMLElement>('[data-inline-id="aaaa1111"]')!.click();
  setInlineDialogState(snapshot,dialog,host);
  expect(dialog.querySelector('[data-inline-id="aaaa1111"]')!.classList.contains('selected')).toBe(true);
  const search=dialog.querySelector<HTMLInputElement>('[type="search"]')!;search.value='/projects/two';search.dispatchEvent(new Event('input'));
  expect(dialog.querySelector<HTMLElement>('[data-inline-id="aaaa1111"]')!.hidden).toBe(true);
  expect(dialog.querySelector<HTMLButtonElement>('[data-inline-footer-action="delete"]')!.disabled).toBe(true);
  setInlineDialogState(snapshot,dialog,host);
  expect(dialog.querySelector<HTMLInputElement>('[type="search"]')!.value).toBe('/projects/two');
  dialog.querySelector<HTMLElement>('[data-inline-id="bbbb2222"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));
  expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'inlineDialogAction',action:'resumeSession',id:'bbbb2222',cwd:'/projects/two'}));
});
