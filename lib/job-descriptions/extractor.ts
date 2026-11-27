import { randomUUID } from "node:crypto";
import { getAliasesForTerm } from "./aliases";
import type {
  ExtractedRequirement,
  NormalizedRequirements,
  RequirementCategory,
  RequirementImportance,
} from "./types";

const SECTION_HEADERS = {
  REQUIRED: /required|requirements|qualifications|must have|what you need|who you are/i,
  PREFERRED: /preferred|nice to have|plus|bonus|optional|good to have/i,
  RESPONSIBILITIES: /responsibilities|what you will do|duties|role overview/i,
  EDUCATION: /education|degree|bachelor|master|phd/i,
};

const COMMON_SKILL_PATTERNS = [
  /\b(typescript|javascript|python|golang|java|c\+\+|c#|ruby|php|rust|swift|kotlin|scala)\b/gi,
  /\b(react(?:\.js)?|next(?:\.js)?|vue(?:\.js)?|angular|svelte|node(?:\.js)?|express|django|flask|spring|fastapi)\b/gi,
  /\b(sql|postgresql|postgres|mysql|sqlite|mongodb|redis|dynamodb|cassandra|elasticsearch)\b/gi,
  /\b(aws|amazon web services|gcp|google cloud|azure|docker|kubernetes|k8s|terraform|ansible)\b/gi,
  /\b(graphql|gql|rest(?:\s*api)?|restful|grpc|websockets|trpc)\b/gi,
  /\b(ci\/cd|git|github|gitlab|linux|kafka|rabbitmq|rabbitmq)\b/gi,
  /\b(drizzle|prisma|typeorm|tailwind(?:css)?|redux|zustand)\b/gi,
  /\b(vitest|jest|cypress|playwright|selenium|unit testing)\b/gi,
  /\b(microservices|distributed systems|system design|agile|scrum)\b/gi,
];

const EXPERIENCE_REGEX = /(\d+)\+?\s*(?:to\s*(\d+))?\s*(?:-\s*(\d+))?\s*years?(?:\s*of)?\s*(?:experience|hands-on)/i;
const EDUCATION_REGEX = /\b(bachelor(?:'s)?|master(?:'s)?|phd|b\.?s\.?|m\.?s\.?|degree)\s*(?:in\s+([a-zA-Z\s]+))?/i;

/**
 * Parses raw job description text into structured, categorized requirements.
 */
export function extractAndNormalizeRequirements(rawText: string): NormalizedRequirements {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let currentImportance: RequirementImportance = "required";
  let currentSection: "requirements" | "preferred" | "responsibilities" | "education" | "general" =
    "general";

  const extractedList: ExtractedRequirement[] = [];
  const seenTerms = new Set<string>();

  let detectedMinYears: number | undefined;
  let detectedEducation: string | undefined;

  for (const line of lines) {
    // Detect section headers
    if (SECTION_HEADERS.PREFERRED.test(line)) {
      currentImportance = "preferred";
      currentSection = "preferred";
      continue;
    } else if (SECTION_HEADERS.REQUIRED.test(line)) {
      currentImportance = "required";
      currentSection = "requirements";
      continue;
    } else if (SECTION_HEADERS.RESPONSIBILITIES.test(line)) {
      currentSection = "responsibilities";
      continue;
    }

    // 1. Check for Years of Experience
    const expMatch = line.match(EXPERIENCE_REGEX);
    if (expMatch) {
      const years = parseInt(expMatch[1], 10);
      if (!detectedMinYears || years > detectedMinYears) {
        detectedMinYears = years;
      }
      const term = `${years}+ years of experience`;
      if (!seenTerms.has(term.toLowerCase())) {
        seenTerms.add(term.toLowerCase());
        extractedList.push({
          id: randomUUID(),
          category: "experience",
          importance: currentImportance,
          term,
          rawText: line,
          aliases: [`${years} years`, `${years}+ years`],
          confidence: 0.95,
        });
      }
    }

    // 2. Check for Education
    const eduMatch = line.match(EDUCATION_REGEX);
    if (eduMatch) {
      const degree = eduMatch[0].trim();
      detectedEducation = degree;
      if (!seenTerms.has(degree.toLowerCase())) {
        seenTerms.add(degree.toLowerCase());
        extractedList.push({
          id: randomUUID(),
          category: "education",
          importance: currentImportance,
          term: degree,
          rawText: line,
          aliases: ["Bachelor", "Degree", "BS", "Computer Science"],
          confidence: 0.9,
        });
      }
    }

    // 3. Extract Technical Skills via Patterns
    for (const pattern of COMMON_SKILL_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const rawSkill = match[0].trim();
        const normalizedKey = rawSkill.toLowerCase();

        if (!seenTerms.has(normalizedKey)) {
          seenTerms.add(normalizedKey);
          const aliases = getAliasesForTerm(rawSkill);
          extractedList.push({
            id: randomUUID(),
            category: "skills",
            importance: currentImportance,
            term: rawSkill,
            rawText: line,
            aliases,
            confidence: 0.95,
          });
        }
      }
    }

    // 4. Extract Responsibilities if in that section and line is a bullet/action
    if (currentSection === "responsibilities" && line.length > 20 && /^[-*•\d.]/.test(line)) {
      const cleanLine = line.replace(/^[-*•\d.]\s*/, "").trim();
      const key = cleanLine.slice(0, 40).toLowerCase();
      if (!seenTerms.has(key)) {
        seenTerms.add(key);
        extractedList.push({
          id: randomUUID(),
          category: "responsibilities",
          importance: "required",
          term: cleanLine.slice(0, 80),
          rawText: line,
          aliases: [],
          confidence: 0.85,
        });
      }
    }
  }

  // Summary counts
  const categoryCounts: Record<RequirementCategory, number> = {
    skills: 0,
    experience: 0,
    responsibilities: 0,
    education: 0,
    domain_terms: 0,
  };

  let requiredCount = 0;
  let preferredCount = 0;

  for (const req of extractedList) {
    categoryCounts[req.category] = (categoryCounts[req.category] || 0) + 1;
    if (req.importance === "required") {
      requiredCount++;
    } else {
      preferredCount++;
    }
  }

  return {
    minYearsExperience: detectedMinYears,
    educationLevel: detectedEducation,
    requirements: extractedList,
    summary: {
      requiredCount,
      preferredCount,
      categoryCounts,
    },
  };
}
