export type RequirementCategory =
  | "skills"
  | "experience"
  | "responsibilities"
  | "education"
  | "domain_terms";

export type RequirementImportance = "required" | "preferred";

export type MatchClassification = "matched" | "partial" | "missing";

export interface ExtractedRequirement {
  id: string;
  category: RequirementCategory;
  importance: RequirementImportance;
  term: string;
  rawText: string;
  aliases: string[];
  confidence: number;
}

export interface NormalizedRequirements {
  title?: string;
  company?: string;
  minYearsExperience?: number;
  educationLevel?: string;
  requirements: ExtractedRequirement[];
  summary: {
    requiredCount: number;
    preferredCount: number;
    categoryCounts: Record<RequirementCategory, number>;
  };
}

export interface JobDescriptionRecord {
  id: string;
  userId: string;
  title: string | null;
  company: string | null;
  rawText: string;
  normalizedRequirements: NormalizedRequirements;
  createdAt: Date;
  updatedAt: Date;
}

export interface MatchedRequirementResult {
  requirementId: string;
  category: RequirementCategory;
  importance: RequirementImportance;
  term: string;
  classification: MatchClassification;
  isAliasMatch: boolean;
  matchedTerm?: string;
  evidenceSnippet?: string;
  confidence: number;
}

export interface AtsMatchReport {
  jobDescriptionId?: string;
  totalRequirements: number;
  matchedCount: number;
  partialCount: number;
  missingCount: number;
  keywordCoveragePercentage: number;
  results: MatchedRequirementResult[];
  matchedTerms: string[];
  partialTerms: string[];
  missingTerms: string[];
  disclaimer: string;
}
