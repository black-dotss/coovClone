/**
 * Known Tech & Recruitment Term Aliases Dictionary
 * Maps canonical terms to recognized synonyms and alternate notations.
 */

export const KNOWN_TERM_ALIASES: Record<string, string[]> = {
  typescript: ["ts"],
  javascript: ["js", "ecmascript"],
  postgresql: ["postgres", "pgsql", "psql"],
  react: ["react.js", "reactjs"],
  "next.js": ["nextjs", "next"],
  "node.js": ["nodejs", "node"],
  "vue.js": ["vue", "vuejs"],
  python: ["python3", "py"],
  golang: ["go"],
  kubernetes: ["k8s"],
  docker: ["containers", "containerization"],
  aws: ["amazon web services"],
  gcp: ["google cloud platform", "google cloud"],
  azure: ["microsoft azure"],
  sql: ["structured query language"],
  nosql: ["non-relational database", "document db"],
  mongodb: ["mongo"],
  graphql: ["gql"],
  "rest api": ["restful api", "rest", "restful", "rest apis"],
  "ci/cd": ["continuous integration", "continuous deployment", "ci cd"],
  orm: ["object relational mapping", "drizzle", "prisma", "typeorm"],
  git: ["github", "gitlab", "version control"],
  tailwind: ["tailwindcss", "tailwind css"],
  css: ["cascading style sheets", "css3"],
  html: ["html5"],
  ai: ["artificial intelligence", "machine learning", "ml", "llm"],
  microservices: ["microservice architecture", "distributed systems"],
  testing: ["unit testing", "integration testing", "jest", "vitest", "cypress", "playwright"],
};

/**
 * Returns normalized alias array for a given term.
 */
export function getAliasesForTerm(term: string): string[] {
  const lower = term.toLowerCase().trim();
  const direct = KNOWN_TERM_ALIASES[lower];
  if (direct) {
    return direct;
  }

  // Check if term is an alias itself and return canonical + other aliases
  for (const [canonical, aliases] of Object.entries(KNOWN_TERM_ALIASES)) {
    if (aliases.includes(lower)) {
      return [canonical, ...aliases.filter((a) => a !== lower)];
    }
  }

  return [];
}
