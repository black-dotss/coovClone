/**
 * Famous Benchmark Company Roles and Presets
 * Canonical source for famous company benchmark roles across CookMyCV.
 */

export type PresetCategory = "big_tech" | "ai" | "cyber" | "blockchain";

export interface FamousRolePreset {
  id: string;
  name: string;
  company: string;
  role: string;
  title: string;
  category: PresetCategory;
  question: string;
  summary: string;
  description: string;
  sampleText?: string;
}

export const FAMOUS_ROLE_PRESETS: FamousRolePreset[] = [
  // --- BIG TECH & CLOUD ---
  {
    id: "google",
    name: "Google",
    company: "Google",
    role: "Senior Software Engineer (L5)",
    title: "Senior Software Engineer (L5)",
    category: "big_tech",
    question: "Would you make it to Google?",
    summary: "Large-scale distributed systems, high QPS concurrency, and Googleyness leadership.",
    sampleText: "Distributed systems architecture, high-throughput microservices handling millions of QPS, fault tolerance, consistency models, and collaborative technical leadership.",
    description: `Company: Google
Role: Senior Software Engineer (L5) - Distributed Systems

Minimum Qualifications:
- Bachelor's degree in Computer Science or equivalent practical experience.
- 5+ years of software development experience with Go, C++, Java, or Python.
- Experience with distributed computing, large-scale systems architecture, and automated test environments.

Core Evaluation Focus:
- Googleyness & Culture: Collaborative leadership, navigating ambiguity, and intellectual humility.
- System Design at Scale: Handling millions of QPS, fault tolerance, data partitioning, and consistency models.
- Code Craftsmanship: Writing readable, maintainable, and high-performance production software.`,
  },
  {
    id: "amazon",
    name: "Amazon AWS",
    company: "Amazon AWS",
    role: "Software Development Engineer II",
    title: "Software Development Engineer II",
    category: "big_tech",
    question: "Can you pass the Bar Raiser at Amazon?",
    summary: "High-scale cloud microservices, operational excellence, and AWS leadership principles.",
    sampleText: "Customer obsession, high availability cloud microservices, operational excellence, automated CI/CD pipelines, and end-to-end operational ownership.",
    description: `Company: Amazon AWS
Role: Software Development Engineer II (SDE II)

Basic Qualifications:
- 3+ years of non-internship professional software development experience.
- Strong object-oriented design and coding skills in Java, Python, Go, or C#.
- Experience building and deploying distributed cloud services.

Amazon Leadership Principles Focus:
- Customer Obsession: Relentless focus on customer trust and operational uptime.
- Bias for Action & Ownership: Rapid prototyping, zero-downtime deployments, and end-to-end service responsibility.
- Deliver Results: Measurable improvements in latency, throughput, and error budgets.`,
  },
  {
    id: "meta",
    name: "Meta",
    company: "Meta",
    role: "Senior Platform Engineer (E5)",
    title: "Senior Platform Engineer (E5)",
    category: "big_tech",
    summary: "Move fast execution, low-latency microservices, and distributed caching at social scale.",
    question: "Can you handle engineering velocity at Meta?",
    sampleText: "High shipping velocity, low-latency microservices, caching tiers, distributed queuing, and cross-functional technical leadership across complex infrastructure.",
    description: `Company: Meta
Role: Senior Platform Engineer (E5) - Infrastructure

Requirements:
- 5+ years building distributed backend infrastructure in C++, Python, Rust, or Go.
- Experience with high-throughput streaming, sharded databases, and caching tiers (RocksDB, Memcached).
- Proven track record of cross-functional technical leadership and mentoring.

Meta Culture Focus:
- Move Fast: Ship early, iterate fearlessly, and instrument comprehensive observability.
- Live in the Future: Proactively solving bottlenecks before they impact billions of users.
- Be Bold: Architectural willingness to rethink foundational systems for 10x scale.`,
  },
  {
    id: "microsoft",
    name: "Microsoft",
    company: "Microsoft",
    role: "Senior Cloud Architect (Azure)",
    title: "Senior Cloud Architect (Azure)",
    category: "big_tech",
    question: "Hyperscale-ready for Microsoft?",
    summary: "Enterprise distributed systems, fault-tolerant cloud, and security patterns.",
    sampleText: "Enterprise distributed cloud systems, resilience engineering, high availability architecture, zero-trust patterns, and cross-team executive technical guidance.",
    description: `Company: Microsoft
Role: Senior Software Engineer - Azure Cloud Platform

Requirements:
- 5+ years designing enterprise-grade cloud services in C#, Java, Go, or TypeScript.
- Hands-on experience with Kubernetes, multi-region failover, and high-availability SLAs.
- Customer-centric growth mindset and inclusive engineering practices.

Microsoft Values:
- Growth Mindset: Continuous learning, vulnerability, and constructive technical debate.
- Global Reliability: Architecting for five-nines uptime and zero unplanned downtime.`,
  },
  {
    id: "netflix",
    name: "Netflix",
    company: "Netflix",
    role: "Senior Distributed Systems Engineer (L5/L6)",
    title: "Senior Distributed Systems Engineer (L5/L6)",
    category: "big_tech",
    question: "Ready for high context & high performance at Netflix?",
    summary: "Freedom and Responsibility, chaos engineering resilience, and cloud edge streaming.",
    sampleText: "Chaos engineering, reactive microservices, gRPC protocols, and autonomous context-driven architecture.",
    description: `Company: Netflix
Role: Senior Distributed Systems Engineer - Edge Infrastructure

Requirements:
- 6+ years designing mission-critical distributed systems and event-driven architectures.
- Deep expertise in reactive programming, gRPC/Protobuf, and chaos resilience engineering.
- Autonomous decision-maker who thrives under high context and low control.

Netflix Culture:
- Freedom and Responsibility: Radical ownership with zero micro-management.
- High Performance: Stunning colleagues, rigorous code reviews, and transparent feedback.`,
  },
  {
    id: "apple",
    name: "Apple",
    company: "Apple",
    role: "Senior Systems Engineer - Core OS",
    title: "Senior Systems Engineer - Core OS",
    category: "big_tech",
    question: "Can your code pass Apple's obsession with craft?",
    summary: "Pixel-perfect performance, hardware-software integration, and privacy-first architecture.",
    sampleText: "Low-level systems engineering, C++, Swift, concurrency primitives, and hardware-software optimization.",
    description: `Company: Apple
Role: Senior Systems Engineer - Platform Architecture

Requirements:
- 4+ years of software engineering in systems development, C++, Swift, Go, or Rust.
- Understanding of low-level concurrency, memory safety, and secure protocols.
- Obsession with craft and performance.

Apple Focus:
- Engineering Craftsmanship: Micro-benchmarking, memory profiling, and clean APIs.
- Privacy & Security: Enterprise zero-trust architectures and encryption.`,
  },
  // --- AI & FRONTIER MODELS ---
  {
    id: "openai",
    name: "OpenAI",
    company: "OpenAI",
    role: "Staff Research Engineer - AI Infrastructure",
    title: "Staff Research Engineer - AI Infrastructure",
    category: "ai",
    question: "Ready to scale training clusters to thousands of GPUs?",
    summary: "Large language model training pipelines, distributed checkpointing, and GPU cluster throughput.",
    sampleText: "Distributed training optimization, PyTorch, Megatron-LM, GPU cluster networking, and high-throughput model inference.",
    description: `Company: OpenAI
Role: Staff Research Engineer - Training & Inference Infrastructure

Requirements:
- 5+ years scaling distributed systems for machine learning, deep learning, or high-performance computing (HPC).
- Strong proficiency with Python, C++, CUDA, PyTorch, and distributed training frameworks (FSDP, DeepSpeed).
- Experience debugging InfiniBand interconnects, NCCL collectives, and GPU memory saturation.
- Passion for pushing the frontier of artificial general intelligence safely.`,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    company: "Anthropic",
    role: "Senior Alignment & LLM Safety Engineer",
    title: "Senior Alignment & LLM Safety Engineer",
    category: "ai",
    question: "Can you build safe, steerable, and honest AI systems?",
    summary: "Constitutional AI, reinforcement learning from human feedback (RLHF), and evaluation harnesses.",
    sampleText: "Constitutional AI, automated evaluation benchmarks, RLHF pipelines, and robust alignment testing.",
    description: `Company: Anthropic
Role: Senior Alignment & LLM Safety Systems Engineer

Requirements:
- 4+ years building production ML systems with a strong foundation in transformer architectures.
- Experience with RLHF, red-teaming, mechanistic interpretability, or automated benchmark harnesses.
- Strong coding in Python, PyTorch, and cloud-scale data curation pipelines.
- Commitment to building steerable, interpretable, and beneficial frontier AI.`,
  },
  {
    id: "deepmind",
    name: "Google DeepMind",
    company: "Google DeepMind",
    role: "Senior Research Scientist - Frontier AI Models",
    title: "Senior Research Scientist - Frontier AI Models",
    category: "ai",
    question: "Can you invent novel model architectures for science?",
    summary: "Multimodal reasoning, novel transformer architectures, and massive-scale reinforcement learning.",
    sampleText: "Multimodal foundation models, reinforcement learning, JAX, TPU distributed training, and algorithmic innovation.",
    description: `Company: Google DeepMind
Role: Senior Research Scientist - Foundation Models

Requirements:
- PhD or equivalent research track record in Machine Learning, Mathematics, or Computer Science.
- Expertise in JAX, PyTorch, TPU/GPU cluster scaling, and multi-modal pretraining.
- Proven publication or production record in novel transformer architectures, RL, or reasoning models.`,
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    company: "NVIDIA",
    role: "Senior Deep Learning & CUDA Systems Engineer",
    title: "Senior Deep Learning & CUDA Systems Engineer",
    category: "ai",
    question: "Can you optimize kernel execution down to the clock cycle?",
    summary: "CUDA kernel optimization, TensorRT inference acceleration, and GPU hardware scheduling.",
    sampleText: "Low-level CUDA C++, GPU memory hierarchy optimization, TensorRT model compiler, and kernel fusion.",
    description: `Company: NVIDIA
Role: Senior Deep Learning & CUDA Systems Engineer

Requirements:
- 4+ years of hands-on CUDA, C++, and GPU systems programming.
- Deep understanding of Volta/Hopper/Blackwell architectures, shared memory, and warp execution models.
- Experience profiling compute and memory bottlenecks using Nsight Compute and TensorRT.`,
  },

  // --- CYBERSECURITY & THREAT DEFENSE ---
  {
    id: "crowdstrike",
    name: "CrowdStrike",
    company: "CrowdStrike",
    role: "Senior Threat Hunting & Cloud Security Architect",
    title: "Senior Threat Hunting & Cloud Security Architect",
    category: "cyber",
    question: "Can you detect and stop sophisticated nation-state adversaries?",
    summary: "Falcon sensor detection engineering, kernel eBPF telemetry, and real-time MITRE ATT&CK mitigation.",
    sampleText: "Detection engineering, eBPF telemetry, SIEM correlation, cloud workload protection, and incident triage.",
    description: `Company: CrowdStrike
Role: Senior Cloud Security & Detection Engineer

Requirements:
- 5+ years in security engineering, detection engineering, or incident response.
- Strong knowledge of eBPF, Linux internals, Windows API monitoring, and MITRE ATT&CK framework.
- Experience building streaming detection pipelines with Kafka, Go, or Python.
- Proven ability to analyze threat actor TTPs and reverse-engineer adversary payloads.`,
  },
  {
    id: "paloalto",
    name: "Palo Alto Networks",
    company: "Palo Alto Networks",
    role: "Senior Zero-Trust Network Security Engineer",
    title: "Senior Zero-Trust Network Security Engineer",
    category: "cyber",
    question: "Can you architect perimeterless enterprise defenses?",
    summary: "Zero-trust network architecture, SASE cloud gateway inspection, and automated vulnerability remediations.",
    sampleText: "Zero-trust network access, SASE architectures, micro-segmentation, PKI infrastructure, and intrusion prevention.",
    description: `Company: Palo Alto Networks
Role: Senior Zero-Trust Security Engineer

Requirements:
- 4+ years architecting enterprise zero-trust access, SASE, and cloud perimeter security.
- Expertise in TLS/mTLS, identity-aware proxies, SAML/OIDC, and automated compliance policy engines.
- Strong scripting skills in Python, Go, and Terraform infrastructure-as-code security.`,
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    company: "Cloudflare",
    role: "Senior Systems Security & DDoS Defense Engineer",
    title: "Senior Systems Security & DDoS Defense Engineer",
    category: "cyber",
    question: "Can your network defenses absorb terabit-scale attacks?",
    summary: "High-throughput packet filtering, Rust edge proxy security, and automated DDoS mitigation algorithms.",
    sampleText: "High-throughput XDP/eBPF packet filtering, Rust edge proxies, DNSSEC, and global volumetric attack mitigation.",
    description: `Company: Cloudflare
Role: Senior Edge Security & DDoS Mitigation Engineer

Requirements:
- 5+ years building high-performance networking and edge security systems in Rust, Go, or C.
- Deep expertise in Linux network stack, XDP/eBPF, BGP Anycast routing, and TCP/UDP attack mitigation.
- Passion for keeping the global internet fast, safe, and resilient against terabit-scale attacks.`,
  },

  // --- BLOCKCHAIN & WEB3 ---
  {
    id: "coinbase",
    name: "Coinbase",
    company: "Coinbase",
    role: "Senior Smart Contract & Protocol Security Engineer",
    title: "Senior Smart Contract & Protocol Security Engineer",
    category: "blockchain",
    question: "Can you safeguard billions in decentralized on-chain assets?",
    summary: "EVM protocol security, formal verification, smart contract auditing, and institutional cold storage.",
    sampleText: "Solidity smart contract auditing, EVM architecture, formal verification, institutional MPC key management, and protocol security.",
    description: `Company: Coinbase
Role: Senior Protocol & Smart Contract Security Engineer

Requirements:
- 4+ years of blockchain security engineering, smart contract auditing, or protocol design.
- Deep understanding of EVM bytecode, reentrancy vulnerabilities, gas optimization, and MEV dynamics.
- Experience with formal verification tools (Slither, Echidna, Certora) and multi-party computation (MPC).`,
  },
  {
    id: "chainlink",
    name: "Chainlink",
    company: "Chainlink",
    role: "Senior Decentralized Oracle Infrastructure Engineer",
    title: "Senior Decentralized Oracle Infrastructure Engineer",
    category: "blockchain",
    question: "Can you connect deterministic blockchains to real-world data?",
    summary: "Decentralized oracle networks, cross-chain interoperability protocol (CCIP), and Byzantine fault tolerance.",
    sampleText: "Decentralized oracle networks, Byzantine fault tolerance, Go, Solidity, and cross-chain messaging protocols.",
    description: `Company: Chainlink Labs
Role: Senior Blockchain Oracle Infrastructure Engineer

Requirements:
- 4+ years of backend systems engineering in Go or Rust with solid decentralized protocols experience.
- Understanding of consensus algorithms, cryptographic primitives (threshold signatures, VRF), and p2p networking.
- Experience deploying production nodes connecting smart contracts with off-chain financial data.`,
  },
  {
    id: "binance",
    name: "Binance",
    company: "Binance",
    role: "Senior Blockchain Core & High-Frequency Trading Engineer",
    title: "Senior Blockchain Core & High-Frequency Trading Engineer",
    category: "blockchain",
    question: "Can you handle millions of orders per second on-chain?",
    summary: "Matching engine optimization, ultra-low latency order routing, and high-throughput blockchain state sync.",
    sampleText: "Ultra-low latency order matching, C++, memory-mapped order books, lock-free queues, and blockchain state sync.",
    description: `Company: Binance
Role: Senior Core Exchange & Blockchain Trading Systems Engineer

Requirements:
- 5+ years developing ultra-low-latency financial matching engines or blockchain core consensus in C++ or Rust.
- Deep mastery of lock-free data structures, zero-copy networking, and cache-conscious architectures.
- Experience handling volatile cryptocurrency liquidity surges with zero order book drift.`,
  },
];

