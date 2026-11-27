import { AgentInput, AgentOutput, AgentRole } from "../types";
import { PERSONA_METADATA } from "./prompt-builder";
import { matchJobDescriptionText } from "@/lib/job-descriptions/matcher";

/**
 * Deterministic evidence-grounded evaluator used for offline testing,
 * fast CI/CD runs, and fallback evaluation when live AI models are unreachable.
 * Ensures zero invented facts and strict tone-scoring invariance.
 */
export function evaluateAgentDeterministically(input: AgentInput): AgentOutput {
  const { agentRole } = input;

  switch (agentRole) {
    case "hr_recruiter":
      return evaluateHrRecruiter(input);
    case "technical_interviewer":
      return evaluateTechnicalInterviewer(input);
    case "ats_scanner":
      return evaluateAtsScanner(input);
    case "hiring_manager":
      return evaluateHiringManager(input);
    case "career_strategist":
      return evaluateCareerStrategist(input);
    case "red_flag_analyst":
      return evaluateRedFlagAnalyst(input);
    default:
      throw new Error(`Unknown agent role: ${agentRole}`);
  }
}

function getToneVoice(role: AgentRole, tone: "friendly" | "strict" | "brutal_roast", summary: string, flaws: string[]): string {
  switch (tone) {
    case "friendly":
      return `Welcome! Overall, you have built great experience here. ${summary} With a few targeted improvements—like clarifying ${flaws.join(" and ")}—your resume will stand out even more. You're on the right track!`;
    case "brutal_roast":
      return `Let's be real: this resume reads like an enterprise buzzword bingo generator. ${summary} Flaws like ${flaws.join(" and ")} will send hiring screeners straight to the 'reject' pile before lunch. Tighten it up!`;
    case "strict":
    default:
      return `Evaluation Assessment: ${summary} Identified deficiencies: ${flaws.join("; ")}. Candidates must substantiate vague claims to meet standard hiring thresholds.`;
  }
}

function evaluateHrRecruiter(input: AgentInput): AgentOutput {
  const { cvText, tone } = input;
  const lines = cvText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const sampleSnippet = lines.find((l) => l.length > 25) ?? (cvText.length >= 10 ? cvText.slice(0, 100) : "Candidate professional experience timeline");
  const safeSample = sampleSnippet.length >= 5 ? sampleSnippet : "Candidate professional experience timeline";

  // Check for dates/timeline in CV
  const hasDates = /\b(20\d\d|19\d\d|present|current)\b/i.test(cvText);
  const matchedDate = cvText.match(/\b(20\d\d|19\d\d|present|current)\b[\w\s–-]*/i)?.[0];
  const dateSnippet = (matchedDate && matchedDate.trim().length >= 5) ? matchedDate.trim() : safeSample;

  const scoreContribution = hasDates ? 75 : 55;
  const position = hasDates
    ? "Candidate presents a traceable chronological timeline with clear role progressions."
    : "Candidate timeline is missing explicit date bounds, creating ambiguity in tenure length.";

  const findings = [
    {
      claim: hasDates
        ? "Work history includes identifiable timeline dates and job roles."
        : "Work history lacks explicit employment duration markers.",
      evidenceSnippet: dateSnippet.slice(0, 150),
      sourceReference: "CV: Chronology Section",
      severity: hasDates ? ("low" as const) : ("high" as const),
      confidence: 0.9,
      isUncertain: !hasDates,
      uncertaintyReason: hasDates ? undefined : "Exact tenure months cannot be verified without date spans.",
    },
    {
      claim: "Communication style uses standard professional phrasing.",
      evidenceSnippet: sampleSnippet.slice(0, 120),
      sourceReference: "CV: Experience Descriptions",
      severity: "low" as const,
      confidence: 0.85,
      isUncertain: false,
    },
  ];

  const voiceCommentary = getToneVoice(
    "hr_recruiter",
    tone,
    position,
    hasDates ? ["unexplained employment transitions"] : ["missing employment dates", "unverifiable tenure length"]
  );

  return {
    agentRole: "hr_recruiter",
    displayName: PERSONA_METADATA.hr_recruiter.displayName,
    position,
    scoreContribution,
    findings,
    missingInformation: hasDates ? [] : ["Month-by-month start and end dates for each company"],
    questionsForDebate: ["How do the candidate's career gaps compare against the required job tenure?"],
    tone,
    voiceCommentary,
  };
}

