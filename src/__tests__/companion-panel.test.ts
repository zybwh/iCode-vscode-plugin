// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCompanionSidebar } from "../chat/webview/components/companionPanel";
import { state } from "../chat/webview/state";
import { companionFixture } from "./fixtures/companion";

let sidebar: HTMLElement;
let command = vi.fn();
beforeEach(() => {
  sidebar = document.createElement("div"); document.body.replaceChildren(sidebar);
  command = vi.fn(); state.uiLanguage = "zh-CN"; state.messages = [];
  state.latestState = { agentName: "Code", modelName: "", sessionId: "", sessionState: "idle", companion: companionFixture() };
});
const render = () => renderCompanionSidebar(sidebar, command);

describe("Buddy panel", () => {
  it("pets the character and uses the shared XP thresholds", () => {
    render(); sidebar.querySelector<HTMLButtonElement>(".companion-stage")!.click();
    expect(command).toHaveBeenCalledOnce(); expect(command).toHaveBeenCalledWith("pet");
    expect(sidebar.textContent).toContain("180 / 500 XP");
    expect(sidebar.querySelector<HTMLProgressElement>("progress")!.value).toBe(180);
    expect(sidebar.querySelector<HTMLSourceElement>("source")!.media).toBe("(prefers-reduced-motion: reduce)");
    expect(sidebar.querySelector<HTMLSourceElement>("source")!.srcset).toContain("thumb.webp");
  });
  it("returns to idle after petting without another host update", () => {
    vi.useFakeTimers();
    try {
      const companion = state.latestState!.companion!;
      companion.activeCard!.card.avatar.animations = { idle: "idle.webp", pet: "pet.webp" };
      companion.lastResponse = { kind: "pet", text: "pet", createdAt: new Date().toISOString() };
      render();
      expect(sidebar.querySelector("img")!.src).toContain("pet.webp");
      vi.advanceTimersByTime(5000);
      expect(sidebar.querySelector("img")!.src).toContain("idle.webp");
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });
  it("keeps summoning disabled during cooldown and provides local management actions", () => {
    render();
    const summon = sidebar.querySelector<HTMLButtonElement>('[data-buddy-focus="summon"]')!;
    expect(summon.disabled).toBe(true); summon.click(); expect(command).not.toHaveBeenCalled();
    sidebar.querySelector<HTMLButtonElement>('[data-buddy-focus="mute on"]')!.click();
    expect(command).toHaveBeenCalledWith("mute on");
    state.latestState!.companion!.summon.available = true; render();
    sidebar.querySelector<HTMLButtonElement>('[data-buddy-focus="summon"]')!.click();
    expect(command).toHaveBeenCalledWith("summon");
  });
  it("retains a name draft and focus while usage updates arrive", () => {
    render(); sidebar.querySelector<HTMLDetailsElement>("details")!.open = true;
    const input = sidebar.querySelector<HTMLInputElement>("input")!;
    input.value = "小白 <伙伴>"; input.focus(); input.setSelectionRange(2, 2);
    state.latestState!.companion!.activeCard!.growth.toolRuns += 1; render();
    const next = sidebar.querySelector<HTMLInputElement>("input")!;
    expect(next.value).toBe("小白 <伙伴>"); expect(document.activeElement).toBe(next); expect(next.selectionStart).toBe(2);
    sidebar.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(command).toHaveBeenCalledOnce(); expect(command).toHaveBeenCalledWith("name 小白 <伙伴>");
  });
  it("keeps the sprite DOM stable for unrelated state updates", () => {
    render(); const image = sidebar.querySelector("img");
    state.latestState!.usageText = "updated usage"; render(); expect(sidebar.querySelector("img")).toBe(image);
  });
  it("does not render muted replies or treat authored text as markup", () => {
    const companion = state.latestState!.companion!;
    companion.lastResponse = { kind: "pet", text: '<img src=x onerror="oops">', createdAt: new Date().toISOString() };
    render(); expect(sidebar.querySelector(".companion-bubble img")).toBeNull(); expect(sidebar.textContent).toContain("<img src=x");
    companion.muted = true; render(); expect(sidebar.textContent).not.toContain("<img src=x"); expect(sidebar.textContent).toContain("回应已静音");
  });
  it("shows an actionable empty state and localized English controls", () => {
    state.uiLanguage = "en"; const companion = state.latestState!.companion!;
    companion.activeCard = null; companion.collection = []; companion.summon.available = true; render();
    expect(sidebar.textContent).toContain("A place for your companion");
    sidebar.querySelector<HTMLButtonElement>("button")!.click(); expect(command).toHaveBeenCalledWith("summon");
  });
});
