import { state, uiText as text } from "../state";
import { el } from "../helpers";
import { companionRarityLabel } from "../../../companion/presentation";
import { experienceForLevel } from "../../../companion/growth";
import type { CompanionCollectionItem, CompanionViewState, CompanionWorkflowState } from "../../../companion/types";

type CompanionCommand = (arg: string) => void;
const petExpiryTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
function petIsRecent(companion: CompanionViewState | null | undefined): boolean {
  return companion?.lastResponse?.kind === "pet" && Date.now() - Date.parse(companion.lastResponse.createdAt) < 5000;
}
const rendered = new WeakMap<HTMLElement, { signature: string; content: HTMLElement }>();


function assetUri(companion: CompanionViewState, assetPath: string): string {
  const base = companion.assetBaseUri?.replace(/\/$/, "");
  return base ? `${base}/${assetPath}` : assetPath;
}

function workflowState(): CompanionWorkflowState {
  if (state.latestState?.connectionState === "disconnected" || state.latestState?.connectionState === "error") return "disconnected";
  if (state.latestState?.sessionState === "running" || state.latestState?.sessionState === "cancelling") return "running";
  if (state.messages[state.messages.length - 1]?.kind === "error") return "error";
  return "idle";
}

function workflowLabel(workflow: CompanionWorkflowState): string {
  if (workflow === "running") return text("Keeping you company", "陪你忙碌中");
  if (workflow === "error") return text("Here with you", "陪你一起排查");
  if (workflow === "disconnected") return text("Waiting with you", "陪你等连接");
  return text("By your side", "在你身边");
}

function displayName(item: CompanionCollectionItem): string {
  return item.displayName?.trim() || item.card.name;
}

function commandButton(label: string, arg: string, onCommand: CompanionCommand, className = "companion-menu-action"): HTMLButtonElement {
  const button = el("button", { type: "button", class: className, "data-buddy-focus": arg }, label) as HTMLButtonElement;
  button.addEventListener("click", () => {
    const menu = button.closest<HTMLDetailsElement>(".companion-menu");
    if (menu) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
    onCommand(arg);
  });
  return button;
}

function nextSummon(companion: CompanionViewState): string {
  if (companion.summon.available) return text("A summon is ready", "今天可以召唤新伙伴");
  const reset = new Date(companion.summon.nextResetAt);
  if (!Number.isFinite(reset.getTime())) return text("Today's summon is used", "今日召唤已使用");
  const time = reset.toLocaleString(state.uiLanguage === "zh-CN" ? "zh-CN" : "en", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return text(`Next summon: ${time}`, `下次召唤：${time}`);
}

function renderMenu(companion: CompanionViewState, active: CompanionCollectionItem, onCommand: CompanionCommand): HTMLDetailsElement {
  const menu = el("details", { class: "companion-menu" }) as HTMLDetailsElement;
  const summary = el("summary", { title: text("Companion options", "伙伴选项"), "aria-label": text("Companion options", "伙伴选项"), "data-buddy-focus": "options" }, "···");
  const summon = commandButton(text("Summon a companion", "召唤新伙伴"), "summon", onCommand);
  summon.disabled = !companion.summon.available;
  summon.title = nextSummon(companion);
  const renameInput = el("input", {
    class: "companion-rename-input", type: "text", value: displayName(active), maxLength: "60",
    "aria-label": text("Companion name", "伙伴名字"), "data-buddy-focus": "name",
  }) as HTMLInputElement;
  const save = el("button", { type: "submit", class: "companion-rename-save" }, text("Save", "保存")) as HTMLButtonElement;
  renameInput.addEventListener("input", () => { save.disabled = !renameInput.value.trim(); });
  const form = el("form", { class: "companion-rename" },
    el("label", {}, text("Name", "名字"), renameInput), save,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = renameInput.value.trim();
    if (!name) return;
    menu.open = false;
    summary.focus();
    onCommand(`name ${name}`);
  });
  menu.append(summary, el("div", { class: "companion-menu-body" },
    commandButton(text("View collection", "查看收藏"), "collection", onCommand),
    summon,
    commandButton(companion.muted ? text("Enable replies", "开启回应") : text("Mute replies", "静音回应"), companion.muted ? "mute off" : "mute on", onCommand),
    commandButton(text("Companion details", "伙伴详情"), "info", onCommand),
    form,
  ));
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      event.preventDefault();
      event.stopPropagation();
      menu.open = false;
      summary.focus();
    }
  });
  return menu;
}

