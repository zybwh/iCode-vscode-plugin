import { objectValue } from "../../../common/utils";
import { el } from "../helpers";

type Section = { key: string; en: string; zh: string; example: Record<string, unknown> };
const sections: Section[] = [
  { key: "model", en: "Model binding", zh: "模型绑定", example: { profile_id: "" } },
  { key: "tools", en: "Tools and web", zh: "工具与网络", example: { builtins: ["filesystem.read", "search", "shell"], mcp: [] } },
  { key: "approval", en: "Tool approval rules", zh: "工具审批规则", example: { default: "auto", overrides: {} } },
  { key: "sub_agents", en: "Sub-agents", zh: "子智能体", example: { max_total_concurrency: 3, agents: [] } },
  { key: "skills", en: "Skills", zh: "技能", example: { paths: [], inline: [], auto_load_user_agents_skills: true, auto_load_cwd_agents_skills: true } },
  { key: "memory", en: "Memory files", zh: "记忆文件", example: { files: ["AGENTS.md"], folders: [] } },
  { key: "compaction", en: "Context compaction", zh: "上下文压缩", example: { last_words_template: "", last_words_max_output_tokens: 20000, phase4_side_call_token_budget: -1 } },
  { key: "acp", en: "External ACP agent", zh: "外部 ACP 智能体", example: { command: "example-agent", args: ["acp"], result_mode: "last_segment" } },
];