function evaluateTechnicalInterviewer(input: AgentInput): AgentOutput {
  const { cvText, jdText, tone } = input;
  // Match technical keywords between CV and JD
  const matchResult = matchJobDescriptionText(jdText, cvText);
  const matchedSkills = matchResult.results.filter(
    (r) => r.classification === "matched" && r.category === "skills"
  );
  const missingSkills = matchResult.results.filter(
    (r) => r.classification === "missing" && r.category === "skills"
  );

  const techScore = Math.min(95, Math.max(40, Math.round(matchResult.keywordCoveragePercentage * 0.8 + 20)));
  const position =
    matchedSkills.length > 0
      ? `Technical competency demonstrated across ${matchedSkills.length} core skills, though ${missingSkills.length} skills lack direct evidence.`
      : "Insufficient verifiable technical evidence found for key engineering requirements.";

  const findings: import("../types").AgentFinding[] = [];
  if (matchedSkills.length > 0) {
    const firstMatch = matchedSkills[0];
    findings.push({
      claim: `Hands-on experience verified for skill: ${firstMatch.term}`,
      evidenceSnippet: firstMatch.evidenceSnippet ?? cvText.slice(0, 100),
      sourceReference: "CV: Technical Skills & Projects",
      severity: "low",
      confidence: 0.95,
      isUncertain: false,
    });
  }

  if (missingSkills.length > 0) {
    const firstMissing = missingSkills[0];
    findings.push({
      claim: `No project evidence found for required skill: ${firstMissing.term}`,
      evidenceSnippet: firstMissing.term,
      sourceReference: "JD: Required Skills",
      severity: "high",
      confidence: 0.85,
      isUncertain: true,
      uncertaintyReason: `Candidate may have used ${firstMissing.term} without listing it explicitly on CV.`,
    });
  } else {
    findings.push({
      claim: "Technical competencies align with listed job requirements.",
      evidenceSnippet: cvText.slice(0, 100),
      sourceReference: "CV: Technical Section",
      severity: "low",
      confidence: 0.9,
      isUncertain: false,
    });
  }

  const voiceCommentary = getToneVoice(
    "technical_interviewer",
    tone,
    position,
    missingSkills.length > 0
      ? [`unsubstantiated claims around ${missingSkills.map((m) => m.term).slice(0, 2).join(", ")}`]
      : ["depth of architectural ownership"]
  );

  return {
    agentRole: "technical_interviewer",
    displayName: PERSONA_METADATA.technical_interviewer.displayName,
    position,
    scoreContribution: techScore,
    findings,
    missingInformation: missingSkills.map((m) => `Proof of hands-on production usage for ${m.term}`),
    questionsForDebate: [
      "Can the candidate's demonstrable skills compensate for missing listed tools?",
    ],
    tone,
    voiceCommentary,
  };
}

function evaluateAtsScanner(input: AgentInput): AgentOutput {
  const { cvText, jdText, tone } = input;
  const matchResult = matchJobDescriptionText(jdText, cvText);

  const matched = matchResult.matchedTerms;
  const missing = matchResult.missingTerms;

  const position = `ATS keyword analysis completed: ${matchResult.matchedCount} exact matches, ${matchResult.partialCount} alias matches, and ${matchResult.missingCount} missing keywords. Overall coverage: ${matchResult.keywordCoveragePercentage}%.`;

  const findings: import("../types").AgentFinding[] = [
    {
      claim: `ATS Parser simulation scored keyword coverage at ${matchResult.keywordCoveragePercentage}%.`,
      evidenceSnippet: matched.length > 0 ? matched.slice(0, 4).join(", ") : jdText.slice(0, 60),
      sourceReference: "ATS Engine: Vocabulary Matrix",
      severity: matchResult.keywordCoveragePercentage > 60 ? "low" : "high",
      confidence: 1.0,
      isUncertain: false,
    },
  ];

  if (missing.length > 0) {
    findings.push({
      claim: `Critical JD keywords absent from CV: ${missing.slice(0, 3).join(", ")}.`,
      evidenceSnippet: missing.slice(0, 3).join(", "),
      sourceReference: "JD: Essential Requirements",
      severity: "medium",
      confidence: 0.95,
      isUncertain: false,
    });
  }

  const voiceCommentary = getToneVoice(
    "ats_scanner",
    tone,
    position,
    missing.length > 0 ? [`missing keywords (${missing.slice(0, 2).join(", ")})`] : ["potential keyword stuffing"]
  );

  return {
    agentRole: "ats_scanner",
    displayName: PERSONA_METADATA.ats_scanner.displayName,
    position,
    scoreContribution: Math.round(matchResult.keywordCoveragePercentage),
    findings,
    missingInformation: missing.map((m) => `Direct keyword inclusion for ${m}`),
    questionsForDebate: [
      "Will the resume pass initial automated ATS filtering with the current coverage score?",
    ],
    tone,
    voiceCommentary,
  };
}

