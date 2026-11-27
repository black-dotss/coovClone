"""
Builds the comprehensive publication-grade PDF document:
'AGENT_ARCHITECTURE_WORKFLOW.pdf' in the root directory of CookMyCV.
Includes in-depth technical analysis and 8 high-resolution architectural figures.
"""

import os
import shutil
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSETS_DIR = os.path.join(ROOT_DIR, ".diagram_assets")
PDF_PATH_1 = os.path.join(ROOT_DIR, "AGENT_ARCHITECTURE_WORKFLOW.pdf")
PDF_PATH_2 = os.path.join(ROOT_DIR, "AGENT_ARCHITECTURE.pdf")

# Page dimensions for A4: 595.27 x 841.89 points
PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN_LEFT = 40
MARGIN_RIGHT = 40
MARGIN_TOP = 45
MARGIN_BOTTOM = 45
USABLE_WIDTH = PAGE_WIDTH - (MARGIN_LEFT + MARGIN_RIGHT) # 515.27 pt

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_header_footer(num_pages)
            super().showPage()
        super().save()

    def draw_header_footer(self, page_count):
        self.saveState()
        # Suppress header and footer on cover page (page 1)
        if self._pageNumber > 1:
            # Header
            self.setFont("Helvetica", 8)
            self.setFillColor(colors.HexColor("#64748B"))
            self.drawString(MARGIN_LEFT, PAGE_HEIGHT - 30, "CookMyCV Platform Architecture  |  Multi-Agent Recruitment Simulation Specification")
            self.setStrokeColor(colors.HexColor("#E2E8F0"))
            self.setLineWidth(0.5)
            self.line(MARGIN_LEFT, PAGE_HEIGHT - 34, PAGE_WIDTH - MARGIN_RIGHT, PAGE_HEIGHT - 34)

            # Footer
            self.line(MARGIN_LEFT, 36, PAGE_WIDTH - MARGIN_RIGHT, 36)
            self.drawString(MARGIN_LEFT, 24, "CONFIDENTIAL & PROPRIETARY  —  COOKMYCV RECRUITMENT SIMULATION ENGINE")
            page_text = f"Page {self._pageNumber} of {page_count}"
            self.drawRightString(PAGE_WIDTH - MARGIN_RIGHT, 24, page_text)

        self.restoreState()

