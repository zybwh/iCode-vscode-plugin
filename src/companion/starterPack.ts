import type { CompanionCard, CompanionPack, CompanionQuickAction, CompanionWorkflowState } from "./types";

function companionAvatar(prefix: string) {
  return {
    kind: "builtin",
    animatedWebp: `companions/${prefix}-gba-idle.webp`,
    thumbnailPng: `companions/${prefix}-gba-thumb.webp`,
    animations: {
      idle: `companions/${prefix}-gba-idle.webp`,
      running: `companions/${prefix}-gba-tail.webp`,
      tool_running: `companions/${prefix}-gba-tail.webp`,
      error: `companions/${prefix}-gba-tail.webp`,
      approval_waiting: `companions/${prefix}-gba-tail.webp`,
      done: `companions/${prefix}-gba-rest.webp`,
      pet: `companions/${prefix}-gba-rest.webp`,
    },
  } as const;
}

const STARTER_AVATAR = companionAvatar("baize");

const BIFANG_AVATAR = companionAvatar("bifang");
const QINGNIAO_AVATAR = companionAvatar("qingniao");
const XUANGUI_AVATAR = companionAvatar("xuangui");
const CHENGHUANG_AVATAR = companionAvatar("chenghuang");
const LUSHU_AVATAR = companionAvatar("lushu");
const ESHOU_AVATAR = companionAvatar("eshou");
const ZHULONG_AVATAR = companionAvatar("zhulong");
const JIUWEIHU_AVATAR = companionAvatar("jiuweihu");
const YINGLONG_AVATAR = companionAvatar("yinglong");
const KUI_AVATAR = companionAvatar("kui");
const XINGXING_AVATAR = companionAvatar("xingxing");
const ZHUYAN_AVATAR = companionAvatar("zhuyan");
const WENYAOYU_AVATAR = companionAvatar("wenyaoyu");
const CHONGMINGNIAO_AVATAR = companionAvatar("chongmingniao");
const DANGKANG_AVATAR = companionAvatar("dangkang");
const FEILIAN_AVATAR = companionAvatar("feilian");
const JUMANG_AVATAR = companionAvatar("jumang");
const JIUTIANXUANNV_AVATAR = companionAvatar("jiutianxuannv");
const HEBO_AVATAR = companionAvatar("hebo");

type StarterCardInput = {
  id: string;
  name: string;
  title: string;
  description: string;
  personality: string;
  workflowBias: string[];
  quickActions: CompanionQuickAction[];
  avatar?: CompanionCard["avatar"];
  statusLines: Pick<Partial<Record<CompanionWorkflowState, string>>, "idle" | "running" | "approval_waiting" | "error" | "done">;
};

function starterCard(input: StarterCardInput): CompanionCard {
  return {
    id: input.id,
    name: input.name,
    title: input.title,
    description: input.description,
    personality: input.personality,
    avatar: input.avatar ?? STARTER_AVATAR,
    statusLines: input.statusLines,
    workflowBias: input.workflowBias,
    quickActions: input.quickActions,
  };
}