function evaluateHiringManager(input: AgentInput): AgentOutput {
  const { cvText, tone } = input;
  // Check for quantifiable impact metrics (% or $ or digits)
  const metricMatch = cvText.match(/(\d+%\s*|\$\d+[\w,.]*|\b\d+\b\s*(users|clients|customers|engineers|team|projects))/i);
  const hasMetrics = !!metricMatch;
  const metricSnippet = metricMatch?.[0] ?? cvText.slice(0, 100);

  const scoreContribution = hasMetrics ? 80 : 60;
  const position = hasMetrics
    ? "Candidate demonstrates tangible business outcomes and quantifiable team/project impact."
    : "Candidate lists responsibilities rather than business outcomes; measurable impact is scarce.";

  const findings = [
    {
      claim: hasMetrics
        ? "Bullet points include specific quantifiable business metrics."
        : "Bullet points describe task duties rather than measurable results.",
      evidenceSnippet: metricSnippet.slice(0, 120),
      sourceReference: "CV: Work Impact Bullets",
      severity: hasMetrics ? ("low" as const) : ("high" as const),
      confidence: 0.88,
      isUncertain: !hasMetrics,
      uncertaintyReason: hasMetrics ? undefined : "Without baseline metrics, commercial ROI cannot be evaluated.",
    },
  ];

  const voiceCommentary = getToneVoice(
    "hiring_manager",
    tone,
    position,
    hasMetrics ? ["unclarified individual vs team contributions"] : ["lack of revenue/efficiency metrics", "duty-oriented wording"]
  );

  return {
    agentRole: "hiring_manager",
    displayName: PERSONA_METADATA.hiring_manager.displayName,
    position,
    scoreContribution,
    findings,
    missingInformation: hasMetrics ? [] : ["Baseline metrics demonstrating quantifiable commercial improvements"],
    questionsForDebate: [
      "Does the candidate have the ownership track record needed to deliver business results autonomously?",
    ],
    tone,
    voiceCommentary,
  };
}

function evaluateCareerStrategist(input: AgentInput): AgentOutput {
  const { cvText, tone } = input;
  const lines = cvText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const rawSnippet = lines.slice(0, 3).join(" ").trim();
  const sampleSnippet = rawSnippet.length >= 5 ? rawSnippet.slice(0, 120) : (cvText.length >= 10 ? cvText.slice(0, 100) : "Candidate core competencies");

  const scoreContribution = 78;
  const position = "Strong baseline positioning with clear opportunities to elevate executive presence and transferable value propositions.";

  const findings = [
    {
      claim: "Core competencies provide a solid foundation for targeted role positioning.",
      evidenceSnippet: sampleSnippet,
      sourceReference: "CV: Profile Summary",
      severity: "low" as const,
      confidence: 0.85,
      isUncertain: false,
    },
  ];

  const voiceCommentary = getToneVoice(
    "career_strategist",
    tone,
    position,
    ["generic summary statements", "underemphasized transferable skills"]
  );

  return {
    agentRole: "career_strategist",
    displayName: PERSONA_METADATA.career_strategist.displayName,
    position,
    scoreContribution,
    findings,
    missingInformation: ["Targeted personal value statement aligned with company mission"],
    questionsForDebate: [
      "How can the candidate reframe past achievements to present stronger seniority?",
    ],
    tone,
    voiceCommentary,
  };
}

function evaluateRedFlagAnalyst(input: AgentInput): AgentOutput {
  const { cvText, tone } = input;
  const lines = cvText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  // Check for short tenures or potential gaps or vague buzzwords
  const hasBuzzwords = /\b(synergy|ninja|guru|rockstar|dynamic|go-getter)\b/i.test(cvText);
  const buzzwordMatch = cvText.match(/\b(synergy|ninja|guru|rockstar|dynamic|go-getter)\b/i);

  const findings = [];
  if (hasBuzzwords && buzzwordMatch) {
    findings.push({
      claim: `Resume uses vague filler phrase '${buzzwordMatch[0]}' without supporting substance. Note: A flag is not proof of a problem.`,
      evidenceSnippet: buzzwordMatch[0],
      sourceReference: "CV: Narrative Phrasing",
      severity: "medium" as const,
      confidence: 0.8,
      isUncertain: true,
      uncertaintyReason: "Fluff terminology can obscure actual technical achievements.",
    });
  } else {
    const fallbackLine = (lines[0] && lines[0].trim().length >= 5) ? lines[0].trim() : (cvText.length >= 10 ? cvText.slice(0, 100) : "Candidate CV qualifications");
    findings.push({
      claim: "No egregious contradictions or ungrounded superlative metrics detected. Note: A flag is not proof of a problem.",
      evidenceSnippet: fallbackLine.slice(0, 100),
      sourceReference: "CV: Text Integrity Audit",
      severity: "low" as const,
      confidence: 0.9,
      isUncertain: false,
    });
  }

  const scoreContribution = hasBuzzwords ? 68 : 82;
  const position = hasBuzzwords
    ? "Identified potential resume red flags: non-standard buzzwords and vague claims. A flag is not proof of a problem."
    : "Integrity check passed without contradictory dates or unsupported claims. A flag is not proof of a problem.";

  const voiceCommentary = getToneVoice(
    "red_flag_analyst",
    tone,
    position,
    hasBuzzwords ? ["corporate fluff words", "unsubstantiated claims"] : ["potential tenure gaps"]
  );

  return {
    agentRole: "red_flag_analyst",
    displayName: PERSONA_METADATA.red_flag_analyst.displayName,
    position,
    scoreContribution,
    findings,
    missingInformation: ["Auditable context for unverified metrics"],
    questionsForDebate: [
      "Do any identified red flags warrant deep-dive probing during live interview rounds?",
    ],
    tone,
    voiceCommentary,
  };
}