function renderGrowth(active: CompanionCollectionItem): HTMLElement {
  const levelStart = experienceForLevel(active.growth.level);
  const nextLevel = experienceForLevel(active.growth.level + 1);
  const maxLevel = nextLevel === levelStart;
  const needed = Math.max(1, nextLevel - levelStart);
  const earned = Math.min(needed, Math.max(0, active.growth.experience - levelStart));
  const progressText = maxLevel ? text("Max level", "已满级") : `${earned} / ${needed} XP`;
  return el("section", { class: "companion-growth", "aria-label": text("Companion growth", "伙伴成长") },
    el("div", { class: "companion-growth-heading" },
      el("span", { class: "companion-level" }, text(`Level ${active.growth.level}`, `等级 ${active.growth.level}`)),
      el("span", { class: "companion-xp" }, progressText),
    ),
    el("progress", { class: "companion-progress", max: String(needed), value: String(maxLevel ? needed : earned), "aria-label": text("Progress to next level", "距下一等级的进度"), "aria-valuetext": progressText }),
    el("div", { class: "companion-milestones" },
      el("span", {}, text(`${active.growth.completedTurns} turns together`, `一起完成 ${active.growth.completedTurns} 轮对话`)),
      el("span", {}, text(`${active.growth.toolRuns} tool runs`, `${active.growth.toolRuns} 次工具调用`)),
    ),
  );
}