def create_specification_pdf():
    doc = SimpleDocTemplate(
        PDF_PATH_1,
        pagesize=A4,
        leftMargin=MARGIN_LEFT,
        rightMargin=MARGIN_RIGHT,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM
    )

    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        "CoverTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=24,
        leading=30,
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=8
    )

    subtitle_style = ParagraphStyle(
        "CoverSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#6D28D9"),
        spaceAfter=15
    )

    h1_style = ParagraphStyle(
        "SectionH1",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=21,
        textColor=colors.HexColor("#0F172A"),
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        "SectionH2",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#1E293B"),
        spaceBefore=10,
        spaceAfter=6,
        keepWithNext=True
    )

    h3_style = ParagraphStyle(
        "SectionH3",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor("#475569"),
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        "BodyDark",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#334155"),
        spaceAfter=7
    )

    bullet_style = ParagraphStyle(
        "BulletText",
        parent=body_style,
        leftIndent=15,
        bulletIndent=5,
        spaceAfter=4
    )

    code_style = ParagraphStyle(
        "CodeText",
        parent=styles["Normal"],
        fontName="Courier",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#0F172A")
    )

    caption_style = ParagraphStyle(
        "FigCaption",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor("#64748B"),
        alignment=1, # Centered
        spaceBefore=6,
        spaceAfter=12
    )

    meta_label = ParagraphStyle(
        "MetaLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor("#475569")
    )

    meta_val = ParagraphStyle(
        "MetaVal",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor("#0F172A")
    )

    table_header = ParagraphStyle(
        "TableHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=colors.white
    )

    table_cell = ParagraphStyle(
        "TableCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#1E293B")
    )

    callout_text = ParagraphStyle(
        "CalloutText",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor("#1E293B")
    )

    story = []

    # ==========================================
    # COVER / HEADER BANNER
    # ==========================================
    # Header block table
    header_data = [
        [
            Paragraph("<b>COOKMYCV PLATFORM</b> | SYSTEM ARCHITECTURE SPECIFICATION", ParagraphStyle("HdrLogo", fontName="Helvetica-Bold", fontSize=9, textColor=colors.HexColor("#7C3AED"))),
            Paragraph("RECRUITMENT SIMULATION ENGINE v2.4", ParagraphStyle("HdrVer", fontName="Helvetica-Bold", fontSize=9, alignment=2, textColor=colors.HexColor("#64748B")))
        ]
    ]
    hdr_table = Table(header_data, colWidths=[300, USABLE_WIDTH - 300])
    hdr_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(hdr_table)
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#7C3AED"), spaceBefore=3, spaceAfter=14))

    story.append(Paragraph("CookMyCV Multi-Agent Recruitment Simulation Engine", title_style))
    story.append(Paragraph("Architectural Workflow, LangGraph State Machine, 6-Persona Committee Deliberation, Anti-Hallucination Evidence Grounding, and Quantitative Scoring Specification", subtitle_style))

    # Metadata Grid
    meta_data = [
        [
            Paragraph("<b>Document Author:</b>", meta_label), Paragraph("CookMyCV Core Engineering Team", meta_val),
            Paragraph("<b>Primary Engine:</b>", meta_label), Paragraph("LangGraph + StateGraph", meta_val)
        ],
        [
            Paragraph("<b>LLM Backends:</b>", meta_label), Paragraph("Google Gemini 3.5 Flash / OpenAI GPT-4o", meta_val),
            Paragraph("<b>Database:</b>", meta_label), Paragraph("Neon Serverless PostgreSQL (Drizzle ORM)", meta_val)
        ],
        [
            Paragraph("<b>Document Status:</b>", meta_label), Paragraph("Production Engineering Specification", meta_val),
            Paragraph("<b>Classification:</b>", meta_label), Paragraph("Confidential & Proprietary", meta_val)
        ]
    ]
    meta_table = Table(meta_data, colWidths=[90, 165, 95, USABLE_WIDTH - 350])
    meta_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#E2E8F0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 14))

    # Executive Overview
    story.append(Paragraph("Executive Overview: The Paradigm Shift in Automated Resume Evaluation", h2_style))
    story.append(Paragraph(
        "Traditional automated resume review tools rely either on rigid keyword heuristics (legacy ATS regex scanners) "
        "or shallow single-prompt Large Language Model (LLM) passes (e.g. <i>'Rate this CV from 1 to 10 and give tips'</i>). "
        "Both approaches fail catastrophically in production: keyword scanners suffer from severe false rejection rates due to missing synonyms, "
        "while single-prompt LLMs hallucinate candidate skills, generate contradictory platitudes, flatter candidates with generic praise, "
        "and lack the tension, skepticism, and holistic scrutiny of a real hiring team.",
        body_style
    ))
    story.append(Paragraph(
        "<b>CookMyCV</b> introduces a multi-agent architectural paradigm: an autonomous <b>6-Persona Recruitment Committee</b> "
        "orchestrated as a stateful, cyclic directed graph via <b>LangGraph</b>. Instead of a monolithic model, CookMyCV models "
        "the exact organizational tensions of an elite hiring committee: a skeptical HR screener searching for red flags, a technical "
        "interviewer probing architectural depth, an automated ATS scanner evaluating parser viability, an outcome-driven hiring manager "
        "guarding team headcount and ROI, an executive career strategist assessing market leveling, and an adversarial risk auditor.",
        body_style
    ))
    story.append(Paragraph(
        "The agents do not operate in silos. They independently review the candidate document against the target job description, "
        "extract verbatim evidence snippets, enter a <b>bounded cross-examination debate</b> where they challenge each other's assessments, "
        "and mathematically synthesize their collective verdict into a multi-dimensional scorecard, actionable fixes, and truthful rewrites.",
        body_style
    ))

    # Table of Contents Box
    toc_data = [
        [Paragraph("<b>CORE ARCHITECTURAL SPECIFICATION SECTIONS</b>", ParagraphStyle("TOCHead", fontName="Helvetica-Bold", fontSize=9, textColor=colors.HexColor("#4C1D95")))],
        [Paragraph("1. High-Level System Architecture & Ingestion Pipeline (FIG. 1)", body_style)],
        [Paragraph("2. LangGraph Orchestration Engine & State Machine DAG (FIG. 2)", body_style)],
        [Paragraph("3. The 6 AI Committee Personas & Behavioral Specifications (FIG. 3)", body_style)],
        [Paragraph("4. Bounded Multi-Turn Moderated Cross-Debate Protocol (FIG. 4)", body_style)],
        [Paragraph("5. Anti-Hallucination & Verbatim Evidence Grounding Engine (FIG. 5)", body_style)],
        [Paragraph("6. Checkpoint-Aware Worker Lifecycle, Resiliency & Storage (FIG. 6)", body_style)],
        [Paragraph("7. Quantitative Scoring Engine, 5D Weighting & ATS Matcher (FIG. 7)", body_style)],
        [Paragraph("8. Downstream Intelligence: Truthful Rewrites, Defense & Interviews (FIG. 8)", body_style)],
        [Paragraph("9. Production Engineering, Fault Tolerance & Enterprise Security", body_style)],
    ]
    toc_table = Table(toc_data, colWidths=[USABLE_WIDTH])
    toc_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EDE9FE")),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#F5F3FF")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#DDD6FE")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(toc_table)

    story.append(PageBreak())

    # ==========================================
    # SECTION 1: HIGH-LEVEL ARCHITECTURE
    # ==========================================
    story.append(Paragraph("1. High-Level System Architecture & Ingestion Pipeline", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))
    
    story.append(Paragraph(
        "The CookMyCV platform is architected around five distinct, decoupled architectural layers designed for high concurrency, "
        "deterministic safety, and enterprise fault tolerance:",
        body_style
    ))
    story.append(Paragraph("• <b>Client & Presentation Tier:</b> Built with Next.js 16 (React 19) and Tailwind CSS, featuring full-width layouts, dynamic score radar cards, a Telegram-style real-time agent debate chat, and Server-Sent Events (SSE) live progress streaming.", bullet_style))
    story.append(Paragraph("• <b>Ingestion, Document Parsing & Quota Tier:</b> Handles multi-format binary resume ingestion (PDF, DOCX) via <code>pdf-parse</code> and <code>mammoth</code>. Raw documents are stored with private cryptographic keys in object storage, accompanied by client-side device fingerprinting, IP hashing, and atomic PostgreSQL credit reservations to prevent abuse.", bullet_style))
    story.append(Paragraph("• <b>LangGraph Multi-Agent Orchestration Tier:</b> Compiles an immutable <code>StateGraph</code> with typed state annotations, bounded concurrency gates (<code>ConcurrencyLimiter</code>), and multi-agent coordination nodes.", bullet_style))
    story.append(Paragraph("• <b>Model & Grounding Verification Tier:</b> Integrates Google Gemini 3.5 Flash (primary model), OpenAI GPT-4o, and deterministic fallback evaluators. Enforces strict Zod schema validation and substring evidence verification.", bullet_style))
    story.append(Paragraph("• <b>Persistence & Downstream Tier:</b> Uses Neon serverless PostgreSQL managed via Drizzle ORM for idempotent step-by-step checkpointing, powering downstream modules including truthful bullet rewrites, candidate defense, and mock interview simulation.", bullet_style))

    story.append(Spacer(1, 6))

    # Figure 1
    fig1_path = os.path.join(ASSETS_DIR, "fig1_system_architecture.png")
    if os.path.exists(fig1_path):
        img_w = USABLE_WIDTH
        img_h = (1000 / 2000) * img_w # 257.6 pt
        story.append(Image(fig1_path, width=img_w, height=img_h))
        story.append(Paragraph("Figure 1: CookMyCV End-to-End Multi-Agent Architecture Pipeline from Ingestion to Synthesis and Persistence", caption_style))

    story.append(Paragraph("Ingestion Security & Atomic Quota Reservation", h2_style))
    story.append(Paragraph(
        "When a candidate initiates an evaluation, the system executes an atomic transaction in <code>lib/evaluations/service.ts</code>. "
        "Before any LLM compute is dispatched, the candidate's device fingerprint, IP address, and active plan quotas are inspected via "
        "<code>reserveEvaluationCredit()</code>. If quota is available, credit is reserved in an uncommitted state and associated with an idempotent "
        "<code>reservationId</code>. If the evaluation succeeds, credit is atomically settled; if cancelled or failed, it is immediately released back to the user.",
        body_style
    ))

    story.append(PageBreak())

    # ==========================================
    # SECTION 2: LANGGRAPH STATE MACHINE
    # ==========================================
    story.append(Paragraph("2. LangGraph Orchestration Engine & State Machine DAG", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "At the core of CookMyCV's execution lifecycle is a compiled <b>LangGraph StateGraph</b> (implemented in <code>lib/agents/graph/workflow.ts</code>). "
        "LangGraph manages cyclic and acyclic graph execution with typed state annotations, custom reducers, and real-time event callbacks.",
        body_style
    ))

    # Figure 2
    fig2_path = os.path.join(ASSETS_DIR, "fig2_langgraph_dag.png")
    if os.path.exists(fig2_path):
        img_w = USABLE_WIDTH
        img_h = (950 / 2000) * img_w
        story.append(Image(fig2_path, width=img_w, height=img_h))
        story.append(Paragraph("Figure 2: LangGraph Execution DAG, StateGraph Reducers, Node Transitions, and Typed State Annotation Schema", caption_style))

    story.append(Paragraph("State Structure & Custom Reducer Semantics", h2_style))
    story.append(Paragraph(
        "LangGraph manages state through <code>EvaluationStateAnnotation</code>. Because multiple agents execute concurrently during the first phase, "
        "state conflicts are prevented via functional reducers:",
        body_style
    ))

    schema_data = [
        [Paragraph("<b>State Field</b>", table_header), Paragraph("<b>Type</b>", table_header), Paragraph("<b>Reducer Function</b>", table_header), Paragraph("<b>Architectural Purpose</b>", table_header)],
        [Paragraph("<code>evaluationId</code>", code_style), Paragraph("string", code_style), Paragraph("Last-write-wins", table_cell), Paragraph("Unique evaluation execution identifier.", table_cell)],
        [Paragraph("<code>agentOutputs</code>", code_style), Paragraph("Record&lt;AgentRole, Output&gt;", code_style), Paragraph("<code>(x, y) =&gt; ({ ...x, ...y })</code>", code_style), Paragraph("Merges outputs as parallel agents complete.", table_cell)],
        [Paragraph("<code>debateTurns</code>", code_style), Paragraph("DebateTurn[]", code_style), Paragraph("<code>(x, y) =&gt; [...x, ...y]</code>", code_style), Paragraph("Append-only log of moderated committee debate.", table_cell)],
        [Paragraph("<code>finalReport</code>", code_style), Paragraph("SynthesisReport | null", code_style), Paragraph("<code>(_, y) =&gt; y</code>", code_style), Paragraph("Atomic assignment of calibrated synthesis report.", table_cell)],
        [Paragraph("<code>totalTokenUsage</code>", code_style), Paragraph("TokenUsage", code_style), Paragraph("Accumulator (sum tokens + usd)", code_style), Paragraph("Audit ledger for tokens and cost tracking.", table_cell)],
        [Paragraph("<code>error</code>", code_style), Paragraph("string | null", code_style), Paragraph("<code>(_, y) =&gt; y</code>", code_style), Paragraph("Fatal error propagation boundary.", table_cell)],
    ]
    t_schema = Table(schema_data, colWidths=[80, 110, 130, USABLE_WIDTH - 320])
    t_schema.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4C1D95")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t_schema)

    story.append(Spacer(1, 6))
    story.append(Paragraph("Node Execution Pipeline", h2_style))
    story.append(Paragraph("<b>1. Node 'assessIndependent':</b> Uses a <code>ConcurrencyLimiter(6)</code> to execute all 6 AI agents simultaneously. Each agent independently analyzes the candidate's CV against the job description without inter-agent bias.", body_style))
    story.append(Paragraph("<b>2. Node 'conductDebate':</b> Takes the 6 structured outputs and orchestrates a bounded cross-examination where agents address discrepancies, challenge assumptions, and debate commercial versus technical trade-offs.", body_style))
    story.append(Paragraph("<b>3. Node 'synthesizeReport':</b> Aggregates all findings, computes 5-dimensional scores, evaluates ATS keyword coverage, and generates a structured verdict.", body_style))

    story.append(PageBreak())

    # ==========================================
    # SECTION 3: 6 AI PERSONAS
    # ==========================================
    story.append(Paragraph("3. The 6 AI Committee Personas & Behavioral Specifications", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "Each agent in the CookMyCV committee is governed by a tailored system prompt, distinct evaluation metrics, strict evidence constraints, "
        "and weighted dimensional contributions defined in <code>lib/agents/personas/prompt-builder.ts</code>.",
        body_style
    ))

    # Figure 3
    fig3_path = os.path.join(ASSETS_DIR, "fig3_personas_matrix.png")
    if os.path.exists(fig3_path):
        img_w = USABLE_WIDTH
        img_h = (1050 / 2000) * img_w
        story.append(Image(fig3_path, width=img_w, height=img_h))
        story.append(Paragraph("Figure 3: Committee Persona Matrix: Behavioral Profiles, Scoring Weightings, Focus Areas, and Debate Roles", caption_style))

    story.append(Paragraph("Detailed Persona Behavioral Profiles", h2_style))

    personas_detail = [
        ("Skeptical HR Recruiter (hr_recruiter)", "Focuses on career progression, tenure consistency, communication clarity, unexplained gaps, and resume formatting. Acts as the initial phone screen gatekeeper. Contributes 40% to Role Fit and 50% to Professional Presentation."),
        ("Senior Technical Interviewer (technical_interviewer)", "Assesses technical depth, architectural trade-offs, tech stack competencies, and engineering ownership. Looks beyond high-level buzzwords to find verifiable implementation proof. Directly drives 100% of the Skills and Evidence dimension (25% of total score)."),
        ("ATS Keyword Scanner (ats_scanner)", "Simulates enterprise Applicant Tracking Systems (Workday, Greenhouse, Taleo). Evaluates verbatim keyword coverage, alias matching, job title alignment, and parser readability. Directly controls the ATS Alignment dimension (20% of total score)."),
        ("Hiring Manager / Director (hiring_manager)", "Represents delivery deadlines, team budget, and business ROI. Assesses whether the candidate can deliver without hand-holding. Contributes 60% to Role Fit and 100% to Impact and Clarity (combined 40% of overall score)."),
        ("Executive Career Strategist (career_strategist)", "Analyzes seniority leveling (Mid vs Senior vs Staff), compensation benchmarks, and narrative positioning against competing applicants. Contributes 50% to Professional Presentation and shapes prioritized fixes."),
        ("Red Flag Analyst & Risk Auditor (red_flag_analyst)", "Adversarial auditor searching for suspicious dates, contradictory claims, title inflation, and ungrounded metric claims. Adheres to the core rule: <i>'A flag is not proof of a problem'</i>. Governs uncertainty scoring.")
    ]

    for title, desc in personas_detail:
        story.append(Paragraph(f"• <b>{title}:</b> {desc}", bullet_style))

    story.append(Spacer(1, 6))
    story.append(Paragraph("Tone Modulation Layer", h2_style))
    story.append(Paragraph(
        "CookMyCV supports three distinct evaluation tones: <b>Strict Professional</b> (objective, transparent, dispassionate), "
        "<b>Friendly Coaching</b> (encouraging, supportive, constructive), and <b>Brutal Roast</b> (witty, sarcastic, targeting corporate buzzwords). "
        "Crucially, <code>getToneInstructions()</code> enforces an architectural constraint: <i>Tone alters voice and wording ONLY; numerical scores, "
        "dimension calculations, and evidence standards remain strictly invariant across all tones.</i>",
        body_style
    ))

    story.append(PageBreak())

    # ==========================================
    # SECTION 4: BOUNDED DEBATE PROTOCOL
    # ==========================================
    story.append(Paragraph("4. Bounded Multi-Turn Moderated Cross-Debate Protocol", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "A critical flaw of standard multi-agent systems is unbounded conversational loops, where agents agree, disagree, or debate indefinitely, "
        "rapidly exhausting token quotas and leading to unpredictable latency. CookMyCV solves this with a <b>Bounded Moderated Debate Protocol</b> "
        "(implemented in <code>lib/agents/graph/debate-orchestrator.ts</code>) that guarantees mathematical termination within 4 to 6 turns.",
        body_style
    ))

    # Figure 4
    fig4_path = os.path.join(ASSETS_DIR, "fig4_debate_sequence.png")
    if os.path.exists(fig4_path):
        img_w = USABLE_WIDTH
        img_h = (950 / 2000) * img_w
        story.append(Image(fig4_path, width=img_w, height=img_h))
        story.append(Paragraph("Figure 4: Bounded Committee Debate Protocol: 6-Turn Cross-Examination Sequence with Evidence Verification", caption_style))

    story.append(Paragraph("Turn-by-Turn Sequence Architecture", h2_style))
    story.append(Paragraph(
        "The debate sequence is deterministically structured to replicate real-world recruitment committee dynamics:",
        body_style
    ))

    debate_table_data = [
        [Paragraph("<b>Turn</b>", table_header), Paragraph("<b>Speaker</b>", table_header), Paragraph("<b>Target</b>", table_header), Paragraph("<b>Core Deliberation Focus & Evidence Injection</b>", table_header)],
        [Paragraph("Turn 1", code_style), Paragraph("HR Recruiter", table_cell), Paragraph("Tech Interviewer", table_cell), Paragraph("Presents candidate tenure and ATS match; challenges Tech Lead to confirm depth vs padding.", table_cell)],
        [Paragraph("Turn 2", code_style), Paragraph("Tech Interviewer", table_cell), Paragraph("HR Recruiter", table_cell), Paragraph("Validates stack familiarity citing project bullets; raises missing high-concurrency proof.", table_cell)],
        [Paragraph("Turn 3", code_style), Paragraph("ATS Scanner", table_cell), Paragraph("Committee", table_cell), Paragraph("Warns committee of automated parser filtering risks due to missing mandatory JD skills.", table_cell)],
        [Paragraph("Turn 4", code_style), Paragraph("Career Strategist", table_cell), Paragraph("Hiring Manager", table_cell), Paragraph("Benchmarking analysis: explains candidate sells themselves short by listing tasks not results.", table_cell)],
        [Paragraph("Turn 5", code_style), Paragraph("Red Flag Analyst", table_cell), Paragraph("Hiring Manager", table_cell), Paragraph("Interjects with discrepancies: highlights unverified scope and lack of baseline metrics.", table_cell)],
        [Paragraph("Turn 6", code_style), Paragraph("Hiring Manager", table_cell), Paragraph("Committee", table_cell), Paragraph("Synthesizes trade-offs: confirms commercial ownership justifies technical interview screen.", table_cell)],
    ]
    t_debate = Table(debate_table_data, colWidths=[50, 95, 95, USABLE_WIDTH - 240])
    t_debate.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t_debate)

    story.append(Spacer(1, 6))
    story.append(Paragraph("Real-Time Streaming to Telegram-Style UI", h2_style))
    story.append(Paragraph(
        "As each debate turn completes, the orchestrator invokes the <code>onDebateTurnGenerated()</code> callback. "
        "The worker immediately persists the turn into the <code>debateMessages</code> table and pushes an event to connected clients via "
        "Server-Sent Events (SSE). The frontend renders these in a Telegram-style chat feed with agent avatar portraits and typing indicators.",
        body_style
    ))

    story.append(PageBreak())

    # ==========================================
    # SECTION 5: EVIDENCE GROUNDING
    # ==========================================
    story.append(Paragraph("5. Anti-Hallucination & Verbatim Evidence Grounding Engine", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "A primary vulnerability of LLMs in resume review is <i>hallucination</i>—attributing tools, years of experience, or leadership "
        "roles to a candidate that do not exist in the source text. CookMyCV implements a multi-tier anti-hallucination verification pipeline "
        "in <code>lib/agents/personas/executor.ts</code>.",
        body_style
    ))

    # Figure 5
    fig5_path = os.path.join(ASSETS_DIR, "fig5_evidence_grounding.png")
    if os.path.exists(fig5_path):
        img_w = USABLE_WIDTH
        img_h = (900 / 2000) * img_w
        story.append(Image(fig5_path, width=img_w, height=img_h))
        story.append(Paragraph("Figure 5: Anti-Hallucination Evidence Grounding Pipeline, Verbatim Substring Matching, and Fallback Safety Net", caption_style))

    story.append(Paragraph("The verifyEvidenceGrounding() Verification Algorithm", h2_style))
    story.append(Paragraph(
        "Whenever an LLM produces findings, each claim must include an <code>evidenceSnippet</code> quoting verbatim text from the CV or JD. "
        "The verification engine normalizes the source texts into a unified lowercase corpus and tests for substring containment:",
        body_style
    ))

    callout_data = [
        [
            Paragraph(
                "<b>Grounding Invariant:</b> If an agent asserts a finding with an evidence snippet that cannot be located verbatim "
                "within the candidate document or job description, the finding is <b>never discarded silently</b>. Instead, "
                "the system forces <code>isUncertain = true</code> and appends a specific <code>uncertaintyReason</code>: "
                "<i>'Evidence snippet could not be verified verbatim in supplied CV or JD text.'</i> "
                "This directly penalizes the confidence score of the evaluation and alerts the candidate.",
                callout_text
            )
        ]
    ]
    t_callout = Table(callout_data, colWidths=[USABLE_WIDTH])
    t_callout.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FEF3C7")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#F59E0B")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(t_callout)

    story.append(Spacer(1, 6))
    story.append(Paragraph("Deterministic Safety Net (evaluateAgentDeterministically)", h2_style))
    story.append(Paragraph(
        "To guarantee 100% platform availability during third-party LLM outages or rate limits (e.g. Gemini 429 quota exhaustion), "
        "CookMyCV includes an offline deterministic evaluator (<code>lib/agents/personas/deterministic-evaluator.ts</code>). "
        "It uses regex-based entity extraction, career chronological analysis, and lexical frequency scoring to generate fully schema-compliant, "
        "evidence-grounded agent evaluations with zero external network dependencies.",
        body_style
    ))

    story.append(PageBreak())

    # ==========================================
    # SECTION 6: WORKER LIFECYCLE & RESILIENCY
    # ==========================================
    story.append(Paragraph("6. Checkpoint-Aware Worker Lifecycle, Resiliency & Storage", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "Long-running multi-agent evaluations (typically 10–25 seconds) must withstand server restarts, network drops, and database reconnects. "
        "The CookMyCV worker (<code>lib/evaluations/worker.ts</code>) implements an <b>idempotent, checkpoint-aware processing architecture</b>.",
        body_style
    ))

    # Figure 6
    fig6_path = os.path.join(ASSETS_DIR, "fig6_worker_lifecycle.png")
    if os.path.exists(fig6_path):
        img_w = USABLE_WIDTH
        img_h = (920 / 2000) * img_w
        story.append(Image(fig6_path, width=img_w, height=img_h))
        story.append(Paragraph("Figure 6: Checkpoint-Aware Worker Lifecycle: Idempotent State Transitions, Database Checkpointing, and Stale Job Recovery", caption_style))

    story.append(Paragraph("Database Checkpointing & Idempotency", h2_style))
    story.append(Paragraph(
        "Instead of keeping evaluation state in volatile memory, the worker writes intermediate checkpoints to Neon PostgreSQL:",
        body_style
    ))
    story.append(Paragraph("• <b>agentRuns Table:</b> As each persona finishes, its full structured result, score contribution, and token usage are inserted immediately. If the worker crashes mid-evaluation, the recovered worker queries completed runs and executes <i>only the missing agents</i>.", bullet_style))
    story.append(Paragraph("• <b>debateMessages Table:</b> Each debate turn is persisted upon generation, preserving conversation history and preventing duplicate LLM calls.", bullet_style))
    story.append(Paragraph("• <b>reports Table:</b> The synthesized report is committed alongside the final score and verdict in an atomic state transition.", bullet_style))

    story.append(Spacer(1, 4))
    story.append(Paragraph("Self-Healing Document Text Extraction", h2_style))
    story.append(Paragraph(
        "If a candidate CV record in the database is missing its extracted plaintext (e.g. due to an interrupted upload), "
        "the worker automatically initiates self-healing: it fetches the original document binary from private object storage, "
        "re-executes <code>extractDocumentText()</code>, persists the repaired text, and proceeds without failing the job.",
        body_style
    ))

    story.append(Spacer(1, 4))
    story.append(Paragraph("Stale Job Recovery (recoverStaleJobs)", h2_style))
    story.append(Paragraph(
        "A background maintenance process periodically queries evaluations stuck in <code>'processing'</code> status with no heartbeat updates "
        "for more than 300 seconds (5 minutes). It automatically re-enqueues the job, resuming exactly from the last saved checkpoint.",
        body_style
    ))

    story.append(PageBreak())

    # ==========================================
    # SECTION 7: SCORING ENGINE & ATS
    # ==========================================
    story.append(Paragraph("7. Quantitative Scoring Model, 5D Formulation & ATS Engine", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "CookMyCV replaces subjective resume rating with a rigorous mathematical formulation implemented in "
        "<code>lib/agents/graph/synthesis-generator.ts</code> and <code>lib/evaluations/index.ts</code>.",
        body_style
    ))

    # Figure 7
    fig7_path = os.path.join(ASSETS_DIR, "fig7_scoring_engine.png")
    if os.path.exists(fig7_path):
        img_w = USABLE_WIDTH
        img_h = (950 / 2000) * img_w
        story.append(Image(fig7_path, width=img_w, height=img_h))
        story.append(Paragraph("Figure 7: Quantitative Scoring Architecture: 5D Weighting Formula, Calibrated Verdicts, and ATS Keyword Coverage", caption_style))

    story.append(Paragraph("The 5-Dimensional Scoring Model", h2_style))

    dim_table_data = [
        [Paragraph("<b>Dimension</b>", table_header), Paragraph("<b>Weight</b>", table_header), Paragraph("<b>Formula</b>", table_header), Paragraph("<b>Persona Drivers & Evaluation Focus</b>", table_header)],
        [Paragraph("Role & Experience Fit", table_cell), Paragraph("<b>30%</b>", table_cell), Paragraph("<code>hm * 0.6 + hr * 0.4</code>", code_style), Paragraph("Seniority level, career continuity, and title relevance.", table_cell)],
        [Paragraph("Technical Skills & Evidence", table_cell), Paragraph("<b>25%</b>", table_cell), Paragraph("<code>tech</code>", code_style), Paragraph("Hands-on technical depth and architectural ownership.", table_cell)],
        [Paragraph("ATS Keyword Alignment", table_cell), Paragraph("<b>20%</b>", table_cell), Paragraph("<code>ats</code>", code_style), Paragraph("Parser keyword coverage against mandatory JD requirements.", table_cell)],
        [Paragraph("Business Impact & Clarity", table_cell), Paragraph("<b>15%</b>", table_cell), Paragraph("<code>hm</code>", code_style), Paragraph("Quantified commercial ROI, revenue metrics, and velocity.", table_cell)],
        [Paragraph("Professional Presentation", table_cell), Paragraph("<b>10%</b>", table_cell), Paragraph("<code>hr * 0.5 + strat * 0.5</code>", code_style), Paragraph("Chronology clarity, action verbs, and narrative impact.", table_cell)],
    ]
    t_dim = Table(dim_table_data, colWidths=[110, 45, 120, USABLE_WIDTH - 275])
    t_dim.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#064E3B")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t_dim)

    story.append(Spacer(1, 6))
    story.append(Paragraph("Overall Score & Verdict Mapping", h2_style))
    story.append(Paragraph(
        "The overall score is a weighted sum (0–100) mapped deterministically to one of five official verdicts: "
        "<b>Strongly Recommended</b> (85–100), <b>Recommended</b> (70–84), <b>Borderline</b> (55–69), "
        "<b>Needs Major Work</b> (40–54), and <b>Unprepared</b> (0–39).",
        body_style
    ))

    story.append(Spacer(1, 4))
    story.append(Paragraph("Confidence Score Formulation", h2_style))
    story.append(Paragraph(
        "Unlike black-box models, CookMyCV computes an explicit <b>confidence score</b> based on evidence consistency: "
        "<code>confidence = max(0.65, min(0.98, 1 - (uncertainFindings / totalFindings) * 0.25))</code>. "
        "If an agent cites ungrounded claims or uncertain dates, confidence drops, highlighting areas needing candidate defense.",
        body_style
    ))

    story.append(PageBreak())

    # ==========================================
    # SECTION 8: DOWNSTREAM INTELLIGENCE
    # ==========================================
    story.append(Paragraph("8. Downstream Intelligence: Rewrites, Defense & Interviews", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "The evaluation report is not a dead end. CookMyCV leverages the agent committee's findings to power three interactive, "
        "high-value downstream services (implemented in <code>lib/reports/</code> and <code>lib/interviews/</code>).",
        body_style
    ))

    # Figure 8
    fig8_path = os.path.join(ASSETS_DIR, "fig8_downstream_intelligence.png")
    if os.path.exists(fig8_path):
        img_w = USABLE_WIDTH
        img_h = (950 / 2000) * img_w
        story.append(Image(fig8_path, width=img_w, height=img_h))
        story.append(Paragraph("Figure 8: Downstream Intelligence Modules: Anti-Fabrication Bullet Rewriting, Bounded Defense Reassessment, and Mock Interview Simulator", caption_style))

    story.append(Paragraph("1. Truthful Bullet Rewriter (verifyTruthfulRewrite)", h2_style))
    story.append(Paragraph(
        "A common hazard of AI resume rewrites is hallucinated metrics: an LLM might rewrite <i>'Handled customer support'</i> into "
        "<i>'Handled 5,000+ support tickets reducing latency by 45% saving $100k'</i>. "
        "CookMyCV's <code>verifyTruthfulRewrite()</code> inspects suggested bullets against the original source using metric regexes. "
        "If a rewrite introduces ungrounded numbers, percentages, or dollar amounts, the suggestion is rejected, "
        "ensuring the candidate's resume remains 100% truthful and defensible.",
        body_style
    ))

    story.append(Spacer(1, 4))
    story.append(Paragraph("2. Bounded Candidate Defense Engine (calculateBoundedReassessment)", h2_style))
    story.append(Paragraph(
        "Candidates can challenge red flags or clarify employment gaps by submitting substantive explanations and external links. "
        "To prevent score inflation, reassessments are strictly bounded: a valid defense awards +2 to +8 points, with a strict "
        "<b>cumulative ceiling of +15 points max</b> across all defenses for a given evaluation.",
        body_style
    ))

    story.append(Spacer(1, 4))
    story.append(Paragraph("3. Interactive Mock Interview Simulator", h2_style))
    story.append(Paragraph(
        "The synthesis generator automatically extracts likely interview questions tied to the candidate's specific weaknesses. "
        "The interview service conducts an interactive Q&A session, evaluating candidate answers against a 3-point competency rubric "
        "(Concrete Past Example, Clear Methodology, and Measurable Outcome) to prepare candidates for live hiring rounds.",
        body_style
    ))

    story.append(PageBreak())

    # ==========================================
    # SECTION 9: PRODUCTION & SECURITY
    # ==========================================
    story.append(Paragraph("9. Production Engineering, Security & Enterprise Scalability", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "CookMyCV is engineered for production-grade reliability, data privacy, and cost efficiency in distributed multi-tenant environments.",
        body_style
    ))

    story.append(Paragraph("Concurrency Limiting & Token Economics", h2_style))
    story.append(Paragraph(
        "Executing 6 agents concurrently could overwhelm upstream LLM rate limits. The <code>ConcurrencyLimiter</code> throttles "
        "parallel executions to a configurable concurrency window (default: 6 for full tier, 3 for workers). "
        "Furthermore, by leveraging <b>Google Gemini 3.5 Flash</b> with structured JSON schema outputs, total token usage is strictly "
        "bounded: a complete evaluation (6 independent agent runs + 6 debate turns + synthesis report) costs approximately <b>$0.0003 to $0.001 USD</b>, "
        "enabling sustainable unit economics at scale.",
        body_style
    ))

    story.append(Spacer(1, 4))
    story.append(Paragraph("Candidate Privacy & PII Redaction", h2_style))
    story.append(Paragraph(
        "Before generating public share links or downloadable evaluation PDFs, the system runs <code>redactStructuredReport()</code> "
        "(in <code>lib/reports/redaction.ts</code>). Candidate names, email addresses, phone numbers, and physical addresses are masked, "
        "allowing candidates to safely share audit scorecards with recruiters and mentors without exposing sensitive PII.",
        body_style
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph("System Architecture Specification Summary", h2_style))

    summary_data = [
        [Paragraph("<b>Component</b>", table_header), Paragraph("<b>Technology / Implementation</b>", table_header), Paragraph("<b>Key Architectural Guarantee</b>", table_header)],
        [Paragraph("Orchestration Graph", table_cell), Paragraph("LangGraph 1.7 / StateGraph", table_cell), Paragraph("Cyclic execution, typed state reducers, SSE event hooks.", table_cell)],
        [Paragraph("AI Committee", table_cell), Paragraph("6 Persona Prompts + Schema Validation", table_cell), Paragraph("Realistic hiring tensions, strictly grounded evidence citations.", table_cell)],
        [Paragraph("Debate Engine", table_cell), Paragraph("Bounded Multi-Turn Orchestrator", table_cell), Paragraph("Guaranteed termination in 4-6 turns; no infinite token loops.", table_cell)],
        [Paragraph("Evidence Grounding", table_cell), Paragraph("Verbatim Substring Containment", table_cell), Paragraph("Anti-hallucination guard; uncertainty flags for unverified claims.", table_cell)],
        [Paragraph("Offline Fallback", table_cell), Paragraph("Deterministic Regex & Heuristic Evaluator", table_cell), Paragraph("100% platform availability even during total LLM API outages.", table_cell)],
        [Paragraph("Worker Resiliency", table_cell), Paragraph("Idempotent Checkpointing via Neon DB", table_cell), Paragraph("Resumes from last checkpoint; zero duplicate AI compute costs.", table_cell)],
        [Paragraph("Scoring Engine", table_cell), Paragraph("5D Mathematical Formula Matrix", table_cell), Paragraph("Objective calibrated scores (0-100) and deterministic verdicts.", table_cell)],
        [Paragraph("Downstream Defense", table_cell), Paragraph("Bounded Delta Algorithm (+15 pt max)", table_cell), Paragraph("Allows candidate rebuttals while preventing score inflation.", table_cell)],
    ]
    t_summary = Table(summary_data, colWidths=[100, 160, USABLE_WIDTH - 260])
    t_summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t_summary)

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceBefore=6, spaceAfter=8))
    story.append(Paragraph(
        "<b>Document Authorization:</b> CookMyCV Platform Architecture Specification. "
        "Generated for distribution in the root project repository as a complete architectural reference.",
        ParagraphStyle("AuthFooter", fontName="Helvetica", fontSize=8, textColor=colors.HexColor("#64748B"), alignment=1)
    ))

    # Build document
    print(f"Compiling PDF document: {PDF_PATH_1}...")
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated: {PDF_PATH_1}")

    # Copy to PDF_PATH_2 as well
    shutil.copyfile(PDF_PATH_1, PDF_PATH_2)
    print(f"Successfully mirrored: {PDF_PATH_2}")

if __name__ == "__main__":
    create_specification_pdf()
