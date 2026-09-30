import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({receive:null as null|((m:unknown)=>Promise<void>),warn:vi.fn(),disk:vi.fn(),panel:vi.fn(),rollback:vi.fn(),mutations:vi.fn(),diff:vi.fn(),owner:{} as Record<string,any>}));
vi.mock("../changes/disk",()=>({matchesRecordedFile:m.disk}));
vi.mock("vscode",()=>({env:{language:"en"},ViewColumn:{Active:1},workspace:{getConfiguration:()=>({get:()=>"en"})},window:{showWarningMessage:m.warn,createWebviewPanel:m.panel}}));
vi.mock("../state/runtime",()=>({rt:m.owner,bindRuntime:(f:unknown)=>f}));
vi.mock("../common/chatPanelState",()=>({chatPanelState:()=>({})}));
import {openChanges} from "../ui/changes";
const snapshot={sessionId:"s",currentTurn:3,availableRollbackTurns:[0,1,2],files:[],turns:[1,2,3].map(turnId=>({turnId,mutations:[]}))};
beforeEach(()=>{vi.clearAllMocks();m.disk.mockResolvedValue(true);m.mutations.mockResolvedValue(snapshot);m.diff.mockImplementation(async (_:unknown,turn:number)=>({entries:[{path:"a",operation:"modify",beforeText:String(turn-1),afterText:String(turn),beforeHash:String(turn-1),afterHash:String(turn),isBinary:false,bytesChanged:true}]}));m.warn.mockResolvedValue("Rollback");m.owner.sessionManager={state:"idle",mutations:m.mutations,diff:m.diff,rollback:m.rollback};m.owner.currentSessionId="s";m.owner.extensionContext={subscriptions:[]};m.panel.mockReturnValue({onDidDispose:vi.fn(),dispose:vi.fn(),webview:{html:"",postMessage:vi.fn(),onDidReceiveMessage:(f:typeof m.receive)=>{m.receive=f;}}});});
describe("rollback host guards",()=>{
 it("previews turns after target and still confirms the revert shortcut",async()=>{await openChanges(true,"to 1 revert",vi.fn());expect(m.diff.mock.calls.map(c=>c[1])).toEqual([2,3]);expect(m.rollback).not.toHaveBeenCalled();await m.receive!({type:"rollback",revert:true,indices:[0,99]});expect(m.warn).toHaveBeenCalled();expect(m.rollback).toHaveBeenCalledWith(1,true,["a"]);});
 it("cancellation does not mutate",async()=>{m.warn.mockResolvedValue(undefined);await openChanges(true,"last 1",vi.fn());await m.receive!({type:"rollback",revert:false});expect(m.rollback).not.toHaveBeenCalled();});
 it("revalidates after confirmation before discarding anything",async()=>{await openChanges(true,"last 1",vi.fn());m.mutations.mockResolvedValue({...snapshot,currentTurn:4});await m.receive!({type:"rollback",revert:true,indices:[0]});expect(m.rollback).not.toHaveBeenCalled();});
 it("refuses to overwrite a file edited outside recorded history",async()=>{await openChanges(true,"to 1",vi.fn());m.disk.mockResolvedValue(false);await m.receive!({type:"rollback",revert:true,indices:[0]});expect(m.rollback).not.toHaveBeenCalled();});
 it("blocks a running or switched session",async()=>{await openChanges(true,"to 1",vi.fn());m.owner.sessionManager.state="running";await m.receive!({type:"rollback",revert:true,indices:[0]});expect(m.rollback).not.toHaveBeenCalled();m.owner.currentSessionId="other";await m.receive!({type:"rollback",revert:false});expect(m.rollback).not.toHaveBeenCalled();});
});
