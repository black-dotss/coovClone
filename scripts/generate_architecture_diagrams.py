"""
Generates the comprehensive architectural specification PDF for CookMyCV's Multi-Agent Engine.
Includes 8 high-resolution figurative diagrams and deep-dive technical documentation.
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFont

# Set up paths
ROOT_DIR = os.path.abspath(os.path.dirname(__file__) + "/..")
ASSETS_DIR = os.path.join(ROOT_DIR, ".diagram_assets")
os.makedirs(ASSETS_DIR, exist_ok=True)

# Colors
BG_DARK = "#0F172A"       # Slate 900
BG_CARD = "#1E293B"       # Slate 800
BG_CARD_LIGHT = "#334155" # Slate 700
BORDER_PURPLE = "#7C3AED" # Purple 600
ACCENT_PURPLE = "#8B5CF6" # Purple 500
ACCENT_CYAN = "#06B6D4"   # Cyan 500
ACCENT_GREEN = "#10B981"  # Emerald 500
ACCENT_AMBER = "#F59E0B"  # Amber 500
ACCENT_RED = "#EF4444"    # Red 500
ACCENT_BLUE = "#3B82F6"   # Blue 500
TEXT_WHITE = "#F8FAFC"    # Slate 50
TEXT_MUTED = "#94A3B8"    # Slate 400
TEXT_DARK = "#1E293B"

# Font loaders
def get_font(size, bold=False):
    font_path = "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"
    try:
        return ImageFont.truetype(font_path, size)
    except Exception:
        return ImageFont.load_default()

def draw_rounded_rect(draw, bbox, fill, outline=None, width=1, radius=12):
    draw.rounded_rectangle(bbox, radius=radius, fill=fill, outline=outline, width=width)

def draw_arrow(draw, start, end, color=ACCENT_PURPLE, width=3, arrow_size=10):
    x1, y1 = start
    x2, y2 = end
    draw.line([start, end], fill=color, width=width)
    import math
    angle = math.atan2(y2 - y1, x2 - x1)
    p1 = (x2 - arrow_size * math.cos(angle - math.pi / 6), y2 - arrow_size * math.sin(angle - math.pi / 6))
    p2 = (x2 - arrow_size * math.cos(angle + math.pi / 6), y2 - arrow_size * math.sin(angle + math.pi / 6))
    draw.polygon([end, p1, p2], fill=color)

# ==========================================
# DIAGRAM 1: End-to-End System Architecture
# ==========================================
def generate_diagram_1():
    w, h = 2000, 1000
    img = Image.new("RGB", (w, h), BG_DARK)
    draw = ImageDraw.Draw(img)

    # Title Banner
    draw_rounded_rect(draw, (40, 30, w - 40, 110), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw.text((70, 48), "FIGURE 1: COOKMYCV END-TO-END MULTI-AGENT ARCHITECTURE PIPELINE", fill=TEXT_WHITE, font=get_font(32, bold=True))
    draw.text((70, 84), "Distributed Recruitment Assessment System: Ingestion -> Concurrency Control -> LangGraph DAG -> Neon DB -> Synthesis", fill=ACCENT_CYAN, font=get_font(18))

    # 4 Vertical / Horizontal Flow Pillars
    # Pillar 1: Ingestion & Security
    draw_rounded_rect(draw, (50, 140, 480, 930), fill=BG_CARD, outline=ACCENT_BLUE, width=2, radius=16)
    draw_rounded_rect(draw, (70, 160, 460, 210), fill="#1E3A8A", radius=10)
    draw.text((90, 172), "1. INGESTION & SECURITY", fill=TEXT_WHITE, font=get_font(20, bold=True))
    
    steps_p1 = [
        ("Candidate CV & Job Description", "PDF / DOCX Upload & Plaintext Input", ACCENT_BLUE),
        ("Document Extractor Service", "Mammoth (docx) & PDF-Parse Engine", BG_CARD_LIGHT),
        ("Self-Healing Object Store", "Private Key Storage (.storage/Neon)", BG_CARD_LIGHT),
        ("Device Fingerprinting & Tokens", "Cross-Device Abuse Detection & IP Hash", BG_CARD_LIGHT),
        ("Atomic Credit Ledger", "Reservation via PostgreSQL Transaction", ACCENT_AMBER),
    ]
    y_offset = 230
    for title, desc, col in steps_p1:
        draw_rounded_rect(draw, (70, y_offset, 460, y_offset + 105), fill=col if col != ACCENT_BLUE and col != ACCENT_AMBER else BG_CARD_LIGHT, outline=col, width=2, radius=12)
        draw.text((90, y_offset + 15), title, fill=TEXT_WHITE, font=get_font(18, bold=True))
        draw.text((90, y_offset + 50), desc, fill=TEXT_MUTED, font=get_font(15))
        y_offset += 135

    # Pillar 2: LangGraph Orchestration Core
    draw_rounded_rect(draw, (520, 140, 1100, 930), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw_rounded_rect(draw, (540, 160, 1080, 210), fill="#4C1D95", radius=10)
    draw.text((560, 172), "2. LANGGRAPH MULTI-AGENT ORCHESTRATION ENGINE", fill=TEXT_WHITE, font=get_font(20, bold=True))

    steps_p2 = [
        ("assessIndependent Node (Fan-Out)", "6 Bounded Agents via ConcurrencyLimiter(6)\nParallel Evaluation with Structured Schemas", BORDER_PURPLE),
        ("Anti-Hallucination Grounding Gate", "verifyEvidenceGrounding: Substring Containment\nVerbatim Snippets Required | Uncertainty Flags", ACCENT_CYAN),
        ("conductDebate Node (Cross-Examination)", "6 Sequenced Turns: HR <-> Tech <-> ATS <-> Mgr\nTension Resolution & Tone Voice Injection", ACCENT_PURPLE),
        ("synthesizeReport Node (Aggregation)", "Mathematical Weighting across 5 Dimensions\nVerdict Calibration & ATS Match Engine", ACCENT_GREEN),
        ("State Annotation & Reducer Engine", "Append Reducers for Debate, Accumulator for Cost\nTotal Tokens & USD Tracking across Turns", BG_CARD_LIGHT),
    ]
    y_offset = 230
    for title, desc, col in steps_p2:
        draw_rounded_rect(draw, (540, y_offset, 1080, y_offset + 105), fill=BG_CARD_LIGHT, outline=col, width=2, radius=12)
        draw.text((560, y_offset + 12), title, fill=TEXT_WHITE, font=get_font(18, bold=True))
        lines = desc.split("\n")
        draw.text((560, y_offset + 42), lines[0], fill=TEXT_MUTED, font=get_font(14))
        if len(lines) > 1:
            draw.text((560, y_offset + 66), lines[1], fill=ACCENT_CYAN, font=get_font(14))
        y_offset += 135

    # Pillar 3: Resilient Checkpointed Worker & Models
    draw_rounded_rect(draw, (1140, 140, 1550, 930), fill=BG_CARD, outline=ACCENT_GREEN, width=2, radius=16)
    draw_rounded_rect(draw, (1160, 160, 1530, 210), fill="#064E3B", radius=10)
    draw.text((1180, 172), "3. LLM PROVIDERS & STORAGE", fill=TEXT_WHITE, font=get_font(20, bold=True))

    steps_p3 = [
        ("AI Provider Abstraction", "Gemini 3.5 Flash (Primary)\nOpenAI GPT-4o / MockProvider Fallback", ACCENT_GREEN),
        ("Deterministic Fallback Evaluator", "Zero-failure guaranteed evaluation when\nAPI rate limit or network outage occurs", ACCENT_AMBER),
        ("Checkpoint Persistence", "Neon PostgreSQL via Drizzle ORM\nagentRuns & debateMessages intermediate saves", BG_CARD_LIGHT),
        ("Idempotent Worker Recovery", "Auto-recovers stale jobs (>5 min)\nResumes from last persisted checkpoint", BG_CARD_LIGHT),
        ("Credit Ledger Settlement", "Atomic settle on success | Full refund on cancel", ACCENT_GREEN),
    ]
    y_offset = 230
    for title, desc, col in steps_p3:
        draw_rounded_rect(draw, (1160, y_offset, 1530, y_offset + 105), fill=BG_CARD_LIGHT, outline=col, width=2, radius=12)
        draw.text((1180, y_offset + 12), title, fill=TEXT_WHITE, font=get_font(18, bold=True))
        lines = desc.split("\n")
        draw.text((1180, y_offset + 42), lines[0], fill=TEXT_MUTED, font=get_font(14))
        if len(lines) > 1:
            draw.text((1180, y_offset + 66), lines[1], fill=ACCENT_CYAN, font=get_font(14))
        y_offset += 135

    # Pillar 4: Downstream Intelligence & UI
    draw_rounded_rect(draw, (1590, 140, 1950, 930), fill=BG_CARD, outline=ACCENT_AMBER, width=2, radius=16)
    draw_rounded_rect(draw, (1610, 160, 1930, 210), fill="#78350F", radius=10)
    draw.text((1630, 172), "4. UI & DOWNSTREAM", fill=TEXT_WHITE, font=get_font(20, bold=True))

    steps_p4 = [
        ("Telegram-Style Agent Chat", "Live SSE streaming of debate turns,\npersona avatars, and commentary", ACCENT_AMBER),
        ("Interactive Scorecard & PDF", "0-100 Score, Verdict, 5D Radar,\nExportable Downloadable PDF", BG_CARD_LIGHT),
        ("Truthful Bullet Rewrites", "verifyTruthfulRewrite guards: zero metric\nfabrication, action verbs, impact focus", ACCENT_GREEN),
        ("Candidate Defense Engine", "Bounded score delta (+2 to +8 pts, max 15)\nAllows candidate to justify flags", ACCENT_BLUE),
        ("Mock Interview Simulator", "Dynamic questions tied to weak findings,\n3-point rubric automated scoring", ACCENT_PURPLE),
    ]
    y_offset = 230
    for title, desc, col in steps_p4:
        draw_rounded_rect(draw, (1610, y_offset, 1930, y_offset + 105), fill=BG_CARD_LIGHT, outline=col, width=2, radius=12)
        draw.text((1630, y_offset + 12), title, fill=TEXT_WHITE, font=get_font(18, bold=True))
        lines = desc.split("\n")
        draw.text((1630, y_offset + 42), lines[0], fill=TEXT_MUTED, font=get_font(14))
        if len(lines) > 1:
            draw.text((1630, y_offset + 66), lines[1], fill=ACCENT_CYAN, font=get_font(14))
        y_offset += 135

    # Inter-pillar connecting arrows
    draw_arrow(draw, (480, 280), (520, 280), color=ACCENT_BLUE, width=4)
    draw_arrow(draw, (1100, 280), (1140, 280), color=BORDER_PURPLE, width=4)
    draw_arrow(draw, (1550, 280), (1590, 280), color=ACCENT_GREEN, width=4)
    draw_arrow(draw, (1100, 550), (1140, 550), color=BORDER_PURPLE, width=4)
    draw_arrow(draw, (1550, 550), (1590, 550), color=ACCENT_AMBER, width=4)

    out_path = os.path.join(ASSETS_DIR, "fig1_system_architecture.png")
    img.save(out_path, dpi=(300, 300))
    print(f"Generated: {out_path}")

# ==========================================
# DIAGRAM 2: LangGraph State Machine & DAG
# ==========================================
def generate_diagram_2():
    w, h = 2000, 950
    img = Image.new("RGB", (w, h), BG_DARK)
    draw = ImageDraw.Draw(img)

    # Title
    draw_rounded_rect(draw, (40, 30, w - 40, 110), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw.text((70, 48), "FIGURE 2: LANGGRAPH WORKFLOW DIRECTED ACYCLIC GRAPH (DAG) & STATE MACHINE", fill=TEXT_WHITE, font=get_font(32, bold=True))
    draw.text((70, 84), "StateGraph Engine: Node Orchestration, Typed Reducers, Event Hooks & Concurrency Gates", fill=ACCENT_CYAN, font=get_font(18))

    # START Node
    draw_rounded_rect(draw, (70, 220, 230, 320), fill="#064E3B", outline=ACCENT_GREEN, width=3, radius=16)
    draw.text((115, 255), "START", fill=TEXT_WHITE, font=get_font(28, bold=True))

    # NODE 1: assessIndependent
    draw_rounded_rect(draw, (330, 180, 800, 550), fill=BG_CARD, outline=BORDER_PURPLE, width=3, radius=16)
    draw_rounded_rect(draw, (350, 200, 780, 250), fill="#4C1D95", radius=10)
    draw.text((370, 212), "NODE 1: assessIndependent", fill=TEXT_WHITE, font=get_font(22, bold=True))
    draw.text((360, 270), "Parallel Fan-Out across 6 Personas", fill=ACCENT_CYAN, font=get_font(16, bold=True))
    draw.text((360, 295), "Controlled by ConcurrencyLimiter(6)", fill=TEXT_MUTED, font=get_font(15))
    
    # 6 Personas mini-cards inside Node 1
    personas = [
        ("HR Recruiter", "Tenure & Gaps"),
        ("Tech Interviewer", "Code & Architecture"),
        ("ATS Scanner", "Keywords & Parsability"),
        ("Hiring Manager", "ROI & Delivery"),
        ("Career Strategist", "Market Benchmark"),
        ("Red Flag Analyst", "Risk & Discrepancies")
    ]
    py = 330
    for i, (name, foc) in enumerate(personas):
        col_x = 350 if i % 2 == 0 else 575
        cur_y = py + (i // 2) * 65
        draw_rounded_rect(draw, (col_x, cur_y, col_x + 210, cur_y + 55), fill=BG_CARD_LIGHT, outline=ACCENT_PURPLE, width=1, radius=8)
        draw.text((col_x + 10, cur_y + 8), name, fill=TEXT_WHITE, font=get_font(14, bold=True))
        draw.text((col_x + 10, cur_y + 30), foc, fill=ACCENT_CYAN, font=get_font(12))

    # NODE 2: conductDebate
    draw_rounded_rect(draw, (900, 180, 1370, 550), fill=BG_CARD, outline=ACCENT_BLUE, width=3, radius=16)
    draw_rounded_rect(draw, (920, 200, 1350, 250), fill="#1E3A8A", radius=10)
    draw.text((940, 212), "NODE 2: conductDebate", fill=TEXT_WHITE, font=get_font(22, bold=True))
    draw.text((930, 270), "Bounded Cross-Examination Committee", fill=ACCENT_CYAN, font=get_font(16, bold=True))
    draw.text((930, 295), "Guaranteed Termination (4 - 6 Turns)", fill=TEXT_MUTED, font=get_font(15))

    turns = [
        ("Turn 1 (HR -> Tech)", "Challenge stack depth vs resume padding"),
        ("Turn 2 (Tech -> HR)", "Validate skills, demand production metrics"),
        ("Turn 3 (ATS -> Comm)", "Report keyword match % & parser drop risk"),
        ("Turn 4 (Strat -> HM)", "Outcome narrative vs daily task listing"),
        ("Turn 5 (Risk -> HM)", "Flag suspicious dates & ungrounded metrics"),
        ("Turn 6 (HM -> Comm)", "Weigh delivery trade-offs, deliver verdict")
    ]
    ty = 330
    for i, (tname, tdesc) in enumerate(turns):
        draw_rounded_rect(draw, (920, ty + i * 34, 1350, ty + i * 34 + 30), fill=BG_CARD_LIGHT, radius=6)
        draw.text((930, ty + i * 34 + 6), tname, fill=ACCENT_CYAN, font=get_font(13, bold=True))
        draw.text((1080, ty + i * 34 + 6), tdesc, fill=TEXT_WHITE, font=get_font(12))

    # NODE 3: synthesizeReport
    draw_rounded_rect(draw, (1470, 180, 1850, 550), fill=BG_CARD, outline=ACCENT_GREEN, width=3, radius=16)
    draw_rounded_rect(draw, (1490, 200, 1830, 250), fill="#064E3B", radius=10)
    draw.text((1510, 212), "NODE 3: synthesizeReport", fill=TEXT_WHITE, font=get_font(22, bold=True))
    draw.text((1500, 270), "Mathematical Weighting & Report Assembly", fill=ACCENT_CYAN, font=get_font(16, bold=True))

    synth_items = [
        "5D Scoring Formula Matrix",
        "Overall 0-100 Calibrated Score",
        "Deterministic Verdict Classification",
        "Strengths & Weaknesses (Top 4)",
        "3-5 Actionable Prioritized Fixes",
        "Targeted Interview Questions (Tied to Claims)",
        "ATS Keyword Extraction & Coverage %",
        "Evidence Uncertainty Notes"
    ]
    sy = 305
    for item in synth_items:
        draw.text((1500, sy), "+ " + item, fill=TEXT_WHITE, font=get_font(14))
        sy += 28

    # END Node
    draw_rounded_rect(draw, (1700, 620, 1860, 720), fill="#7F1D1D", outline=ACCENT_RED, width=3, radius=16)
    draw.text((1740, 655), "END", fill=TEXT_WHITE, font=get_font(28, bold=True))

    # STATE ANNOTATION SCHEMA (Bottom Box)
    draw_rounded_rect(draw, (70, 600, 1620, 910), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw.text((95, 620), "EvaluationStateAnnotation: Typed Central State Schema with Accumulative Reducers", fill=TEXT_WHITE, font=get_font(20, bold=True))

    schema_cols = [
        ("evaluationId: string", "Immutable unique evaluation identifier"),
        ("cvText / jdText: string", "Cleaned plaintext extracted from candidate CV & target JD"),
        ("tone: EvaluationTone", "'strict' | 'friendly' | 'brutal_roast' (alters voice commentary)"),
        ("agentOutputs: Record<AgentRole, AgentOutput>", "Reducer: (x, y) => ({ ...x, ...y }) - merged persona findings"),
        ("debateTurns: DebateTurn[]", "Reducer: (x, y) => [...x, ...y] - append-only committee transcripts"),
        ("finalReport: SynthesisReport | null", "Reducer: (_, y) => y - atomic replacement on synthesis completion"),
        ("totalTokenUsage: TokenUsage", "Reducer: (x, y) => sum(tokens) & sum(usd) - full audit trail"),
        ("error: string | null", "Reducer: (_, y) => y - fatal error propagation state")
    ]
    s_y = 665
    for i, (field, desc) in enumerate(schema_cols):
        col_x = 95 if i < 4 else 840
        row_y = s_y + (i % 4) * 55
        draw_rounded_rect(draw, (col_x, row_y, col_x + 720, row_y + 45), fill=BG_CARD_LIGHT, radius=8)
        draw.text((col_x + 15, row_y + 12), field, fill=ACCENT_CYAN, font=get_font(15, bold=True))
        draw.text((col_x + 360, row_y + 13), desc, fill=TEXT_MUTED, font=get_font(13))

    # Edge Arrows
    draw_arrow(draw, (230, 270), (330, 270), color=ACCENT_GREEN, width=4)
    draw_arrow(draw, (800, 270), (900, 270), color=BORDER_PURPLE, width=4)
    draw_arrow(draw, (1370, 270), (1470, 270), color=ACCENT_BLUE, width=4)
    draw_arrow(draw, (1660, 550), (1740, 620), color=ACCENT_GREEN, width=4)

    out_path = os.path.join(ASSETS_DIR, "fig2_langgraph_dag.png")
    img.save(out_path, dpi=(300, 300))
    print(f"Generated: {out_path}")

# ==========================================
# DIAGRAM 3: 6 Personas Matrix & Interaction
# ==========================================
def generate_diagram_3():
    w, h = 2000, 1050
    img = Image.new("RGB", (w, h), BG_DARK)
    draw = ImageDraw.Draw(img)

    draw_rounded_rect(draw, (40, 30, w - 40, 110), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw.text((70, 48), "FIGURE 3: THE 6 AI COMMITTEE PERSONAS: SPECIFICATION & ROLE INTERACTION MAP", fill=TEXT_WHITE, font=get_font(32, bold=True))
    draw.text((70, 84), "Specialized Behavioral Prompts, Metric Focus, Weighting Contributions, and Evidence Rigor", fill=ACCENT_CYAN, font=get_font(18))

    personas = [
        {
            "name": "1. Skeptical HR Recruiter",
            "role": "hr_recruiter",
            "badge": "Gatekeeper",
            "badge_col": "#1E3A8A",
            "focus": "Career progression, timeline consistency, role relevance, communication clarity, unexplained gaps, and vague resume claims.",
            "weight": "Contributes to Professional Presentation (50%) and Role Fit (40%)",
            "evidence": "Strict verification of employment dates, company names, and educational credentials.",
            "debate": "Queries tech lead on candidate real depth vs padding before approving recruiter phone screen.",
            "col": ACCENT_BLUE
        },
        {
            "name": "2. Senior Technical Interviewer",
            "role": "technical_interviewer",
            "badge": "Architecture & Code",
            "badge_col": "#4C1D95",
            "focus": "Technical depth, tool competencies, system architecture, engineering ownership, and verifiable proof of claimed tech stack.",
            "weight": "Directly drives Technical Skills and Evidence Dimension (25% Total)",
            "evidence": "Probes hands-on engineering bullets, tech stack choices, scalability, and code practices.",
            "debate": "Validates stack familiarity but highlights lack of production concurrency and scale proof.",
            "col": BORDER_PURPLE
        },
        {
            "name": "3. ATS Keyword Scanner",
            "role": "ats_scanner",
            "badge": "Parser Compliance",
            "badge_col": "#064E3B",
            "focus": "Exact and alias keyword matches, missing qualifications, parser readability, and ATS vocabulary alignment.",
            "weight": "Directly controls ATS Alignment Dimension (20% Total)",
            "evidence": "Extracts JD technical entities and tests exact string coverage percentage in CV text.",
            "debate": "Warns committee that automated filters (Workday, Greenhouse) will drop CV at low match rates.",
            "col": ACCENT_GREEN
        },
        {
            "name": "4. Hiring Manager / Director",
            "role": "hiring_manager",
            "badge": "Delivery & Business ROI",
            "badge_col": "#78350F",
            "focus": "Business impact, seniority fit, commercial outcomes, scope of ownership, leadership, and team ROI.",
            "weight": "Contributes to Role Fit (60%) and Impact & Clarity (100% of dimension)",
            "evidence": "Demands quantified revenue, cost savings, customer adoption, and delivery velocity metrics.",
            "debate": "Weighs technical gaps against commercial ownership to make the final interview decision.",
            "col": ACCENT_AMBER
        },
        {
            "name": "5. Executive Career Strategist",
            "role": "career_strategist",
            "badge": "Leveling & Positioning",
            "badge_col": "#581C87",
            "focus": "Strategic positioning, transferable skills, competitive differentiation, career narrative, and leveling.",
            "weight": "Contributes to Professional Presentation (50%) and Strategic Fixes",
            "evidence": "Compares profile against competitive applicant pool for identical job postings.",
            "debate": "Argues candidate narrative sells them short by listing daily tasks instead of outcomes.",
            "col": ACCENT_PURPLE
        },
        {
            "name": "6. Red Flag Analyst & Risk Auditor",
            "role": "red_flag_analyst",
            "badge": "Risk Audit & Integrity",
            "badge_col": "#7F1D1D",
            "focus": "Short tenures, unexplained timeline gaps, contradictory claims, and ungrounded metrics without context.",
            "weight": "Governs Uncertainty Score, Risk Notes ('A flag is not proof of a problem')",
            "evidence": "Scrutinizes suspicious date overlaps, title inflation, and ungrounded metric claims.",
            "debate": "Demands interview panel probe unverified bullet claims and establish baseline numbers.",
            "col": ACCENT_RED
        }
    ]

    for idx, p in enumerate(personas):
        x = 50 if idx % 2 == 0 else 1030
        y = 140 + (idx // 2) * 290
        w_card = 920
        h_card = 265

        draw_rounded_rect(draw, (x, y, x + w_card, y + h_card), fill=BG_CARD, outline=p["col"], width=2, radius=14)
        
        # Header bar
        draw_rounded_rect(draw, (x + 15, y + 15, x + w_card - 15, y + 65), fill=p["badge_col"], radius=8)
        draw.text((x + 30, y + 25), p["name"], fill=TEXT_WHITE, font=get_font(20, bold=True))
        draw_rounded_rect(draw, (x + w_card - 220, y + 22, x + w_card - 30, y + 58), fill=BG_DARK, radius=6)
        draw.text((x + w_card - 205, y + 28), p["badge"], fill=TEXT_WHITE, font=get_font(13, bold=True))

        # Fields
        draw.text((x + 25, y + 80), "Primary Focus: ", fill=ACCENT_CYAN, font=get_font(14, bold=True))
        draw.text((x + 140, y + 80), p["focus"], fill=TEXT_WHITE, font=get_font(14))

        draw.text((x + 25, y + 125), "Scoring Weight: ", fill=ACCENT_GREEN, font=get_font(14, bold=True))
        draw.text((x + 145, y + 125), p["weight"], fill=TEXT_MUTED, font=get_font(14))

        draw.text((x + 25, y + 170), "Evidence Rigor: ", fill=ACCENT_AMBER, font=get_font(14, bold=True))
        draw.text((x + 145, y + 170), p["evidence"], fill=TEXT_WHITE, font=get_font(14))

        draw.text((x + 25, y + 215), "Debate Stance: ", fill=BORDER_PURPLE, font=get_font(14, bold=True))
        draw.text((x + 145, y + 215), p["debate"], fill=TEXT_MUTED, font=get_font(14))

    out_path = os.path.join(ASSETS_DIR, "fig3_personas_matrix.png")
    img.save(out_path, dpi=(300, 300))
    print(f"Generated: {out_path}")

# ==========================================
# DIAGRAM 4: Bounded Debate Sequence
# ==========================================
def generate_diagram_4():
    w, h = 2000, 950
    img = Image.new("RGB", (w, h), BG_DARK)
    draw = ImageDraw.Draw(img)

    draw_rounded_rect(draw, (40, 30, w - 40, 110), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw.text((70, 48), "FIGURE 4: BOUNDED MODERATED DEBATE PROTOCOL & CROSS-EXAMINATION TURNS", fill=TEXT_WHITE, font=get_font(32, bold=True))
    draw.text((70, 84), "Deterministic 6-Turn Protocol: Inter-Agent Rebuttals, Evidence Citing, and Dynamic Tone Modulation", fill=ACCENT_CYAN, font=get_font(18))

    turns = [
        {
            "seq": "TURN 1",
            "speaker": "Skeptical HR Recruiter",
            "reply_to": "Technical Interviewer",
            "col": ACCENT_BLUE,
            "dialogue": "I reviewed the candidate's career chronology. They cite relevant experience with \"[Snippet: CV Timeline]\". But ATS match is only 62%. Before I schedule a recruiter screen: does engineering see genuine technical depth, or is this resume padding?",
            "evidence": "Evidence Cited: CV employment duration & company titles"
        },
        {
            "seq": "TURN 2",
            "speaker": "Senior Technical Interviewer",
            "reply_to": "Skeptical HR Recruiter",
            "col": BORDER_PURPLE,
            "dialogue": "I vetted their engineering bullets. They cite \"[Snippet: PostgreSQL query tuning & index optimization]\". That proves hands-on stack familiarity. But there is no evidence of high concurrency or distributed systems. I wouldn't reject them, but in our live coding screen I will grill them on production scale.",
            "evidence": "Evidence Cited: Technical project implementation bullets"
        },
        {
            "seq": "TURN 3",
            "speaker": "ATS Keyword Scanner",
            "reply_to": "HR & Engineering Panel",
            "col": ACCENT_GREEN,
            "dialogue": "From automated parsing, their keyword match is 62%. They have baseline title keywords, but if they apply to competitive tech firms without adding required cloud architecture terms, automated ATS filters will discard this CV before human eyes see it.",
            "evidence": "Evidence Cited: Missing mandatory JD competencies"
        },
        {
            "seq": "TURN 4",
            "speaker": "Executive Career Strategist",
            "reply_to": "Hiring Manager",
            "col": ACCENT_PURPLE,
            "dialogue": "Comparing this profile against competing applicants, their background is viable, but their narrative sells them short. They describe daily chores instead of business outcomes. If they quantify impact, their interview callback rate will double.",
            "evidence": "Evidence Cited: Task-oriented phrasing vs impact metrics"
        },
        {
            "seq": "TURN 5",
            "speaker": "Red Flag Analyst & Risk Auditor",
            "reply_to": "Hiring Manager",
            "col": ACCENT_RED,
            "dialogue": "Scrutinize \"[Snippet: Led full architecture rewrite]\". Without baseline metrics or team context, this claim appears exaggerated. A red flag is not proof of fraud, but our interview panel needs concrete verification.",
            "evidence": "Evidence Cited: Unverified scope & lack of baseline numbers"
        },
        {
            "seq": "TURN 6",
            "speaker": "Hiring Manager / Director",
            "reply_to": "Entire Evaluation Committee",
            "col": ACCENT_AMBER,
            "dialogue": "I have headcount to fill and need someone who can ship. The evidence shows they take ownership. I agree with the technical gaps and flag notes, but there is enough substance here to justify an interview. Let's bring them in and probe our specific concerns.",
            "evidence": "Evidence Cited: Commercial ownership & delivery outcomes"
        }
    ]

    y = 150
    for t in turns:
        draw_rounded_rect(draw, (60, y, w - 60, y + 115), fill=BG_CARD, outline=t["col"], width=2, radius=12)
        
        # Turn badge
        draw_rounded_rect(draw, (80, y + 12, 220, y + 45), fill=t["col"], radius=6)
        draw.text((100, y + 18), t["seq"], fill=TEXT_WHITE, font=get_font(15, bold=True))
        
        # Speaker info
        draw.text((240, y + 18), f"{t['speaker']}  -->  Replying to: {t['reply_to']}", fill=TEXT_WHITE, font=get_font(16, bold=True))
        
        # Dialogue text
        draw.text((80, y + 54), t["dialogue"], fill=TEXT_MUTED, font=get_font(14))
        
        # Evidence bar
        draw_rounded_rect(draw, (w - 550, y + 12, w - 80, y + 45), fill=BG_CARD_LIGHT, radius=6)
        draw.text((w - 535, y + 18), t["evidence"], fill=ACCENT_CYAN, font=get_font(12, bold=True))
        
        y += 130

    out_path = os.path.join(ASSETS_DIR, "fig4_debate_sequence.png")
    img.save(out_path, dpi=(300, 300))
    print(f"Generated: {out_path}")

# ==========================================
# DIAGRAM 5: Evidence Grounding Engine
# ==========================================
def generate_diagram_5():
    w, h = 2000, 900
    img = Image.new("RGB", (w, h), BG_DARK)
    draw = ImageDraw.Draw(img)

    draw_rounded_rect(draw, (40, 30, w - 40, 110), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw.text((70, 48), "FIGURE 5: ANTI-HALLUCINATION EVIDENCE GROUNDING & DETERMINISTIC SAFETY NET", fill=TEXT_WHITE, font=get_font(32, bold=True))
    draw.text((70, 84), "Verbatim Snippet Verification, Uncertainty Flagging, and Safe Fallback Architecture", fill=ACCENT_CYAN, font=get_font(18))

    # Flow boxes
    # Box 1: AI Agent Generation
    draw_rounded_rect(draw, (60, 180, 480, 520), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=14)
    draw_rounded_rect(draw, (80, 200, 460, 245), fill="#4C1D95", radius=8)
    draw.text((100, 212), "1. AI PERSONA EXECUTION", fill=TEXT_WHITE, font=get_font(18, bold=True))
    draw.text((80, 265), "Model generates structured JSON:\n- claim (min 5 chars)\n- evidenceSnippet (min 5 chars)\n- sourceReference\n- severity ('low' to 'critical')\n- confidence (0.1 to 1.0)", fill=TEXT_MUTED, font=get_font(15))

    # Box 2: Grounding Verification
    draw_rounded_rect(draw, (550, 180, 1020, 520), fill=BG_CARD, outline=ACCENT_CYAN, width=2, radius=14)
    draw_rounded_rect(draw, (570, 200, 1000, 245), fill="#0E7490", radius=8)
    draw.text((590, 212), "2. verifyEvidenceGrounding()", fill=TEXT_WHITE, font=get_font(18, bold=True))
    draw.text((570, 265), "Anti-Hallucination String Matcher:\n1. Combines lowercase CV + JD text\n2. Sanitizes evidenceSnippet\n3. Checks substring existence in source\n4. If snippet NOT in CV or JD:\n   - isUncertain set to TRUE\n   - uncertaintyReason recorded\n   - Hallucinated quotes flagged", fill=TEXT_WHITE, font=get_font(15))

    # Box 3: Safe Deterministic Evaluator
    draw_rounded_rect(draw, (1090, 180, 1540, 520), fill=BG_CARD, outline=ACCENT_AMBER, width=2, radius=14)
    draw_rounded_rect(draw, (1110, 200, 1520, 245), fill="#78350F", radius=8)
    draw.text((1130, 212), "3. DETERMINISTIC SAFETY NET", fill=TEXT_WHITE, font=get_font(18, bold=True))
    draw.text((1110, 265), "evaluateAgentDeterministically():\nTriggered if:\n- AI API returns 429 quota error\n- Model output fails JSON schema\n- Network outage / timeout\nUses regex matching, keyword\nscoring, and heuristic analysis.\nGuarantees 100% evaluation uptime.", fill=TEXT_MUTED, font=get_font(15))

    # Box 4: Final Output Validation
    draw_rounded_rect(draw, (1610, 180, 1940, 520), fill=BG_CARD, outline=ACCENT_GREEN, width=2, radius=14)
    draw_rounded_rect(draw, (1630, 200, 1920, 245), fill="#064E3B", radius=8)
    draw.text((1645, 212), "4. VALIDATED OUTPUT", fill=TEXT_WHITE, font=get_font(18, bold=True))
    draw.text((1630, 265), "AgentOutputSchema.parse():\nZod validation ensures\nevery field is type-safe,\ngrounded, and fully verified\nbefore database persistence.", fill=TEXT_WHITE, font=get_font(15))

    # Arrows
    draw_arrow(draw, (480, 350), (550, 350), color=ACCENT_CYAN, width=4)
    draw_arrow(draw, (1020, 350), (1090, 350), color=ACCENT_AMBER, width=4)
    draw_arrow(draw, (1540, 350), (1610, 350), color=ACCENT_GREEN, width=4)

    # Bottom Code Logic Box
    draw_rounded_rect(draw, (60, 570, 1940, 850), fill=BG_CARD, outline=BG_CARD_LIGHT, width=2, radius=14)
    draw.text((90, 595), "Code Implementation Pattern (lib/agents/personas/executor.ts):", fill=ACCENT_CYAN, font=get_font(18, bold=True))
    
    code_lines = [
        "const verifiedFindings = output.findings.map((f) => {",
        "  const snippetClean = f.evidenceSnippet.toLowerCase().trim();",
        "  const isGroundInText = combined.includes(snippetClean) || snippetClean.length < 10;",
        "  if (!isGroundInText && !f.isUncertain) {",
        "    return { ...f, isUncertain: true, uncertaintyReason: 'Evidence snippet could not be verified verbatim in supplied CV or JD text.' };",
        "  }",
        "  return f;",
        "});"
    ]
    cy = 635
    for cl in code_lines:
        draw.text((90, cy), cl, fill=TEXT_WHITE, font=get_font(14))
        cy += 24

    out_path = os.path.join(ASSETS_DIR, "fig5_evidence_grounding.png")
    img.save(out_path, dpi=(300, 300))
    print(f"Generated: {out_path}")

# ==========================================
# DIAGRAM 6: Checkpoint-Aware Worker Lifecycle
# ==========================================
def generate_diagram_6():
    w, h = 2000, 920
    img = Image.new("RGB", (w, h), BG_DARK)
    draw = ImageDraw.Draw(img)

    draw_rounded_rect(draw, (40, 30, w - 40, 110), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw.text((70, 48), "FIGURE 6: CHECKPOINT-AWARE WORKER LIFECYCLE, RESILIENCY & DB RECOVERY", fill=TEXT_WHITE, font=get_font(32, bold=True))
    draw.text((70, 84), "State Transition Lifecycle: Idempotent Checkpointing, Self-Healing Documents, and Quota Ledger", fill=ACCENT_CYAN, font=get_font(18))

    states = [
        {
            "name": "STATE: queued",
            "desc": "Evaluation record created\nCredit atomically reserved\nDevice quota check passed",
            "col": ACCENT_BLUE,
            "x": 60, "y": 200, "w": 320, "h": 220
        },
        {
            "name": "STATE: processing",
            "desc": "Worker claims job\nSelf-healing text extraction\nHeartbeat updatedAt touched",
            "col": BORDER_PURPLE,
            "x": 440, "y": 200, "w": 340, "h": 220
        },
        {
            "name": "CHECKPOINT 1: Agents",
            "desc": "Inspect agentRuns table\nExecute missing roles only\nPersist completed runs to DB",
            "col": ACCENT_CYAN,
            "x": 840, "y": 200, "w": 340, "h": 220
        },
        {
            "name": "CHECKPOINT 2: Debate",
            "desc": "Inspect debateMessages\nConduct bounded 6 turns\nPersist each turn as generated",
            "col": ACCENT_AMBER,
            "x": 1240, "y": 200, "w": 340, "h": 220
        },
        {
            "name": "STATE: completed",
            "desc": "Report synthesized & saved\nCredit settled in ledger\nOverall score & verdict locked",
            "col": ACCENT_GREEN,
            "x": 1640, "y": 200, "w": 300, "h": 220
        }
    ]

    for s in states:
        draw_rounded_rect(draw, (s["x"], s["y"], s["x"] + s["w"], s["y"] + s["h"]), fill=BG_CARD, outline=s["col"], width=2, radius=14)
        draw_rounded_rect(draw, (s["x"] + 15, s["y"] + 15, s["x"] + s["w"] - 15, s["y"] + 60), fill=s["col"], radius=8)
        draw.text((s["x"] + 25, s["y"] + 25), s["name"], fill=TEXT_WHITE, font=get_font(16, bold=True))
        lines = s["desc"].split("\n")
        ly = s["y"] + 80
        for line in lines:
            draw.text((s["x"] + 25, ly), line, fill=TEXT_MUTED, font=get_font(14))
            ly += 26

    # Arrows between states
    draw_arrow(draw, (380, 310), (440, 310), color=ACCENT_BLUE, width=4)
    draw_arrow(draw, (780, 310), (840, 310), color=BORDER_PURPLE, width=4)
    draw_arrow(draw, (1180, 310), (1240, 310), color=ACCENT_CYAN, width=4)
    draw_arrow(draw, (1580, 310), (1640, 310), color=ACCENT_GREEN, width=4)

    # Failure / Resiliency Branch (Bottom Box)
    draw_rounded_rect(draw, (60, 480, 1940, 860), fill=BG_CARD, outline=ACCENT_RED, width=2, radius=16)
    draw_rounded_rect(draw, (85, 505, 500, 550), fill="#7F1D1D", radius=8)
    draw.text((105, 517), "FAULT TOLERANCE & RECOVERY CONTROLS", fill=TEXT_WHITE, font=get_font(18, bold=True))

    res_items = [
        ("recoverStaleJobs() Routine", "Detects jobs stuck in 'processing' > 300s (5 min). Automatically relaunches worker with checkpoint reuse."),
        ("Worker Crash Idempotency", "When restarted, completed agentRuns and debateMessages are already in Postgres and skipped. Zero duplicate AI calls."),
        ("Self-Healing Document Extraction", "If extractedText is missing or empty, worker automatically pulls binary from storage key and re-runs extractor."),
        ("assertNotCancelled() Gate", "Checks cancellation flag before every expensive phase. If cancelled, immediately halts and releases credit."),
        ("Quota Refund on Fatal Outage", "If retry count exceeds max (3 retries) or fatal 429 quota exhaustion, releases reserved credit back to candidate.")
    ]
    ry = 575
    for title, desc in res_items:
        draw_rounded_rect(draw, (85, ry, 1915, ry + 46), fill=BG_CARD_LIGHT, radius=6)
        draw.text((105, ry + 12), title, fill=ACCENT_AMBER, font=get_font(15, bold=True))
        draw.text((450, ry + 13), desc, fill=TEXT_WHITE, font=get_font(14))
        ry += 54

    out_path = os.path.join(ASSETS_DIR, "fig6_worker_lifecycle.png")
    img.save(out_path, dpi=(300, 300))
    print(f"Generated: {out_path}")

# ==========================================
# DIAGRAM 7: Scoring Engine & ATS Formulation
# ==========================================
def generate_diagram_7():
    w, h = 2000, 950
    img = Image.new("RGB", (w, h), BG_DARK)
    draw = ImageDraw.Draw(img)

    draw_rounded_rect(draw, (40, 30, w - 40, 110), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw.text((70, 48), "FIGURE 7: QUANTITATIVE SCORING ENGINE, 5D WEIGHTING & VERDICT FORMULATION", fill=TEXT_WHITE, font=get_font(32, bold=True))
    draw.text((70, 84), "Exact Mathematical Calculations, Dimension Blending, Verdict Thresholds, and ATS Keyword Coverage", fill=ACCENT_CYAN, font=get_font(18))

    # 5 Dimension Cards (Left column)
    dims = [
        ("Role & Experience Fit", "30%", "hm.scoreContribution * 0.6 + hr.scoreContribution * 0.4", ACCENT_BLUE),
        ("Technical Skills & Evidence", "25%", "tech.scoreContribution (direct technical depth)", BORDER_PURPLE),
        ("ATS Keyword Alignment", "20%", "ats.scoreContribution (keyword match percentage)", ACCENT_CYAN),
        ("Business Impact & Clarity", "15%", "hm.scoreContribution (quantified commercial outcomes)", ACCENT_AMBER),
        ("Professional Presentation", "10%", "hr.scoreContribution * 0.5 + strat.scoreContribution * 0.5", ACCENT_GREEN),
    ]

    y = 150
    for name, weight, formula, col in dims:
        draw_rounded_rect(draw, (60, y, 980, y + 90), fill=BG_CARD, outline=col, width=2, radius=12)
        draw_rounded_rect(draw, (80, y + 15, 170, y + 75), fill=col, radius=8)
        draw.text((100, y + 25), weight, fill=TEXT_WHITE, font=get_font(24, bold=True))
        draw.text((190, y + 18), name, fill=TEXT_WHITE, font=get_font(18, bold=True))
        draw.text((190, y + 50), "Formula: " + formula, fill=TEXT_MUTED, font=get_font(13))
        y += 105

    # Overall Score Formula Box (Bottom Left)
    draw_rounded_rect(draw, (60, 690, 980, 890), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=14)
    draw.text((85, 715), "OVERALL WEIGHTED SCORE CALCULATION:", fill=TEXT_WHITE, font=get_font(18, bold=True))
    draw.text((85, 755), "OverallScore = (RoleFit * 0.30) + (Skills * 0.25) + (ATS * 0.20)\n               + (Impact * 0.15) + (Presentation * 0.10)", fill=ACCENT_CYAN, font=get_font(16, bold=True))
    draw.text((85, 825), "Confidence = max(0.65, min(0.98, 1 - (uncertainCount / totalFindings) * 0.25))", fill=ACCENT_GREEN, font=get_font(14))

    # Verdict Matrix (Right Column)
    draw_rounded_rect(draw, (1030, 150, 1940, 520), fill=BG_CARD, outline=ACCENT_GREEN, width=2, radius=14)
    draw_rounded_rect(draw, (1050, 170, 1920, 215), fill="#064E3B", radius=8)
    draw.text((1070, 182), "VERDICT CLASSIFICATION BENCHMARKS", fill=TEXT_WHITE, font=get_font(20, bold=True))

    verdicts = [
        ("85 - 100", "Strongly Recommended", "Elite alignment; passes both ATS and all committee reviewers", ACCENT_GREEN),
        ("70 - 84", "Recommended", "Strong candidate; minor polish required before recruiter screen", "#10B981"),
        ("55 - 69", "Borderline", "Viable background; requires significant quantified metrics or technical proof", ACCENT_AMBER),
        ("40 - 54", "Needs Major Work", "Fails automated ATS screening or major gaps in required competencies", "#F97316"),
        ("0 - 39", "Unprepared", "Fundamental mismatch with job description; major timeline / role gaps", ACCENT_RED),
    ]
    vy = 235
    for rng, vname, vdesc, vcol in verdicts:
        draw_rounded_rect(draw, (1050, vy, 1920, vy + 48), fill=BG_CARD_LIGHT, radius=6)
        draw_rounded_rect(draw, (1060, vy + 6, 1180, vy + 42), fill=vcol, radius=6)
        draw.text((1075, vy + 12), rng, fill=TEXT_WHITE, font=get_font(15, bold=True))
        draw.text((1200, vy + 12), vname, fill=TEXT_WHITE, font=get_font(16, bold=True))
        draw.text((1440, vy + 14), vdesc, fill=TEXT_MUTED, font=get_font(13))
        vy += 54

    # ATS Match Engine (Bottom Right)
    draw_rounded_rect(draw, (1030, 550, 1940, 890), fill=BG_CARD, outline=ACCENT_CYAN, width=2, radius=14)
    draw_rounded_rect(draw, (1050, 570, 1920, 615), fill="#0E7490", radius=8)
    draw.text((1070, 582), "ATS KEYWORD MATCHER ENGINE (matchJobDescriptionText)", fill=TEXT_WHITE, font=get_font(20, bold=True))

    ats_points = [
        "Tokenization & Stemming: Normalizes terms, handles plurals, acronyms, and common tech aliases.",
        "Exact Match Engine: Identifies verbatim occurrences of hard skills (e.g. 'Kubernetes', 'Drizzle ORM').",
        "Partial / Alias Match: Maps variations (e.g. 'Postgres' <-> 'PostgreSQL', 'JS' <-> 'JavaScript').",
        "Missing Term Severity: Weights missing mandatory qualifications higher than preferred bonuses.",
        "Coverage Formula: keywordCoveragePercentage = (matchedCount + 0.5 * partialCount) / totalKeyTerms."
    ]
    ay = 635
    for ap in ats_points:
        draw.text((1065, ay), "* " + ap, fill=TEXT_WHITE, font=get_font(14))
        ay += 46

    out_path = os.path.join(ASSETS_DIR, "fig7_scoring_engine.png")
    img.save(out_path, dpi=(300, 300))
    print(f"Generated: {out_path}")

# ==========================================
# DIAGRAM 8: Downstream Intelligence Engine
# ==========================================
def generate_diagram_8():
    w, h = 2000, 950
    img = Image.new("RGB", (w, h), BG_DARK)
    draw = ImageDraw.Draw(img)

    draw_rounded_rect(draw, (40, 30, w - 40, 110), fill=BG_CARD, outline=BORDER_PURPLE, width=2, radius=16)
    draw.text((70, 48), "FIGURE 8: DOWNSTREAM AGENT CAPABILITIES: REWRITES, DEFENSE & INTERVIEWS", fill=TEXT_WHITE, font=get_font(32, bold=True))
    draw.text((70, 84), "Truthful Bullet Rewriting, Bounded Candidate Defense Reassessment, and Mock Interview Simulator", fill=ACCENT_CYAN, font=get_font(18))

    # 3 Large Feature Columns
    cols = [
        {
            "title": "1. TRUTHFUL BULLET REWRITER",
            "sub": "Anti-Fabrication Resume Rewrites",
            "header_col": "#064E3B",
            "outline": ACCENT_GREEN,
            "x": 60, "w": 600,
            "points": [
                "Anti-Fabrication Guard (verifyTruthfulRewrite):",
                "Regex checks metrics (%, $, 10x, numbers).",
                "Strict rule: Never invents numbers or tools",
                "not present in the original CV bullet.",
                "",
                "Action-Oriented Transformation:",
                "Converts weak, passive duty descriptions into",
                "active, ownership-focused achievements.",
                "E.g., 'Worked on backend' -> 'Architected and",
                "deployed scalable backend services with...'"
            ]
        },
        {
            "title": "2. CANDIDATE DEFENSE ENGINE",
            "sub": "Bounded Score Reassessment",
            "header_col": "#1E3A8A",
            "outline": ACCENT_BLUE,
            "x": 700, "w": 600,
            "points": [
                "Contextual Defense Submission:",
                "Candidate can submit clarifying context",
                "and repo/project evidence to challenge flags.",
                "",
                "Strict Mathematical Ceiling (+15 Max Cap):",
                "Reassessment is bounded (+2 to +8 pts / defense).",
                "Cumulative delta capped at +15 points max,",
                "preventing trivial score manipulation.",
                "",
                "Dynamic Verdict Re-calculation:",
                "If delta pushes candidate into next tier,",
                "verdict is updated with audited rationale."
            ]
        },
        {
            "title": "3. MOCK INTERVIEW SIMULATOR",
            "sub": "Automated Competency Q&A",
            "header_col": "#4C1D95",
            "outline": BORDER_PURPLE,
            "x": 1340, "w": 600,
            "points": [
                "Tied Directly to Report Findings:",
                "Questions are generated from agent weaknesses",
                "and uncertain claims (e.g. system scalability).",
                "",
                "3-Point Automated Rubric Scoring:",
                "- Concrete past example & context",
                "- Clear technical methodology & trade-offs",
                "- Measurable outcome & commercial impact",
                "",
                "Interactive Feedback Loop:",
                "Candidate answers are scored with personalized",
                "coaching guidance for real-world interviews."
            ]
        }
    ]

    for c in cols:
        draw_rounded_rect(draw, (c["x"], 150, c["x"] + c["w"], 900), fill=BG_CARD, outline=c["outline"], width=2, radius=14)
        draw_rounded_rect(draw, (c["x"] + 20, 170, c["x"] + c["w"] - 20, 240), fill=c["header_col"], radius=8)
        draw.text((c["x"] + 35, 185), c["title"], fill=TEXT_WHITE, font=get_font(20, bold=True))
        draw.text((c["x"] + 35, 215), c["sub"], fill=ACCENT_CYAN, font=get_font(14))

        py = 270
        for pt in c["points"]:
            if pt == "":
                py += 15
                continue
            is_hdr = ":" in pt and not pt.startswith("E.g.")
            draw.text((c["x"] + 30, py), pt, fill=TEXT_WHITE if is_hdr else TEXT_MUTED, font=get_font(15, bold=is_hdr))
            py += 36

    out_path = os.path.join(ASSETS_DIR, "fig8_downstream_intelligence.png")
    img.save(out_path, dpi=(300, 300))
    print(f"Generated: {out_path}")

def generate_all_diagrams():
    print("Generating all 8 architectural figures...")
    generate_diagram_1()
    generate_diagram_2()
    generate_diagram_3()
    generate_diagram_4()
    generate_diagram_5()
    generate_diagram_6()
    generate_diagram_7()
    generate_diagram_8()
    print("All diagrams generated successfully.")

if __name__ == "__main__":
    generate_all_diagrams()