export const FAMOUS_COMPANY_KEYWORDS = [
  "google",
  "alphabet",
  "deepmind",
  "amazon",
  "aws",
  "meta",
  "facebook",
  "netflix",
  "apple",
  "microsoft",
  "azure",
  "openai",
  "anthropic",
  "nvidia",
  "crowdstrike",
  "palo alto",
  "paloalto",
  "cloudflare",
  "coinbase",
  "chainlink",
  "binance",
];

/**
 * Determines whether a job description (from DB or form) corresponds to a benchmark
 * preset role or famous company, so that user custom role lists don't duplicate them.
 */
export function isFamousPresetJd(jd: {
  id?: string | null;
  company?: string | null;
  roleTitle?: string | null;
  title?: string | null;
  rawText?: string | null;
  description?: string | null;
}): boolean {
  const company = (jd.company || "").trim().toLowerCase();
  const title = (jd.title || jd.roleTitle || "").trim().toLowerCase();
  const raw = (jd.rawText || jd.description || "").trim().toLowerCase().replace(/\s+/g, " ");

  // 1. Company name check against known famous benchmark companies
  if (company.length > 0) {
    for (const keyword of FAMOUS_COMPANY_KEYWORDS) {
      if (company === keyword || company.includes(keyword)) {
        return true;
      }
    }
  }

  // 2. Substring match against benchmark presets
  return FAMOUS_ROLE_PRESETS.some((preset) => {
    const pCompany = preset.company.trim().toLowerCase();
    const pTitle = preset.title.trim().toLowerCase();
    const pRole = preset.role.trim().toLowerCase();
    const pSummary = preset.summary.trim().toLowerCase();
    const pDesc = preset.description.trim().toLowerCase().replace(/\s+/g, " ");
    const pSample = (preset.sampleText || "").trim().toLowerCase().replace(/\s+/g, " ");

    const exactTitleMatch =
      title.length > 3 && (title === pTitle || title === pRole);

    const titleSubstringMatch =
      (title.length > 5 && (pTitle.includes(title) || pRole.includes(title))) ||
      (pTitle.length > 5 && title.includes(pTitle));

    const companyMatch =
      company.length > 0 &&
      (company === pCompany ||
        pCompany.includes(company) ||
        company.includes(pCompany));

    const textMatch =
      (raw.length > 25 && pDesc.includes(raw.slice(0, 30))) ||
      (pDesc.length > 25 && raw.includes(pDesc.slice(0, 30))) ||
      (raw.length > 20 && raw.includes(pSummary.slice(0, 25))) ||
      (pSample.length > 20 && (raw.includes(pSample.slice(0, 25)) || pSample.includes(raw.slice(0, 25))));

    return (
      exactTitleMatch ||
      textMatch ||
      (titleSubstringMatch && companyMatch) ||
      (companyMatch && title.length > 0)
    );
  });
}
