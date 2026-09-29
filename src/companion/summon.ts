const SUMMON_RESET_HOUR = 9;

function localResetFor(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), SUMMON_RESET_HOUR, 0, 0, 0);
}

export function summonWindow(now: Date): { windowStart: string; nextReset: string } {
  const todayReset = localResetFor(now);
  if (now.getTime() >= todayReset.getTime()) {
    const nextReset = new Date(todayReset);
    nextReset.setDate(nextReset.getDate() + 1);
    return {
      windowStart: todayReset.toISOString(),
      nextReset: nextReset.toISOString(),
    };
  }
  const previousReset = new Date(todayReset);
  previousReset.setDate(previousReset.getDate() - 1);
  return {
    windowStart: previousReset.toISOString(),
    nextReset: todayReset.toISOString(),
  };
}

export function canSummon(lastSummonedAt: string | undefined, now: Date): boolean {
  if (!lastSummonedAt) return true;
  const last = new Date(lastSummonedAt);
  if (Number.isNaN(last.getTime())) return true;
  return last.getTime() < new Date(summonWindow(now).windowStart).getTime();
}