export const STARTER_COMPANION_PACK: CompanionPack = {
  id: "chrys-starter",
  name: "iCode Starter Companions",
  cards: [
    starterCard({
      id: "c001-baize",
      name: "白泽",
      title: "C001 · Runtime Guardian",
      description: "A calm companion that watches runtime state, diffs, and approvals.",
      personality: "calm, observant, concise",
      workflowBias: ["diff", "approval", "logs"],
      quickActions: ["diff", "logs", "doctor", "runtime"],
      statusLines: {
        idle: "Workspace quiet. I am watching the edges.",
        running: "The turn is moving. I will keep watch.",
        approval_waiting: "A decision is waiting.",
        error: "Something needs attention.",
        done: "Turn complete. Diff before you trust it.",
      },
    }),
    starterCard({
      id: "c002-bifang",
      name: "毕方",
      title: "C002 · Error Flame",
      description: "A sharp companion for failures, red lights, and risky output.",
      personality: "direct, alert, terse",
      avatar: BIFANG_AVATAR,
      workflowBias: ["errors", "tests", "logs"],
      quickActions: ["logs", "doctor", "diff"],
      statusLines: {
        idle: "No red lights yet.",
        running: "I am watching for sparks.",
        approval_waiting: "Pause before feeding the flame.",
        error: "The red light is real. Read it first.",
        done: "Smoke cleared. Check the diff.",
      },
    }),
    starterCard({
      id: "c003-qingniao",
      name: "青鸟",
      title: "C003 · Session Courier",
      description: "A messenger companion for summaries, reminders, and support context.",
      personality: "clear, helpful, light",
      avatar: QINGNIAO_AVATAR,
      workflowBias: ["summary", "support", "runtime"],
      quickActions: ["support", "runtime"],
      statusLines: {
        idle: "Messages are in order.",
        running: "I will carry the thread forward.",
        approval_waiting: "A reply is waiting.",
        error: "The message needs a clearer route.",
        done: "Turn delivered. Keep the trail.",
      },
    }),
    starterCard({
      id: "c004-xuangui",
      name: "玄龟",
      title: "C004 · Context Anchor",
      description: "A steady companion for architecture, context, and long sessions.",
      personality: "patient, structural, careful",
      avatar: XUANGUI_AVATAR,
      workflowBias: ["architecture", "context", "stability"],
      quickActions: ["runtime", "support", "diff"],
      statusLines: {
        idle: "The stack is still.",
        running: "Hold the shape of the work.",
        approval_waiting: "A gate is part of the structure.",
        error: "The foundation needs inspection.",
        done: "The structure changed. Review its load.",
      },
    }),
    starterCard({
      id: "c005-chenghuang",
      name: "乘黄",
      title: "C005 · Momentum Runner",
      description: "A fast companion that keeps work moving toward the next step.",
      personality: "quick, energetic, focused",
      avatar: CHENGHUANG_AVATAR,
      workflowBias: ["progress", "next-step", "execution"],
      quickActions: ["diff", "logs"],
      statusLines: {
        idle: "Ready to move.",
        running: "Keep the stride clean.",
        approval_waiting: "One gate, then forward.",
        error: "Trip found. Fix and continue.",
        done: "Good pace. Verify before the next run.",
      },
    }),
    starterCard({
      id: "c006-lushu",
      name: "鹿蜀",
      title: "C006 · Flow Companion",
      description: "A gentle companion for long coding sessions and pacing.",
      personality: "warm, steady, encouraging",
      avatar: LUSHU_AVATAR,
      workflowBias: ["pacing", "focus", "long-session"],
      quickActions: ["runtime", "support"],
      statusLines: {
        idle: "Breathe. The workspace is ready.",
        running: "One turn at a time.",
        approval_waiting: "A small choice is waiting.",
        error: "Slow down and read the shape of it.",
        done: "Good. Keep the rhythm honest.",
      },
    }),
    starterCard({
      id: "c007-eshou",
      name: "讹兽",
      title: "C007 · Skeptic",
      description: "A skeptical companion that pushes back on hallucinations and easy claims.",
      personality: "wry, skeptical, precise",
      avatar: ESHOU_AVATAR,
      workflowBias: ["verification", "diff", "logs"],
      quickActions: ["diff", "logs"],
      statusLines: {
        idle: "Trust nothing for free.",
        running: "Claims are cheap. Evidence is better.",
        approval_waiting: "Read the exact request.",
        error: "There it is. The output confessed.",
        done: "Looks done is not done. Verify.",
      },
    }),
    starterCard({
      id: "c008-zhulong",
      name: "烛龙",
      title: "C008 · Timeline Keeper",
      description: "A time-aware companion for session flow and state transitions.",
      personality: "ancient, measured, attentive",
      avatar: ZHULONG_AVATAR,
      workflowBias: ["timeline", "session", "state"],
      quickActions: ["runtime", "support"],
      statusLines: {
        idle: "The thread waits.",
        running: "The current turn is lit.",
        approval_waiting: "A moment is suspended.",
        error: "The timeline broke here.",
        done: "Mark the turn before moving on.",
      },
    }),
    starterCard({
      id: "c009-jiuweihu",
      name: "九尾狐",
      title: "C009 · Strategy Splitter",
      description: "A strategic companion for options, tradeoffs, and refactor choices.",
      personality: "clever, flexible, concise",
      avatar: JIUWEIHU_AVATAR,
      workflowBias: ["strategy", "tradeoffs", "refactor"],
      quickActions: ["diff", "runtime"],
      statusLines: {
        idle: "There is usually another angle.",
        running: "Track the branch you chose.",
        approval_waiting: "Choose the least surprising path.",
        error: "A clever path still needs proof.",
        done: "Now compare intent with diff.",
      },
    }),
    starterCard({
      id: "c010-yinglong",
      name: "应龙",
      title: "C010 · Breakthrough Driver",
      description: "A strong companion for large changes and hard blockers.",
      personality: "decisive, forceful, disciplined",
      avatar: YINGLONG_AVATAR,
      workflowBias: ["complex-task", "blocker", "execution"],
      quickActions: ["logs", "diff", "doctor"],
      statusLines: {
        idle: "Name the wall.",
        running: "Push through with structure.",
        approval_waiting: "A strong move still needs consent.",
        error: "The blocker has a shape now.",
        done: "The path opened. Inspect the ground.",
      },
    }),
    starterCard({
      id: "c011-kui",
      name: "夔",
      title: "C011 · Test Drummer",
      description: "A rhythmic companion for build, test, and verification loops.",
      personality: "firm, rhythmic, practical",
      avatar: KUI_AVATAR,
      workflowBias: ["tests", "build", "verification"],
      quickActions: ["logs", "doctor"],
      statusLines: {
        idle: "The drum is quiet.",
        running: "Keep the beat with the tests.",
        approval_waiting: "Hold before the next strike.",
        error: "The beat slipped. Read the failure.",
        done: "Green is a rhythm, not a guess.",
      },
    }),
    starterCard({
      id: "c012-xingxing",
      name: "狌狌",
      title: "C012 · Memory Keeper",
      description: "A memory-flavored companion for preferences and historical context.",
      personality: "attentive, familiar, grounded",
      avatar: XINGXING_AVATAR,
      workflowBias: ["memory", "preferences", "history"],
      quickActions: ["runtime", "support"],
      statusLines: {
        idle: "I remember the shape of this place.",
        running: "This turn joins the pattern.",
        approval_waiting: "A preference may matter here.",
        error: "We have seen this kind of snag.",
        done: "Keep what changed in mind.",
      },
    }),
    starterCard({
      id: "c013-zhuyan",
      name: "朱厌",
      title: "C013 · Risk Sentinel",
      description: "A warning companion for risky diffs and destructive choices.",
      personality: "stern, protective, blunt",
      avatar: ZHUYAN_AVATAR,
      workflowBias: ["risk", "conflict", "approval"],
      quickActions: ["diff", "approval"],
      statusLines: {
        idle: "Quiet does not mean safe.",
        running: "Watch for sharp edges.",
        approval_waiting: "This is where mistakes become real.",
        error: "The risk surfaced.",
        done: "Review before you trust the change.",
      },
    }),
    starterCard({
      id: "c014-wenyaoyu",
      name: "文鳐鱼",
      title: "C014 · File Glider",
      description: "A light companion for file references, search, and navigation.",
      personality: "nimble, curious, tidy",
      avatar: WENYAOYU_AVATAR,
      workflowBias: ["files", "search", "references"],
      quickActions: ["diff", "runtime"],
      statusLines: {
        idle: "Files are waiting below the surface.",
        running: "Follow the path, not the noise.",
        approval_waiting: "Check what file this touches.",
        error: "The trail points to a file.",
        done: "The changed files tell the story.",
      },
    }),
    starterCard({
      id: "c015-chongmingniao",
      name: "重明鸟",
      title: "C015 · Review Eye",
      description: "A reviewing companion for hidden issues and second looks.",
      personality: "sharp, calm, exact",
      avatar: CHONGMINGNIAO_AVATAR,
      workflowBias: ["review", "diff", "quality"],
      quickActions: ["diff", "logs"],
      statusLines: {
        idle: "Look once. Then look again.",
        running: "I am watching the quiet parts.",
        approval_waiting: "A second look belongs here.",
        error: "The hidden part is visible now.",
        done: "Review the diff with both eyes.",
      },
    }),
    starterCard({
      id: "c016-dangkang",
      name: "当康",
      title: "C016 · Release Closer",
      description: "A closing companion for acceptance, release checks, and clean endings.",
      personality: "optimistic, orderly, practical",
      avatar: DANGKANG_AVATAR,
      workflowBias: ["acceptance", "release", "checklist"],
      quickActions: ["diff", "support"],
      statusLines: {
        idle: "A clean finish starts early.",
        running: "Move toward something shippable.",
        approval_waiting: "A release gate is still a gate.",
        error: "Do not carry this into release.",
        done: "Close the loop. Verify and ship.",
      },
    }),
    starterCard({
      id: "c017-feilian",
      name: "飞廉",
      title: "C017 · Search Wind",
      description: "A swift companion for quick location and lightweight hints.",
      personality: "fast, airy, clipped",
      avatar: FEILIAN_AVATAR,
      workflowBias: ["search", "navigation", "speed"],
      quickActions: ["logs", "runtime"],
      statusLines: {
        idle: "A path can be found quickly.",
        running: "Move light. Keep direction.",
        approval_waiting: "The wind pauses at the gate.",
        error: "Trace the gust back.",
        done: "Fast work still leaves tracks.",
      },
    }),
    starterCard({
      id: "c018-jumang",
      name: "句芒",
      title: "C018 · Feature Sprout",
      description: "A growth companion for new features and constructive iteration.",
      personality: "fresh, creative, steady",
      avatar: JUMANG_AVATAR,
      workflowBias: ["feature", "growth", "iteration"],
      quickActions: ["runtime", "diff"],
      statusLines: {
        idle: "New work can grow from here.",
        running: "Let the change grow with shape.",
        approval_waiting: "Prune before it spreads.",
        error: "A weak branch needs cutting back.",
        done: "The new growth needs review.",
      },
    }),
    starterCard({
      id: "c019-jiutianxuannv",
      name: "九天玄女",
      title: "C019 · Plan Strategist",
      description: "A strategic companion for plans, decomposition, and task order.",
      personality: "strategic, composed, lucid",
      avatar: JIUTIANXUANNV_AVATAR,
      workflowBias: ["planning", "decomposition", "strategy"],
      quickActions: ["support", "runtime"],
      statusLines: {
        idle: "Order decides the battle.",
        running: "Keep the plan visible.",
        approval_waiting: "Choose with the whole plan in view.",
        error: "The plan met reality. Adjust it.",
        done: "Record what the plan learned.",
      },
    }),
    starterCard({
      id: "c020-hebo",
      name: "河伯",
      title: "C020 · Async Tide",
      description: "A flowing companion for waiting, state streams, and async progress.",
      personality: "fluid, patient, observant",
      avatar: HEBO_AVATAR,
      workflowBias: ["async", "status", "waiting"],
      quickActions: ["logs", "runtime"],
      statusLines: {
        idle: "The water is still.",
        running: "State moves like a current.",
        approval_waiting: "The tide is held at the gate.",
        error: "The current snagged here.",
        done: "The flow settled. Check what drifted.",
      },
    }),
  ],
};
