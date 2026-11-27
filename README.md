# CookMyCv 🍳📄

> A recruitment simulation SaaS that evaluates a candidate's CV and job description through a structured panel of AI agents debating evidence and producing actionable reports.

---

## 🛠️ Technology Stack

- **Framework**: Next.js 16 (App Router with Turbopack, strict TypeScript)
- **Database**: Neon PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)
- **Authentication**: [Better Auth](https://better-auth.com/) (Neon-compatible)
- **AI Orchestration**: [LangGraph](https://langchain-ai.github.io/langgraph/) multi-agent panel
- **Payment Verification**: Verify.ET server-to-server verification & HMAC-SHA256 webhooks
- **Validation**: Zod schema validation
- **Testing**: Vitest with Node environment

---

## 📂 Repository & Module Layout

```text
├── app/                  # Next.js App Router pages and API route handlers
│   ├── api/              # Backend HTTP endpoints
│   │   └── health/       # Healthcheck endpoint (x-request-id & standard envelopes)
│   ├── layout.tsx        # Root layout
│   └── page.tsx          # Landing page
├── drizzle/              # Generated SQL migrations (managed by drizzle-kit)
├── lib/                  # Core domain and infrastructure modules
│   ├── agents/           # 6 recruitment agents, roles, and schemas
│   ├── auth/             # Better Auth integration & session utilities
│   ├── billing/          # Plans, quotas, and Ethiopia calendar day boundaries
│   ├── db/               # Neon client & Drizzle schema definitions
│   │   └── schema/       # Database tables, relations, and indexes
│   ├── devices/          # One-device-one-account protection & recovery
│   ├── documents/        # PDF/DOCX upload validation & text extraction
│   ├── env.ts            # Strict Zod environment variable validation
│   ├── evaluations/      # Workflow state, scoring dimensions & verdicts
│   ├── interviews/       # Mock interview coaching & rubric scoring
│   ├── payments/         # Payment orders & Verify.ET verification client
│   ├── reports/          # Report synthesis, PDF generation & share links
│   ├── shared/           # Cross-cutting engineering infrastructure
│   │   ├── api-response.ts # Uniform success/error response helpers & middleware
│   │   ├── errors.ts     # AppError hierarchy with typed error codes
│   │   ├── logger.ts     # Structured JSON logging with automatic secret redaction
│   │   └── request-id.ts # Standard x-request-id handling
│   └── users/            # User profile management & account lifecycle
├── tests/                # Test suite
│   ├── unit/             # Fast, isolated unit tests
│   └── integration/      # End-to-end and database integration tests
├── .env.example          # Template with required variables documented
├── drizzle.config.ts     # Drizzle Kit configuration
└── vitest.config.mts     # Vitest configuration
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js `v20.9+` or `v22+`
- PostgreSQL or [Neon](https://neon.tech) account

### 1. Clone & Install

```bash
git clone https://github.com/your-org/cookmycv.git
cd cookmycv
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
```

Key environment variables:
- `DATABASE_URL`: Neon PostgreSQL connection string (must have `sslmode=require`)
- `BETTER_AUTH_SECRET`: Random 32+ character string
- `DEVICE_TOKEN_SECRET`: Random secret for signing HttpOnly device cookies
- `VERIFY_ET_API_KEY`: Verify.ET verification API key
- `VERIFY_ET_WEBHOOK_SECRET`: HMAC-SHA256 webhook secret

### 3. Database Migrations

Generate and run migrations with Drizzle Kit:

```bash
# Generate SQL migrations from schema
npm run db:generate

# Apply migrations to database
npm run db:migrate

# Open Drizzle Studio database browser
npm run db:studio
```

### 4. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to view the application, or test `GET /api/health`:

```bash
curl http://localhost:3000/api/health
```

---

## 🧪 Testing & Code Quality

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# TypeScript type checking
npm run typecheck

# ESLint check
npm run lint

# Production build check
npm run build
```

---

## 🔒 Security & Logging Standards

1. **Safe Log Redaction**: The structured logger in `lib/shared/logger.ts` automatically redacts sensitive data (passwords, tokens, API keys, full CV text, cover letters, and bank details) from log entries. Never log sensitive candidate documents or secrets.
2. **Device-Based Account Protection**: Enforces the one-device-one-account policy to prevent repeated free-trial claims via HttpOnly signed tokens.
3. **Server-Side Enforcement**: Quotas, pricing, trial status, and payment verification are strictly evaluated and settled server-side in Neon transactions.

---

## 📦 Deployment

- **Vercel / Next.js hosting**: Connect repository and set environment variables matching `.env.example`.
- **Database**: Neon serverless Postgres with pooling enabled for serverless routes.
- **Workers**: Background evaluation jobs run in a dedicated background worker runtime or event-driven serverless processor.