type Field = { key: string; en: string; zh: string; kind?: "number" | "boolean" | "lines" | "text" | "json"; choices?: string[] };
const fields: Record<string, Field[]> = {
  model: [{ key:"profile_id",en:"Model profile ID (empty: active model)",zh:"模型配置 ID（留空使用当前模型）" }],
  tools: [{key:"builtins",en:"Built-in tools (one per line)",zh:"内置工具（每行一个）",kind:"lines"},{key:"custom",en:"Custom tools",zh:"自定义工具",kind:"lines"}],
  approval: [{key:"default",en:"Default rule",zh:"默认规则",choices:["auto","require","skip"]},{key:"user_can_override",en:"Allow user override",zh:"允许用户覆盖",kind:"boolean"}],
  sub_agents: [{key:"max_total_concurrency",en:"Total concurrency",zh:"总并发数",kind:"number"}],
  skills: [{key:"paths",en:"Skill paths (one per line)",zh:"技能路径（每行一个）",kind:"lines"},{key:"script_timeout",en:"Script timeout (s)",zh:"脚本超时（秒）",kind:"number"},{key:"script_extensions",en:"Script extensions",zh:"脚本扩展名",kind:"lines"},{key:"auto_load_user_agents_skills",en:"Load user skills",zh:"加载用户技能",kind:"boolean"},{key:"auto_load_cwd_agents_skills",en:"Load workspace skills",zh:"加载工作区技能",kind:"boolean"}],
  memory: [{key:"files",en:"Memory files (one per line)",zh:"记忆文件（每行一个）",kind:"lines"},{key:"folders",en:"Memory folders (one per line)",zh:"记忆目录（每行一个）",kind:"lines"}],
  compaction: [{key:"last_words_template",en:"Last words supplement",zh:"压缩总结补充指令",kind:"text"},{key:"last_words_max_output_tokens",en:"Last words output budget",zh:"压缩总结输出预算",kind:"number"},{key:"phase4_side_call_token_budget",en:"Phase 4 budget (-1: unlimited)",zh:"阶段 4 预算（-1 不限）",kind:"number"}],
  acp: [{key:"command",en:"Command",zh:"命令"},{key:"args",en:"Arguments (one per line)",zh:"参数（每行一个）",kind:"lines"},{key:"cwd",en:"Working directory",zh:"工作目录"},{key:"allow_external_cwd",en:"Allow external directory",zh:"允许外部目录",kind:"boolean"},{key:"session_mode",en:"Session mode",zh:"会话模式"},{key:"model_id",en:"Model ID",zh:"模型 ID"},{key:"best_effort_options",en:"Best-effort configuration options",zh:"尽力应用配置选项",kind:"boolean"},{key:"result_mode",en:"Result mode",zh:"结果模式",choices:["last_segment","transcript"]},{key:"handshake_timeout_seconds",en:"Handshake timeout (s)",zh:"握手超时（秒）",kind:"number"},{key:"idle_timeout_seconds",en:"Idle timeout (s)",zh:"空闲超时（秒）",kind:"number"}],
};
const mcpFields: Field[] = [{key:"name",en:"Name",zh:"名称"},{key:"transport",en:"Transport",zh:"传输",choices:["stdio","http"]},{key:"command",en:"Command",zh:"命令"},{key:"args",en:"Arguments",zh:"参数",kind:"lines"},{key:"url",en:"URL",zh:"URL"},{key:"enabled",en:"Enabled",zh:"启用",kind:"boolean"},{key:"allowed_tools",en:"Allowed tools",zh:"允许工具",kind:"lines"},{key:"request_timeout",en:"Timeout (s)",zh:"超时（秒）",kind:"number"}];
const childFields: Field[] = [{key:"profile",en:"Profile",zh:"配置名称"},{key:"tool_name",en:"Tool name",zh:"工具名称"},{key:"tool_description",en:"Tool description",zh:"工具描述"},{key:"max_concurrency",en:"Concurrency",zh:"并发数",kind:"number"}];
mcpFields.push(
  {key:"description",en:"Description",zh:"描述",kind:"text"},
  {key:"encoding",en:"Process encoding",zh:"进程编码"},
  {key:"tool_name_prefix",en:"Tool name prefix",zh:"工具名前缀"},
  {key:"resolve_header_templates",en:"Resolve header templates",zh:"解析请求头模板",kind:"boolean"},
  {key:"terminate_on_close",en:"Terminate on close",zh:"关闭时终止",kind:"boolean"},
  {key:"verify_ssl",en:"Verify TLS certificates",zh:"校验 TLS 证书",kind:"boolean"},
  {key:"bypass_proxy",en:"Bypass proxy",zh:"绕过代理",kind:"boolean"},
  {key:"load_prompts",en:"Load prompts",zh:"加载提示词",kind:"boolean"},
  {key:"expose_instructions",en:"Expose server instructions",zh:"提供服务器指令",kind:"boolean"},
  {key:"use_progressive_disclosure",en:"Progressive tool loading",zh:"渐进加载工具",kind:"boolean"},
  {key:"always_load",en:"Initially loaded tools",zh:"初始加载工具",kind:"lines"},
  {key:"max_tool_result_tokens",en:"Tool result token limit",zh:"工具结果 Token 上限",kind:"number"},
);
const skillFields: Field[] = [{key:"name",en:"Name",zh:"名称"},{key:"description",en:"Description",zh:"描述",kind:"text"},{key:"instructions",en:"Instructions",zh:"指令",kind:"text"}];
const providerFields: Field[] = [
  {key:"type",en:"Adapter",zh:"适配器",choices:["exa_mcp","bing_html","duckduckgo_html","tavily","brave","exa","custom_http"]},
  {key:"api_key_env",en:"API key environment variable",zh:"API 密钥环境变量"},
  {key:"preset",en:"Custom HTTP preset",zh:"自定义 HTTP 预设",choices:["searxng","serpapi"]},
  {key:"endpoint",en:"Endpoint",zh:"服务地址"},{key:"method",en:"HTTP method",zh:"HTTP 方法",choices:["GET","POST"]},
];
function guidedFields(section: string, editor: HTMLTextAreaElement, chinese: boolean): HTMLElement {
  const text=(en:string,zh:string)=>chinese?zh:en;
  const form=el("div",{class:"agent-guided-fields"});
  const read=()=>{ const value=editor.value.trim()?JSON.parse(editor.value):{};if(!objectValue(value))throw new Error(text("Section must be an object","分区必须为对象"));return value as Record<string,unknown>;};
  const modify=(change:(value:Record<string,unknown>)=>void)=>{
    try{const value=read();change(value);editor.value=JSON.stringify(value,null,2);editor.setCustomValidity("");editor.dispatchEvent(new CustomEvent("agent-section-updated",{detail:form,bubbles:true}));}
    catch{editor.setCustomValidity(text("Fix the advanced JSON before editing fields.","请先修复高级 JSON 再编辑字段。"));editor.reportValidity();}
  };
  const input=(f:Field,value:unknown,set:(v:unknown)=>void)=>{
    const control=f.choices||f.kind==="boolean"?el("select",{},el("option",{value:""},text("Backend default","后端默认")),...(f.choices??["true","false"]).map(v=>el("option",{value:v},f.kind==="boolean"?text(v==="true"?"Enabled":"Disabled",v==="true"?"启用":"禁用"):v))):(f.kind==="lines"||f.kind==="text"||f.kind==="json")?el("textarea",{rows:"3"}):el("input",{type:f.kind==="number"?"number":"text"});
    const element=control as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
    element.dataset.field=f.key;
    if(f.choices && value!==undefined && !f.choices.includes(String(value))) element.append(el("option",{value:String(value)},String(value)));
    element.value=f.kind==="json" && value!==undefined?JSON.stringify(value,null,2):Array.isArray(value)?value.join("\n"):value===undefined||value===null?"":String(value);

    element.addEventListener("change",()=>{
      const raw=element.value;
      try {
        const next=raw===""?undefined:f.kind==="json"?JSON.parse(raw):f.kind==="boolean"?raw==="true":f.kind==="number"?Number(raw):f.kind==="lines"?raw.split(/\r?\n/).filter(Boolean):raw;
        if(f.kind==="number" && next!==undefined && !Number.isFinite(next))throw new Error();
        element.setCustomValidity("");set(next);
      } catch { element.setCustomValidity(text("Enter a valid value.","请输入有效值。"));element.reportValidity(); }
    });
    return el("label",{},text(f.en,f.zh),control);
  };
  type Path = (string | number)[];
  const at=(obj:Record<string,unknown>,path:Path):Record<string,unknown>=>{
    let node: unknown=obj;
    for(const key of path){
      const record=node as Record<string|number,unknown>;
      if(!Object.hasOwn(record,key))Object.defineProperty(record,key,{value:{},enumerable:true,writable:true,configurable:true});
      if(!record[key] || typeof record[key]!=="object")throw new Error("Invalid nested configuration");
      node=record[key];
    }
    return node as Record<string,unknown>;
  };
  const mapEditor=(path:Path,title:string,typed=false)=>{
    const card=el("fieldset",{"data-map":path.join("."),class:"agent-map"},el("legend",{},title));
    const current=JSON.parse(JSON.stringify(read())) as Record<string,unknown>;
    let entries:Record<string,unknown>;
    try{entries=at(current,path);}catch{return el("p",{},text("Use advanced JSON to repair this mapping.","请在高级 JSON 中修复此映射。"));}
    for(const [name,value] of Object.entries(entries)){
      const row=el("div",{class:"agent-map-row"});
      let boolean=typed && typeof value==="boolean";
      const control=el("input",{type:"text","aria-label":name}) as HTMLInputElement;
      control.value=String(value);control.dataset.mapValue=name;
      const save=()=>{
        if(boolean && !["true","false"].includes(control.value)){control.setCustomValidity(text("Use true or false.","请输入 true 或 false。"));return;}
        control.setCustomValidity("");modify(obj=>{at(obj,path)[name]=boolean?control.value==="true":control.value;});
      };
      control.addEventListener("change",save);
      row.append(el("label",{},name,control));
      if(typed){
        const type=el("select",{"aria-label":text("Value type","值类型")},el("option",{value:"string"},text("Text","文本")),el("option",{value:"boolean"},text("Boolean","布尔值"))) as HTMLSelectElement;
        type.value=boolean?"boolean":"string";
        type.onchange=()=>{boolean=type.value==="boolean";save();};row.append(type);
      }
      const remove=el("button",{type:"button","aria-label":text(`Remove ${name}`,`移除 ${name}`)},text("Remove","移除"));
      remove.onclick=()=>{modify(obj=>{delete at(obj,path)[name];});draw();};row.append(remove);card.append(row);
    }
    const name=el("input",{placeholder:text("New key","新增键名"),"aria-label":text("New key","新增键名")}) as HTMLInputElement;
    const add=el("button",{type:"button"},text("Add","添加"));
    add.onclick=()=>{
      const key=name.value.trim();
      if(!key || ["__proto__","constructor","prototype"].includes(key) || Object.hasOwn(entries,key)){
        name.setCustomValidity(text("Use a unique, non-empty key.","请输入不重复的有效键名。"));name.reportValidity();return;
      }
      name.setCustomValidity("");modify(obj=>{at(obj,path)[key]="";});draw();
    };
    name.oninput=()=>name.setCustomValidity("");card.append(name,add);return card;
  };
  const draw=()=>{
    form.replaceChildren();let value:Record<string,unknown>;try{value=read();}catch{return;}
    for(const f of fields[section]??[])form.append(input(f,value[f.key],v=>modify(obj=>{if(v===undefined)delete obj[f.key];else obj[f.key]=v;})));
    if(section==="tools")for(const [key,title,nested] of [
      ["shell_filter",text("Shell filter","Shell 过滤"),[{key:"preset",en:"Preset",zh:"预设",choices:["read_only","unrestricted"]},{key:"mode",en:"Mode",zh:"模式",choices:["whitelist","blacklist"]},{key:"commands",en:"Commands",zh:"命令",kind:"lines"},{key:"allow_redirections",en:"Allow redirections",zh:"允许重定向",kind:"boolean"},{key:"allow_subshells",en:"Allow subshells",zh:"允许子 Shell",kind:"boolean"}]],
      ["web_search",text("Web search","网络搜索"),[{key:"mode",en:"Mode",zh:"模式",choices:["off","auto","provider"]},{key:"provider",en:"Provider",zh:"提供商"},{key:"fallback_chain",en:"Fallback providers (ordered)",zh:"备用提供商（按顺序）",kind:"lines"},{key:"num_results",en:"Result count",zh:"结果数",kind:"number"},{key:"timeout_seconds",en:"Timeout (s)",zh:"超时（秒）",kind:"number"}]],
      ["web_fetch",text("Web fetch","网页读取"),[{key:"mode",en:"Mode",zh:"模式",choices:["off","on"]},{key:"max_tokens",en:"Maximum tokens",zh:"最大 Token 数",kind:"number"},{key:"timeout_seconds",en:"Timeout (s)",zh:"超时（秒）",kind:"number"}]],
    ] as [string,string,Field[]][]){
      const card=el("fieldset",{},el("legend",{},title));
      const current=objectValue(value[key])??{};
      for(const f of nested)card.append(input(f,current[f.key],v=>modify(obj=>{const next=objectValue(obj[key])??{};if(v===undefined)delete next[f.key];else next[f.key]=v;obj[key]=next;})));
      form.append(card);
    }
    if(section==="approval"){
      const key="overrides";
      const card=el("fieldset",{},el("legend",{},text("Per-tool approval","逐工具审批规则")));
      const entries=objectValue(value[key])??{};
      for(const [name,v] of Object.entries(entries)){
        card.append(input({key:name,en:name,zh:name,choices:["auto","require","skip"]},v,next=>modify(obj=>{const record=objectValue(obj[key])??{};if(next===undefined)delete record[name];else record[name]=next;obj[key]=record;})));
      }
      const name=el("input",{placeholder:text("Tool name","工具名")}) as HTMLInputElement;
      const add=el("button",{type:"button"},text("Add","添加"));add.onclick=()=>{const label=name.value.trim();if(!label || ["__proto__","constructor","prototype"].includes(label))return;modify(obj=>{obj[key]={...(objectValue(obj[key])??{}),[label]:"require"};});draw();};
      card.append(name,add);form.append(card);
    }
    if(section==="acp"){
      form.append(el("p",{class:"agent-config-note"},text(
        "An external ACP profile is sub-agent-only. Its instructions, tools, Skills, memory, compaction, model binding and approval configuration are managed by the external agent; iCode discards those local sections on save.",
        "外部 ACP 配置仅用于子智能体。指令、工具、技能、记忆、压缩、模型绑定和审批由外部智能体管理；iCode 保存时会清除这些本地分区配置。")));
      form.append(mapEditor(["env"],text("Environment","环境变量")),mapEditor(["config_options"],text("Configuration options","配置选项"),true));
      const remove=el("button",{type:"button"},text("Remove external ACP configuration","移除外部 ACP 配置"));
      remove.onclick=()=>{editor.value="";editor.setCustomValidity("");editor.dispatchEvent(new Event("change",{bubbles:true}));};form.append(remove);
    }
    const arrayKey=section==="mcp"?"mcp":section==="sub_agents"?"agents":section==="skills"?"inline":undefined;
    if(arrayKey){
      const rows=Array.isArray(value[arrayKey])?value[arrayKey] as Record<string,unknown>[]:[];
      rows.forEach((entry,index)=>{
        if(!objectValue(entry))return;
        const card=el("fieldset",{},el("legend",{},`${text(arrayKey==="mcp"?"MCP server":arrayKey==="inline"?"Inline skill":"Sub-agent",arrayKey==="mcp"?"MCP 服务器":arrayKey==="inline"?"内联技能":"子智能体")} ${index+1}`));
        for(const f of arrayKey==="mcp"?mcpFields:arrayKey==="inline"?skillFields:childFields)card.append(input(f,entry[f.key],v=>modify(obj=>{const list=obj[arrayKey] as Record<string,unknown>[];if(v===undefined)delete list[index][f.key];else list[index][f.key]=v;})));
        if(arrayKey==="mcp"){
          card.append(mapEditor([arrayKey,index,"headers"],text("HTTP headers","HTTP 请求头")),mapEditor([arrayKey,index,"env"],text("Process environment","进程环境变量")));
          const empty=el("button",{type:"button"},text("Expose no tools (empty allow-list)","不暴露工具（空允许列表）"));
          empty.onclick=()=>{modify(obj=>{const server=(obj[arrayKey] as Record<string,unknown>[])[index];server.allowed_tools=[];server.use_progressive_disclosure=false;server.always_load=[];});draw();};card.append(empty);
          if(Array.isArray(entry.allowed_tools)&&entry.allowed_tools.length===0)card.append(el("span",{},text("No tools exposed","不暴露任何工具")));
        }
        if(arrayKey==="inline")for(const kind of ["resources","scripts"]){
          const group=el("fieldset",{"data-skill-items":kind},el("legend",{},text(kind==="resources"?"Resources":"Scripts",kind==="resources"?"资源":"脚本")));
          const items=Array.isArray(entry[kind])?entry[kind] as Record<string,unknown>[]:[];
          items.forEach((item,itemIndex)=>{
            const row=el("fieldset",{},el("legend",{},`${text(kind==="resources"?"Resource":"Script",kind==="resources"?"资源":"脚本")} ${itemIndex+1}`));
            const itemFields:Field[]=[{key:"name",en:"Name",zh:"名称"},{key:"description",en:"Description",zh:"描述"},{key:"path",en:"Path",zh:"路径"},...(kind==="resources"?[{key:"content",en:"Content",zh:"内容",kind:"text"} as Field]:[])];
            for(const f of itemFields)row.append(input(f,item[f.key],v=>modify(obj=>{const target=at(obj,[arrayKey,index,kind,itemIndex]);if(v===undefined)delete target[f.key];else target[f.key]=v;})));
            const remove=el("button",{type:"button"},text("Remove","移除"));remove.onclick=()=>{modify(obj=>{(at(obj,[arrayKey,index])[kind] as unknown[]).splice(itemIndex,1);});draw();};row.append(remove);group.append(row);
          });
          const add=el("button",{type:"button"},text(kind==="resources"?"Add resource":"Add script",kind==="resources"?"添加资源":"添加脚本"));
          add.onclick=()=>{modify(obj=>{const skill=at(obj,[arrayKey,index]);const list=Array.isArray(skill[kind])?skill[kind] as unknown[]:[];list.push({name:"",path:""});skill[kind]=list;});draw();};group.append(add);card.append(group);
        }
        const remove=el("button",{type:"button"},text("Remove","移除"));remove.onclick=()=>{modify(obj=>(obj[arrayKey] as unknown[]).splice(index,1));draw();};card.append(remove);form.append(card);
      });
      const add=el("button",{type:"button"},text(arrayKey==="mcp"?"Add MCP server":arrayKey==="inline"?"Add inline skill":"Add sub-agent",arrayKey==="mcp"?"添加 MCP 服务器":arrayKey==="inline"?"添加内联技能":"添加子智能体"));add.onclick=()=>{modify(obj=>{const list=Array.isArray(obj[arrayKey])?obj[arrayKey] as unknown[]:[];list.push(arrayKey==="mcp"?{name:"",transport:"stdio",command:"",enabled:true}:arrayKey==="inline"?{name:"",instructions:""}:{profile:"",max_concurrency:3});obj[arrayKey]=list;});draw();};form.append(add);
    }
    if(section==="tools"){
      const providers=objectValue(objectValue(value.web_search)?.providers)??{};
      const group=el("fieldset",{class:"agent-providers"},el("legend",{},text("Search providers","搜索提供商")));
      for(const [id,raw] of Object.entries(providers)){
        const provider=objectValue(raw);if(!provider)continue;
        const card=el("fieldset",{"data-provider":id},el("legend",{},id));
        const path:Path=["web_search","providers",id];
        const update=(f:Field,v:unknown)=>modify(obj=>{
          const target=at(obj,path);
          if(v===undefined)delete target[f.key];else target[f.key]=v;
          if(f.key==="type"){
            for(const field of ["api_key_env","preset","endpoint","method","auth","headers","request","response"]){
              if(v==="custom_http"?field==="api_key_env":field!=="api_key_env"||!["tavily","brave","exa"].includes(String(v)))delete target[field];
            }
          }
          if(f.key==="method" && v==="GET" && objectValue(target.request))delete (target.request as Record<string,unknown>).json;
        });
        const custom=provider.type==="custom_http";
        for(const f of providerFields){
          if(f.key!=="type" && (f.key==="api_key_env"?!["tavily","brave","exa"].includes(String(provider.type)):!custom))continue;
          card.append(input(f,provider[f.key],v=>{update(f,v);if(f.key==="type")draw();}));
        }
        if(custom){
        for(const [key,label,children] of [
          ["auth",text("Authentication","身份验证"),[{key:"location",en:"Location",zh:"位置",choices:["none","header","query"]},{key:"name",en:"Field name",zh:"字段名"},{key:"key_env",en:"Key environment variable",zh:"密钥环境变量"},{key:"prefix",en:"Prefix",zh:"前缀"}]],
          ["response",text("Response mapping","响应映射"),["results_pointer","url_pointer","title_pointer","snippet_pointer"].map(key=>({key,en:key,zh:({results_pointer:"结果列表路径",url_pointer:"URL 路径",title_pointer:"标题路径",snippet_pointer:"摘要路径"} as Record<string,string>)[key]}))],
          ["request",text("Request template","请求模板"),[{key:"query_params",en:"Query parameters (JSON template)",zh:"查询参数（JSON 模板）",kind:"json"},{key:"json",en:"POST body (JSON template)",zh:"POST 正文（JSON 模板）",kind:"json"}]],
        ] as [string,string,Field[]][]){
          const nested=el("fieldset",{},el("legend",{},label));
          for(const f of children)nested.append(input(f,objectValue(provider[key])?.[f.key],v=>modify(obj=>{const target=at(obj,[...path,key]);if(v===undefined)delete target[f.key];else target[f.key]=v;
            if(key==="auth" && f.key==="location" && v==="none")for(const name of ["name","key_env","prefix"])delete target[name];
          })));
          card.append(nested);
        }
        card.append(mapEditor([...path,"headers"],text("HTTP headers","HTTP 请求头")));
        }
        const remove=el("button",{type:"button"},text("Remove provider","移除提供商"));remove.onclick=()=>{modify(obj=>{delete at(obj,["web_search","providers"])[id];});draw();};card.append(remove);group.append(card);
      }
      const id=el("input",{placeholder:text("Provider ID","提供商 ID")}) as HTMLInputElement;
      const add=el("button",{type:"button"},text("Add provider","添加提供商"));
      add.onclick=()=>{const name=id.value.trim();if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name)||["constructor","prototype"].includes(name)||Object.hasOwn(providers,name)){id.setCustomValidity(text("Enter a unique provider ID.","请输入不重复的有效提供商 ID。"));id.reportValidity();return;}modify(obj=>{at(obj,["web_search","providers"])[name]={type:"exa_mcp"};});draw();};
      id.oninput=()=>id.setCustomValidity("");group.append(id,add);form.append(group);
    }

  };
  editor.addEventListener("change",draw);
  editor.addEventListener("agent-section-updated",event=>{if((event as CustomEvent).detail!==form)draw();});
  draw();return form;
}