function renderActive(companion: CompanionViewState, active: CompanionCollectionItem, onCommand: CompanionCommand): HTMLElement {
  const workflow = workflowState();
  const recentPet = petIsRecent(companion);
  const animation = recentPet && workflow === "idle" ? "pet" : workflow;
  const avatar = active.card.avatar;
  const image = el("img", { class: "companion-avatar", src: assetUri(companion, avatar.animations?.[animation] || avatar.animatedWebp), alt: "" });
  const picture = el("picture", {},
    el("source", { media: "(prefers-reduced-motion: reduce)", srcset: assetUri(companion, avatar.thumbnailPng) }), image,
  );
  const stage = commandButton(text("Pet", "摸摸"), "pet", onCommand, "companion-stage");
  stage.setAttribute("aria-label", text(`Pet ${displayName(active)}`, `摸摸${displayName(active)}`));
  stage.replaceChildren(
    picture,
    el("span", { class: "companion-pet-hint" }, text("Click to pet", "点一下，摸摸它")),
  );
  const rarity = companionRarityLabel(active.appraisal.rarity);
  const rarityDescription = text(
    ({ rare: "Rare", super_rare: "Super Rare", ultra_rare: "Super Special Rare" })[active.appraisal.rarity],
    ({ rare: "稀有", super_rare: "超稀有", ultra_rare: "极稀有" })[active.appraisal.rarity],
  );
  const response = !companion.muted && companion.lastResponse?.text;
  const status = active.card.statusLines[workflow] || active.card.statusLines.idle || active.card.description;
  const panel = el("div", { class: "companion-panel", "data-workflow": workflow, "data-fingerprint": active.fingerprint },
    el("header", { class: "companion-header" },
      el("div", { class: "companion-identity" },
        el("h2", { class: "companion-name" }, displayName(active)),
      ),
      renderMenu(companion, active, onCommand),
    ),
    el("div", { class: "companion-presence" },
      el("span", { class: "companion-presence-dot", "aria-hidden": "true" }),
      el("span", {}, workflowLabel(workflow)),
      ...(companion.muted ? [el("span", { class: "companion-muted" }, text("Replies muted", "回应已静音"))] : []),
    ),
    stage,
    el("div", { class: "companion-meta" },
      el("span", { class: "companion-rarity", "data-rarity": active.appraisal.rarity, title: rarityDescription, "aria-label": `${rarity} · ${rarityDescription}` }, rarity),
      ...(active.copies > 1 ? [el("span", {}, text(`${active.copies} copies`, `${active.copies} 份收藏`))] : []),
    ),
    el("div", { class: "companion-bubble", role: "status" },
      el("p", {}, response || status),
    ),
    renderGrowth(active),
    el("footer", { class: "companion-footer" },
      commandButton(text(`Collection · ${companion.collection.length}`, `我的收藏 · ${companion.collection.length}`), "collection", onCommand, "companion-collection-link"),
      el("p", { class: "companion-cooldown" }, nextSummon(companion)),
    ),
  );
  panel.addEventListener("pointerdown", (event) => {
    const menu = panel.querySelector<HTMLDetailsElement>(".companion-menu");
    if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
  return panel;
}

export function renderCompanionSidebar(sidebar: HTMLElement, onCommand: CompanionCommand): void {
  const companion = state.latestState?.companion;
  const signature = JSON.stringify([companion?.activeCard, companion?.lastResponse, companion?.muted, companion?.summon, companion?.collection.length, companion?.assetBaseUri, state.uiLanguage, workflowState(), petIsRecent(companion)]);
  const last = rendered.get(sidebar);
  if (last?.signature === signature && sidebar.firstElementChild === last.content) return;
  const oldTimer = petExpiryTimers.get(sidebar);
  if (oldTimer !== undefined) clearTimeout(oldTimer);
  petExpiryTimers.delete(sidebar);
  if (petIsRecent(companion)) {
    const delay = Date.parse(companion!.lastResponse!.createdAt) + 5000 - Date.now();
    petExpiryTimers.set(sidebar, setTimeout(() => {
      petExpiryTimers.delete(sidebar);
      if (sidebar.isConnected) renderCompanionSidebar(sidebar, onCommand);
    }, Math.max(1, delay)));
  }
  // Host usage updates must not discard a name being edited or keyboard focus.
  const previous = sidebar.querySelector<HTMLElement>(".companion-panel");
  const menuOpen = sidebar.querySelector<HTMLDetailsElement>(".companion-menu")?.open;
  const draft = sidebar.querySelector<HTMLInputElement>(".companion-rename-input")?.value;
  const focused = sidebar.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const focusKey = focused?.dataset.buddyFocus;
  const selection = focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] : null;
  let content: HTMLElement;
  if (!companion) {
    content = el("div", { class: "companion-empty", role: "status" }, text("Getting your companion ready…", "正在接伙伴过来…"));
  } else if (companion.activeCard) {
    content = renderActive(companion, companion.activeCard, onCommand);
  } else {
    const summon = commandButton(text("Summon a companion", "召唤新伙伴"), "summon", onCommand, "companion-empty-summon");
    summon.disabled = !companion.summon.available;
    content = el("div", { class: "companion-empty" },
      el("div", { class: "companion-empty-mark", "aria-hidden": "true" }, "◇"),
      el("h2", {}, text("A place for your companion", "给伙伴留了个位置")),
      el("p", {}, text("Summon a companion to keep you company while you work.", "召唤一位伙伴，陪你一起写代码。")),
      summon,
      el("p", { class: "companion-cooldown" }, nextSummon(companion)),
    );
  }
  const sameCompanion = previous?.dataset.fingerprint === companion?.activeCard?.fingerprint;
  sidebar.replaceChildren(content);
  rendered.set(sidebar, { signature, content });
  if (sameCompanion && menuOpen) {
    const menu = sidebar.querySelector<HTMLDetailsElement>(".companion-menu");
    if (menu) menu.open = true;
    const input = sidebar.querySelector<HTMLInputElement>(".companion-rename-input");
    if (input && draft !== undefined) {
      input.value = draft;
      const save = sidebar.querySelector<HTMLButtonElement>(".companion-rename-save");
      if (save) save.disabled = !draft.trim();
    }
  }
  if (sameCompanion && focusKey) {
    const next = [...sidebar.querySelectorAll<HTMLElement>("[data-buddy-focus]")].find((item) => item.dataset.buddyFocus === focusKey);
    next?.focus({ preventScroll: true });
    if (next instanceof HTMLInputElement && selection) next.setSelectionRange(selection[0], selection[1]);
  }
}
