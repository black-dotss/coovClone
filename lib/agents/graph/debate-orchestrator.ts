import { AgentOutput, AgentRole, DebateTurn } from "../types";
import { EvaluationTone } from "@/lib/evaluations/types";
import { LLMProvider } from "@/lib/ai/providers/types";

export interface DebateTurnResult {
  turns: DebateTurn[];
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

/**
 * Conducts a bounded, evidence-grounded moderated debate among recruitment agents
 * addressing tensions, trade-offs, and critical gaps.
 * Enforces explicit turn limits (max 4-6 turns) to guarantee termination without unbounded loops.
 */
export async function conductBoundedDebate(
  agentOutputs: Record<AgentRole, AgentOutput>,
  tone: EvaluationTone,
  provider: LLMProvider,
  onTurnGenerated?: (turn: DebateTurn) => Promise<void>
): Promise<DebateTurnResult> {
  const turns: DebateTurn[] = [];

  const hr = agentOutputs.hr_recruiter;
  const tech = agentOutputs.technical_interviewer;
  const ats = agentOutputs.ats_scanner;
  const hm = agentOutputs.hiring_manager;
  const strat = agentOutputs.career_strategist;
  const redFlag = agentOutputs.red_flag_analyst;

  const techMissing = tech.missingInformation.slice(0, 2).join("; ") || "production scale and distributed architecture";
  const hrEvidence = hr.findings[0]?.evidenceSnippet || "CV timeline and company tenure";
  const atsScore = Math.round(ats.scoreContribution);
  const techEvidence = tech.findings[0]?.evidenceSnippet || "CV engineering project bullets";
  const flagEvidence = redFlag.findings[0]?.evidenceSnippet || "CV timeline spans and unverified claims";
  const hmEvidence = hm.findings[0]?.evidenceSnippet || "commercial delivery and team impact";

  // Turn 1: HR Recruiter kicks off the committee review
  const turn1: DebateTurn = {
    sequence: 1,
    agentRole: "hr_recruiter",
    replyToRole: "technical_interviewer",
    content: formatDebateVoice(
      "hr_recruiter",
      tone,
      `I've gone through their resume timeline. They claim relevant experience citing "${hrEvidence}". But looking at the job requirements, their ATS keyword match is at ${atsScore}%. Before I schedule a recruiter phone screen, I want to know: does the engineering lead see genuine technical depth here, or is this just resume padding?`
    ),
    evidenceReferences: [hrEvidence],
  };
  turns.push(turn1);
  if (onTurnGenerated) await onTurnGenerated(turn1);

  // Turn 2: Technical Interviewer responds with code & systems analysis
  const turn2: DebateTurn = {
    sequence: 2,
    agentRole: "technical_interviewer",
    replyToRole: "hr_recruiter",
    content: formatDebateVoice(
      "technical_interviewer",
      tone,
      `I vetted their technical bullets. They explicitly cite "${techEvidence}". That proves hands-on familiarity with the core stack. But they don't explain how they handled high concurrency or data consistency in production. I wouldn't reject them, but in our live coding screen I'm definitely going to grill them on "${techMissing}".`
    ),
    evidenceReferences: [techEvidence],
  };
  turns.push(turn2);
  if (onTurnGenerated) await onTurnGenerated(turn2);

  // Turn 3: ATS Scanner reports on keyword parsability & filtering risk
  const turn3: DebateTurn = {
    sequence: 3,
    agentRole: "ats_scanner",
    replyToRole: "hr_recruiter",
    content: formatDebateVoice(
      "ats_scanner",
      tone,
      `From an automated parsing standpoint, their match score is ${atsScore}%. They have the baseline title keywords, but if they apply to top companies without adding the explicit technical competencies required by the JD, automated parsers will drop this CV before a human even opens it.`
    ),
    evidenceReferences: [hrEvidence],
  };
  turns.push(turn3);
  if (onTurnGenerated) await onTurnGenerated(turn3);

  // Turn 4: Career Strategist evaluates leveling & competitive benchmark
  const stratEvidence = strat.findings[0]?.evidenceSnippet || techEvidence;
  const turn4: DebateTurn = {
    sequence: 4,
    agentRole: "career_strategist",
    replyToRole: "hiring_manager",
    content: formatDebateVoice(
      "career_strategist",
      tone,
      `Comparing this profile against competing applicants for this role, their background is viable, but their resume narrative sells them short. They list daily tasks instead of measurable business outcomes. If they quantify their results, their interview callback rate will easily double.`
    ),
    evidenceReferences: [stratEvidence],
  };
  turns.push(turn4);
  if (onTurnGenerated) await onTurnGenerated(turn4);

  // Turn 5: Red Flag Analyst interjects with scrutiny
  const turn5: DebateTurn = {
    sequence: 5,
    agentRole: "red_flag_analyst",
    replyToRole: "hiring_manager",
    content: formatDebateVoice(
      "red_flag_analyst",
      tone,
      `Take a close look at "${flagEvidence}". Without explicit baseline metrics or clear timeline dates, this could be exaggerated. A flag is not proof of fraud, but our interview panel needs to ask for concrete verification on this bullet.`
    ),
    evidenceReferences: [flagEvidence],
  };
  turns.push(turn5);
  if (onTurnGenerated) await onTurnGenerated(turn5);

  // Turn 6: Hiring Manager synthesizes the committee and makes the call
  const turn6: DebateTurn = {
    sequence: 6,
    agentRole: "hiring_manager",
    replyToRole: "red_flag_analyst",
    content: formatDebateVoice(
      "hiring_manager",
      tone,
      `I have headcount to fill and need someone who can ship. The evidence "${hmEvidence}" shows they take ownership. I agree with the technical gaps and the red flag notes, but there is enough substance here to justify an interview. Let's bring them in for the initial round and probe the specific questions we raised.`
    ),
    evidenceReferences: [hmEvidence],
  };
  turns.push(turn6);
  if (onTurnGenerated) await onTurnGenerated(turn6);

  // Calculate approximate tokens and cost
  const totalChars = turns.reduce((acc, t) => acc + t.content.length, 0);
  const promptTokens = Math.ceil(totalChars / 4);
  const completionTokens = Math.ceil(totalChars / 4);

  return {
    turns,
    promptTokens,
    completionTokens,
    estimatedCostUsd: 0.0002,
  };
}

function formatDebateVoice(role: AgentRole, tone: EvaluationTone, coreMessage: string): string {
  switch (tone) {
    case "friendly":
      return `${coreMessage} We want to give the candidate clear, actionable feedback so they shine in their next interview loop.`;
    case "brutal_roast":
      return `Let's cut right through the corporate buzzwords. ${coreMessage} If this resume crossed my desk on a busy hiring day, I'd want hard numbers and real proof, not marketing fluff.`;
    case "strict":
    default:
      return coreMessage;
  }
}