export function agentConfigurationFields(profile: Record<string, unknown>, chinese: boolean, basicFields?: HTMLElement): HTMLElement {
  const text = (en: string, zh: string) => chinese ? zh : en;
  const container = el("div", { class: "agent-configuration" },
    el("p", { class: "modal-muted" }, text(
      "Configure each section below. Advanced JSON retains all backend options and masked secrets (***). Empty fields use backend defaults.",
      "按分区编辑配置；高级 JSON 保留全部后端选项和脱敏密钥（***）。留空使用后端默认值。",
    )),
  );
  const subOnly = el("input", { type: "checkbox", name: "sub_agent_only" }) as HTMLInputElement;
  subOnly.checked = profile.sub_agent_only === true;
  container.append(el("label", { class: "modal-check" }, subOnly, text("Sub-agent only", "仅作为子智能体")));
  const tabs=el("div",{class:"agent-section-tabs",role:"tablist"});container.prepend(tabs);
  const addTab=(key:string,title:string,card:HTMLElement,selected:boolean)=>{
    card.hidden=!selected;
    const tab=el("button",{type:"button",role:"tab","aria-selected":String(selected)},title) as HTMLButtonElement;
    tab.tabIndex=selected?0:-1;
    tab.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();const buttons=Array.from(tabs.querySelectorAll("button"));const index=buttons.indexOf(tab);
      const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
      buttons[next].click();buttons[next].focus();
    });
    tab.onclick=()=>{container.querySelectorAll<HTMLElement>(".agent-section").forEach(item=>item.hidden=item!==card);tabs.querySelectorAll("button").forEach(button=>{button.setAttribute("aria-selected",String(button===tab));button.tabIndex=button===tab?0:-1;});};
    tab.dataset.sectionTab=key;
    tabs.append(tab);container.append(card);
  };
  const instructions=basicFields?.querySelector('[name="instructions"]')?.closest("label");
  if(basicFields)addTab("basic",text("Basic","基础"),el("fieldset",{class:"agent-section",role:"tabpanel","data-section":"basic"},el("legend",{},text("Basic","基础")),basicFields),true);
  if(instructions)addTab("instructions",text("Instructions","指令"),el("fieldset",{class:"agent-section",role:"tabpanel","data-section":"instructions"},el("legend",{},text("Instructions","指令")),instructions),false);
  for (const section of sections) {
    const title = text(section.en, section.zh);
    const editor = el("textarea", {name: `agent_section_${section.key}`, rows:"8", spellcheck:"false", placeholder:JSON.stringify(section.example,null,2)}, profile[section.key]===undefined?"":JSON.stringify(profile[section.key],null,2)) as HTMLTextAreaElement;
    const card=el("fieldset", {class:"profile-advanced agent-section",role:"tabpanel","data-section":section.key},el("legend",{},title),guidedFields(section.key,editor,chinese),el("details",{},el("summary",{},text("Advanced JSON (all fields)","高级 JSON（全部字段）")),el("label",{},`${title} (JSON)`,editor)));
    addTab(section.key,title,card,!basicFields && section.key==="model");
    if(section.key==="tools")addTab("mcp","MCP",el("fieldset",{class:"agent-section",role:"tabpanel","data-section":"mcp"},el("legend",{},text("MCP servers","MCP 服务器")),guidedFields("mcp",editor,chinese)),false);
  }
  return container;
}

/** Apply only edited sections so older/unknown backend values survive a no-op save. */
export function applyAgentConfiguration(
  payload: Record<string, unknown>, profile: Record<string, unknown>, data: FormData, chinese: boolean,
): Record<string, unknown> {
  const result = { ...payload };
  result.sub_agent_only = data.get("sub_agent_only") === "on";
  for (const section of sections) {
    const raw = String(data.get(`agent_section_${section.key}`) ?? "").trim();
    const original = profile[section.key] === undefined ? "" : JSON.stringify(profile[section.key], null, 2);
    if (raw === original) continue;
    if (!raw) { delete result[section.key]; continue; }
    let value: unknown;
    try { value = JSON.parse(raw); } catch { /* Use the localized field error below. */ }
    if (!objectValue(value)) throw new Error(chinese ? `${section.zh} 必须是有效 JSON 对象。` : `${section.en} must be a valid JSON object.`);
    result[section.key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(result, "acp")) result.sub_agent_only = true;
  return result;
}
