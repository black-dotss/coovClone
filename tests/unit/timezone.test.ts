import { describe, it, expect } from "vitest";
import {
  getAddisAbabaDateString,
  getAddisAbabaMonthString,
  getAddisAbabaNextMidnight,
  ETHIOPIA_TIMEZONE,
} from "@/lib/billing/timezone";

describe("Africa/Addis_Ababa Timezone Boundaries", () => {
  it("uses ETHIOPIA_TIMEZONE constant as Africa/Addis_Ababa", () => {
    expect(ETHIOPIA_TIMEZONE).toBe("Africa/Addis_Ababa");
  });

  it("accurately rolls date over at midnight UTC+3 (21:00 UTC)", () => {
    // 20:59:59 UTC on Nov 16 is 23:59:59 in Addis Ababa (still Nov 16)
    const beforeMidnight = new Date("2026-11-16T20:59:59Z");
    expect(getAddisAbabaDateString(beforeMidnight)).toBe("2026-11-16");

    // 21:00:00 UTC on Nov 16 is 00:00:00 in Addis Ababa (now Nov 17)
    const atMidnight = new Date("2026-11-16T21:00:00Z");
    expect(getAddisAbabaDateString(atMidnight)).toBe("2026-11-17");
  });

  it("formats month string correctly in Africa/Addis_Ababa", () => {
    const date = new Date("2026-11-16T12:00:00Z");
    expect(getAddisAbabaMonthString(date)).toBe("2026-11");
  });

  it("calculates next midnight in Africa/Addis_Ababa", () => {
    const current = new Date("2026-11-16T10:00:00Z");
    const nextMidnight = getAddisAbabaNextMidnight(current);

    expect(nextMidnight.toISOString()).toBe("2026-11-16T21:00:00.000Z");
    // Verify that at the calculated next midnight, Addis Ababa date is Nov 17
    expect(getAddisAbabaDateString(nextMidnight)).toBe("2026-11-17");
  });
});
