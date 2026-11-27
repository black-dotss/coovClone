import { describe, it, expect } from "vitest";
import { AGENT_ROLES, AgentOutput, AgentRole } from "@/lib/agents/types";
import { executeAgent } from "@/lib/agents/personas/executor";
import { MockLLMProvider } from "@/lib/ai/providers/mock";
import { generateSynthesisReport } from "@/lib/agents/graph/synthesis-generator";

const CV_SAMPLE = `
Jane Doe
Product Designer
2019 – Present
- Designed end-to-end user workflows for mobile banking app.
- Increased onboarding completion rates by 22% through user research and design sprints.
- Mentored 3 junior designers.
`;

const JD_SAMPLE = `
Lead Product Designer
Requirements:
- 4+ years of product design experience in high-growth tech.
- Proven experience with Figma, design systems, and mobile UX.
- Demonstrated metrics of conversion and user retention.
`;

describe("Tone Invariance & Voice Specialization", () => {
  const provider = new MockLLMProvider();

  it("proves that Friendly, Strict, and Brutal Roast produce IDENTICAL scores for every agent", async () => {
    for (const role of AGENT_ROLES) {
      const friendlyRes = await executeAgent(
        { agentRole: role, cvText: CV_SAMPLE, jdText: JD_SAMPLE, tone: "friendly" },
        provider
      );
      const strictRes = await executeAgent(
        { agentRole: role, cvText: CV_SAMPLE, jdText: JD_SAMPLE, tone: "strict" },
        provider
      );
      const roastRes = await executeAgent(
        { agentRole: role, cvText: CV_SAMPLE, jdText: JD_SAMPLE, tone: "brutal_roast" },
        provider
      );

      // 1. Scoring MUST be 100% identical
      expect(friendlyRes.output.scoreContribution).toBe(strictRes.output.scoreContribution);
      expect(strictRes.output.scoreContribution).toBe(roastRes.output.scoreContribution);

      // 2. Factual findings and evidence MUST be identical
      expect(friendlyRes.output.findings.length).toBe(strictRes.output.findings.length);
      expect(strictRes.output.findings.length).toBe(roastRes.output.findings.length);
      for (let i = 0; i < strictRes.output.findings.length; i++) {
        expect(friendlyRes.output.findings[i].claim).toBe(strictRes.output.findings[i].claim);
        expect(roastRes.output.findings[i].claim).toBe(strictRes.output.findings[i].claim);
        expect(roastRes.output.findings[i].evidenceSnippet).toBe(strictRes.output.findings[i].evidenceSnippet);
      }

      // 3. Voice commentary MUST differ between tones
      expect(friendlyRes.output.voiceCommentary).not.toBe(strictRes.output.voiceCommentary);
      expect(strictRes.output.voiceCommentary).not.toBe(roastRes.output.voiceCommentary);
      expect(friendlyRes.output.voiceCommentary).not.toBe(roastRes.output.voiceCommentary);

      // 4. Tone markers
      expect(friendlyRes.output.voiceCommentary.toLowerCase()).toMatch(/welcome|great|track|encourag/);
      expect(strictRes.output.voiceCommentary.toLowerCase()).toMatch(/assessment|standard|threshold/);
      expect(roastRes.output.voiceCommentary.toLowerCase()).toMatch(/buzzword|real|reject|bingo/);
    }
  });

  it("proves that final synthesis scores and dimensions are identical regardless of tone", async () => {
    // Generate agent outputs for strict
    const strictOutputs = {} as Record<AgentRole, AgentOutput>;
    const friendlyOutputs = {} as Record<AgentRole, AgentOutput>;
    const roastOutputs = {} as Record<AgentRole, AgentOutput>;

    for (const role of AGENT_ROLES) {
      strictOutputs[role] = (
        await executeAgent({ agentRole: role, cvText: CV_SAMPLE, jdText: JD_SAMPLE, tone: "strict" }, provider)
      ).output;
      friendlyOutputs[role] = (
        await executeAgent({ agentRole: role, cvText: CV_SAMPLE, jdText: JD_SAMPLE, tone: "friendly" }, provider)
      ).output;
      roastOutputs[role] = (
        await executeAgent({ agentRole: role, cvText: CV_SAMPLE, jdText: JD_SAMPLE, tone: "brutal_roast" }, provider)
      ).output;
    }

    const strictReport = generateSynthesisReport(strictOutputs, [], CV_SAMPLE, JD_SAMPLE, "strict");
    const friendlyReport = generateSynthesisReport(friendlyOutputs, [], CV_SAMPLE, JD_SAMPLE, "friendly");
    const roastReport = generateSynthesisReport(roastOutputs, [], CV_SAMPLE, JD_SAMPLE, "brutal_roast");

    expect(friendlyReport.overallScore).toBe(strictReport.overallScore);
    expect(roastReport.overallScore).toBe(strictReport.overallScore);
    expect(friendlyReport.verdict).toBe(strictReport.verdict);
    expect(roastReport.verdict).toBe(strictReport.verdict);

    expect(friendlyReport.dimensions).toEqual(strictReport.dimensions);
    expect(roastReport.dimensions).toEqual(strictReport.dimensions);
  });
});
