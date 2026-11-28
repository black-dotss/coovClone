#!/usr/bin/env python3
"""COOV Protocol On-Chain State Verifier (Solana Devnet).

Independently derives Anchor PDAs, fetches live account state over RPC using
`solders` and `solana.rpc.async_api.AsyncClient`, verifies Borsh discriminators
and struct fields against the deployed Anchor program (`FXboyZZ2em2FqXrcr4Uz5nfrHHQ4K1NaJ6kP9VMBJ3Yt`),
and audits Token-2022 Non-Transferable Soulbound Credentials and Devnet USDC vaults.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import struct
import sys
import uuid
from dataclasses import asdict, dataclass
from typing import Any, Optional

from dotenv import load_dotenv
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey

DEFAULT_PROGRAM_ID = "FXboyZZ2em2FqXrcr4Uz5nfrHHQ4K1NaJ6kP9VMBJ3Yt"
DEFAULT_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com"

TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
TOKEN_2022_PROGRAM_ID = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")

# Token-2022 NonTransferable extension type = 9 per spl-token-2022 TLV header spec
TOKEN_2022_EXT_NON_TRANSFERABLE = 9
TOKEN_2022_BASE_MINT_LEN = 82
TOKEN_2022_ACCOUNT_TYPE_OFFSET = 165  # AccountType::Mint = 1 at offset 165, TLV starts at 166


def anchor_account_discriminator(account_name: str) -> bytes:
    return hashlib.sha256(f"account:{account_name}".encode("utf-8")).digest()[:8]


def uuid_to_bytes16(value: str) -> bytes:
    cleaned = value.strip()
    try:
        return uuid.UUID(cleaned).bytes
    except ValueError:
        raw = cleaned.encode("utf-8")
        out = bytearray(16)
        for i, b in enumerate(raw):
            out[i % 16] = (out[i % 16] ^ b ^ ((i * 31) & 0xFF)) & 0xFF
        return bytes(out)


def bytes16_to_uuid(data: bytes) -> str:
    return str(uuid.UUID(bytes=data[:16]))


class BorshReader:
    """Minimal little-endian Anchor/Borsh binary reader."""

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.offset = 0

    def read_bytes(self, n: int) -> bytes:
        end = self.offset + n
        if end > len(self.data):
            raise ValueError(f"Unexpected EOF reading {n} bytes at offset {self.offset}")
        chunk = self.data[self.offset : end]
        self.offset = end
        return chunk

    def read_u8(self) -> int:
        return self.read_bytes(1)[0]

    def read_bool(self) -> bool:
        return self.read_u8() == 1

    def read_u16(self) -> int:
        return struct.unpack("<H", self.read_bytes(2))[0]

    def read_u32(self) -> int:
        return struct.unpack("<I", self.read_bytes(4))[0]

    def read_u64(self) -> int:
        return struct.unpack("<Q", self.read_bytes(8))[0]

    def read_i64(self) -> int:
        return struct.unpack("<q", self.read_bytes(8))[0]

    def read_pubkey(self) -> str:
        return str(Pubkey.from_bytes(self.read_bytes(32)))

    def read_string(self) -> str:
        length = self.read_u32()
        return self.read_bytes(length).decode("utf-8", errors="replace")

    def read_string_vec(self) -> list[str]:
        count = self.read_u32()
        return [self.read_string() for _ in range(count)]

    def assert_discriminator(self, expected_name: str) -> None:
        actual = self.read_bytes(8)
        expected = anchor_account_discriminator(expected_name)
        if actual != expected:
            raise ValueError(
                f"Discriminator mismatch for {expected_name}: got {actual.hex()}, expected {expected.hex()}"
            )


def derive_config_pda(program_id: Pubkey) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address([b"config"], program_id)


def derive_profile_pda(candidate: Pubkey, program_id: Pubkey) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address([b"profile", bytes(candidate)], program_id)


def derive_evaluation_pda(candidate: Pubkey, eval_id: str, program_id: Pubkey) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [b"eval", bytes(candidate), uuid_to_bytes16(eval_id)], program_id
    )


def derive_escrow_pda(job_id: str, program_id: Pubkey) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address([b"escrow", uuid_to_bytes16(job_id)], program_id)


def derive_escrow_vault_pda(escrow_pda: Pubkey, program_id: Pubkey) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address([b"escrow_vault", bytes(escrow_pda)], program_id)


def derive_claim_pda(
    escrow_pda: Pubkey, candidate: Pubkey, program_id: Pubkey
) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address([b"claim", bytes(escrow_pda), bytes(candidate)], program_id)


def derive_conviction_stake_pda(
    escrow_pda: Pubkey, candidate: Pubkey, program_id: Pubkey
) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [b"conviction_stake", bytes(escrow_pda), bytes(candidate)], program_id
    )


def derive_reputation_pda(candidate: Pubkey, program_id: Pubkey) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address([b"reputation", bytes(candidate)], program_id)


def derive_dispute_ticket_pda(
    escrow_pda: Pubkey, candidate: Pubkey, program_id: Pubkey
) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(
        [b"dispute_ticket", bytes(escrow_pda), bytes(candidate)], program_id
    )


@dataclass
class DecodedProgramConfig:
    pda: str
    admin: str
    oracle_authority: str
    paused: bool
    bump: int


@dataclass
class DecodedCandidateProfile:
    pda: str
    wallet: str
    eval_count: int
    highest_score: int
    top_skills: list[str]
    last_role_title: str
    updated_at: int
    bump: int


@dataclass
class DecodedEvaluationRecord:
    pda: str
    candidate: str
    eval_id: str
    job_id: str
    initial_report_hash: str
    current_report_hash: str
    initial_score: int
    composite_score: int
    agent_scores: dict[str, int]
    defense_count: int
    sbt_minted: bool
    sbt_mint: str
    model_version: str
    role_title: str
    created_at: int
    updated_at: int
    bump: int


@dataclass
class DecodedBountyEscrow:
    pda: str
    vault_pda: str
    recruiter: str
    job_id: str
    usdc_mint: str
    vault: str
    reward_per_winner_micros: int
    max_winners: int
    claims_count: int
    min_score: int
    expires_at: int
    is_closed: bool
    bump: int
    vault_bump: int
    stake_bps: int = 1000
    slashed_pool_amount_micros: int = 0
    min_streak: int = 0
    open_disputes_count: int = 0
    is_legacy_layout: bool = False
    vault_balance_usdc: Optional[float] = None


@dataclass
class DecodedConvictionStake:
    pda: str
    escrow: str
    candidate: str
    amount_staked_micros: int
    status: str
    submitted_at: int
    resolved_at: int
    bump: int
    referrer: Optional[str] = None
    is_zero_stake_vip: bool = False


@dataclass
class DecodedReputationState:
    pda: str
    wallet: str
    last_verified_at: int
    verified_streak: int
    total_earned_usdc_micros: int
    fraud_flags: int
    bump: int


@dataclass
class DecodedDisputeTicket:
    pda: str
    bounty: str
    candidate: str
    evaluation_score: int
    votes_for_candidate: int
    votes_for_recruiter: int
    jurors: list[str]
    status: str
    opened_at: int
    evaluation: str
    bump: int


def decode_dispute_ticket(pda: Pubkey, raw: bytes) -> DecodedDisputeTicket:
    r = BorshReader(raw)
    r.assert_discriminator("DisputeTicket")
    bounty = r.read_pubkey()
    candidate = r.read_pubkey()
    evaluation_score = r.read_u8()
    votes_for_candidate = r.read_u8()
    votes_for_recruiter = r.read_u8()
    jurors_raw = [r.read_pubkey(), r.read_pubkey(), r.read_pubkey()]
    total_votes = min(3, votes_for_candidate + votes_for_recruiter)
    default_pk = str(Pubkey.default())
    jurors = [j for j in jurors_raw[:total_votes] if j != default_pk]
    status_idx = r.read_u8()
    status_map = {0: "Open", 1: "ResolvedCandidate", 2: "ResolvedRecruiter"}
    opened_at = r.read_i64()
    evaluation = r.read_pubkey()
    bump = r.read_u8()
    return DecodedDisputeTicket(
        pda=str(pda),
        bounty=bounty,
        candidate=candidate,
        evaluation_score=evaluation_score,
        votes_for_candidate=votes_for_candidate,
        votes_for_recruiter=votes_for_recruiter,
        jurors=jurors,
        status=status_map.get(status_idx, f"Unknown({status_idx})"),
        opened_at=opened_at,
        evaluation=evaluation,
        bump=bump,
    )


def decode_program_config(pda: Pubkey, raw: bytes) -> DecodedProgramConfig:
    r = BorshReader(raw)
    r.assert_discriminator("ProgramConfig")
    return DecodedProgramConfig(
        pda=str(pda),
        admin=r.read_pubkey(),
        oracle_authority=r.read_pubkey(),
        paused=r.read_bool(),
        bump=r.read_u8(),
    )


def decode_candidate_profile(pda: Pubkey, raw: bytes) -> DecodedCandidateProfile:
    r = BorshReader(raw)
    r.assert_discriminator("CandidateProfile")
    return DecodedCandidateProfile(
        pda=str(pda),
        wallet=r.read_pubkey(),
        eval_count=r.read_u32(),
        highest_score=r.read_u8(),
        top_skills=r.read_string_vec(),
        last_role_title=r.read_string(),
        updated_at=r.read_i64(),
        bump=r.read_u8(),
    )


def decode_evaluation_record(pda: Pubkey, raw: bytes) -> DecodedEvaluationRecord:
    r = BorshReader(raw)
    r.assert_discriminator("EvaluationRecord")
    candidate = r.read_pubkey()
    eval_id = bytes16_to_uuid(r.read_bytes(16))
    job_id = bytes16_to_uuid(r.read_bytes(16))
    initial_hash = r.read_bytes(32).hex()
    current_hash = r.read_bytes(32).hex()
    initial_score = r.read_u8()
    composite_score = r.read_u8()
    scores = list(r.read_bytes(6))
    return DecodedEvaluationRecord(
        pda=str(pda),
        candidate=candidate,
        eval_id=eval_id,
        job_id=job_id,
        initial_report_hash=initial_hash,
        current_report_hash=current_hash,
        initial_score=initial_score,
        composite_score=composite_score,
        agent_scores={
            "hr_recruiter": scores[0],
            "technical_interviewer": scores[1],
            "ats_scanner": scores[2],
            "hiring_manager": scores[3],
            "career_strategist": scores[4],
            "red_flag_analyst": scores[5],
        },
        defense_count=r.read_u8(),
        sbt_minted=r.read_bool(),
        sbt_mint=r.read_pubkey(),
        model_version=r.read_string(),
        role_title=r.read_string(),
        created_at=r.read_i64(),
        updated_at=r.read_i64(),
        bump=r.read_u8(),
    )


def decode_bounty_escrow(pda: Pubkey, vault_pda: Pubkey, raw: bytes) -> DecodedBountyEscrow:
    r = BorshReader(raw)
    r.assert_discriminator("BountyEscrow")
    recruiter = r.read_pubkey()
    job_id = bytes16_to_uuid(r.read_bytes(16))
    usdc_mint = r.read_pubkey()
    vault = r.read_pubkey()
    reward_per_winner_micros = r.read_u64()
    max_winners = r.read_u16()
    claims_count = r.read_u16()
    min_score = r.read_u8()
    expires_at = r.read_i64()
    is_closed = r.read_bool()
    bump = r.read_u8()
    vault_bump = r.read_u8()

    stake_bps = 1000
    slashed_pool_amount_micros = 0
    min_streak = 0
    open_disputes_count = 0
    is_legacy_layout = True
    if len(raw) >= 154:
        parsed_bps = r.read_u16()
        stake_bps = parsed_bps if parsed_bps > 0 else 1000
        slashed_pool_amount_micros = r.read_u64()
    if len(raw) >= 155:
        min_streak = r.read_u8()
    if len(raw) >= 157:
        open_disputes_count = r.read_u16()
        is_legacy_layout = False

    return DecodedBountyEscrow(
        pda=str(pda),
        vault_pda=str(vault_pda),
        recruiter=recruiter,
        job_id=job_id,
        usdc_mint=usdc_mint,
        vault=vault,
        reward_per_winner_micros=reward_per_winner_micros,
        max_winners=max_winners,
        claims_count=claims_count,
        min_score=min_score,
        expires_at=expires_at,
        is_closed=is_closed,
        bump=bump,
        vault_bump=vault_bump,
        stake_bps=stake_bps,
        slashed_pool_amount_micros=slashed_pool_amount_micros,
        min_streak=min_streak,
        open_disputes_count=open_disputes_count,
        is_legacy_layout=is_legacy_layout,
    )


def decode_conviction_stake(pda: Pubkey, raw: bytes) -> DecodedConvictionStake:
    r = BorshReader(raw)
    r.assert_discriminator("ConvictionStake")
    escrow = r.read_pubkey()
    candidate = r.read_pubkey()
    amount_staked_micros = r.read_u64()
    status_idx = r.read_u8()
    status_map = {0: "Pending", 1: "Approved", 2: "Slashed", 3: "Refunded"}
    submitted_at = r.read_i64()
    resolved_at = r.read_i64()
    referrer: Optional[str] = None
    is_zero_stake_vip = False
    if len(raw) <= 98:
        bump = r.read_u8()
    else:
        has_ref = r.read_u8()
        referrer = r.read_pubkey() if has_ref == 1 else None
        is_zero_stake_vip = r.read_bool()
        bump = r.read_u8()

    return DecodedConvictionStake(
        pda=str(pda),
        escrow=escrow,
        candidate=candidate,
        amount_staked_micros=amount_staked_micros,
        status=status_map.get(status_idx, f"Unknown({status_idx})"),
        submitted_at=submitted_at,
        resolved_at=resolved_at,
        bump=bump,
        referrer=referrer,
        is_zero_stake_vip=is_zero_stake_vip,
    )


def decode_reputation_state(pda: Pubkey, raw: bytes) -> DecodedReputationState:
    r = BorshReader(raw)
    r.assert_discriminator("ReputationState")
    return DecodedReputationState(
        pda=str(pda),
        wallet=r.read_pubkey(),
        last_verified_at=r.read_i64(),
        verified_streak=r.read_u8(),
        total_earned_usdc_micros=r.read_u64(),
        fraud_flags=r.read_u8(),
        bump=r.read_u8(),
    )


def parse_token2022_extension_types(mint_data: bytes) -> list[int]:
    """Parses Token-2022 TLV extension type IDs appended after offset 166."""
    if len(mint_data) <= TOKEN_2022_ACCOUNT_TYPE_OFFSET + 1:
        return []
    account_type = mint_data[TOKEN_2022_ACCOUNT_TYPE_OFFSET]
    if account_type != 1:  # AccountType::Mint == 1
        return []
    extensions: list[int] = []
    pos = TOKEN_2022_ACCOUNT_TYPE_OFFSET + 1
    while pos + 4 <= len(mint_data):
        ext_type, ext_len = struct.unpack_from("<HH", mint_data, pos)
        if ext_type == 0:
            break
        extensions.append(ext_type)
        pos += 4 + ext_len
    return extensions


async def run_audit(args: argparse.Namespace) -> dict[str, Any]:
    program_id = Pubkey.from_string(args.program_id)
    usdc_mint = Pubkey.from_string(args.usdc_mint)

    report: dict[str, Any] = {
        "rpc_url": args.rpc,
        "program_id": str(program_id),
        "usdc_mint": str(usdc_mint),
        "checks": {},
    }

    async with AsyncClient(args.rpc) as client:
        # 1. Verify deployed executable program
        prog_resp = await client.get_account_info(program_id)
        prog_acc = prog_resp.value
        report["checks"]["program"] = {
            "exists": prog_acc is not None,
            "executable": bool(prog_acc and prog_acc.executable),
            "owner": str(prog_acc.owner) if prog_acc else None,
            "lamports": prog_acc.lamports if prog_acc else 0,
        }

        # 2. Verify ProgramConfig PDA
        config_pda, _ = derive_config_pda(program_id)
        cfg_resp = await client.get_account_info(config_pda)
        if cfg_resp.value and cfg_resp.value.owner == program_id:
            cfg = decode_program_config(config_pda, bytes(cfg_resp.value.data))
            report["checks"]["program_config"] = asdict(cfg)
        else:
            report["checks"]["program_config"] = {
                "pda": str(config_pda),
                "initialized": False,
            }

        # 3. Verify Devnet USDC Mint
        usdc_resp = await client.get_account_info(usdc_mint)
        usdc_acc = usdc_resp.value
        usdc_decimals = None
        if usdc_acc and len(usdc_acc.data) >= TOKEN_2022_BASE_MINT_LEN:
            usdc_decimals = bytes(usdc_acc.data)[44]
        report["checks"]["usdc_mint"] = {
            "exists": usdc_acc is not None,
            "owner": str(usdc_acc.owner) if usdc_acc else None,
            "decimals": usdc_decimals,
            "is_spl_token": bool(
                usdc_acc and usdc_acc.owner in (TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID)
            ),
        }

        # 4. CandidateProfile PDA (if --wallet specified)
        candidate_pk: Optional[Pubkey] = None
        if args.wallet:
            candidate_pk = Pubkey.from_string(args.wallet)
            profile_pda, _ = derive_profile_pda(candidate_pk, program_id)
            prof_resp = await client.get_account_info(profile_pda)
            if prof_resp.value and prof_resp.value.owner == program_id:
                report["checks"]["candidate_profile"] = asdict(
                    decode_candidate_profile(profile_pda, bytes(prof_resp.value.data))
                )
            else:
                report["checks"]["candidate_profile"] = {
                    "pda": str(profile_pda),
                    "wallet": str(candidate_pk),
                    "initialized": False,
                }

            rep_pda, _ = derive_reputation_pda(candidate_pk, program_id)
            rep_resp = await client.get_account_info(rep_pda)
            if rep_resp.value and rep_resp.value.owner == program_id:
                report["checks"]["reputation_state"] = asdict(
                    decode_reputation_state(rep_pda, bytes(rep_resp.value.data))
                )
            else:
                report["checks"]["reputation_state"] = {
                    "pda": str(rep_pda),
                    "wallet": str(candidate_pk),
                    "initialized": False,
                }

        # 5. EvaluationRecord Proof PDA (if --eval-id & --wallet specified)
        if args.eval_id:
            if not candidate_pk:
                raise ValueError("--eval-id requires --wallet to derive EvaluationRecord PDA")
            eval_pda, _ = derive_evaluation_pda(candidate_pk, args.eval_id, program_id)
            eval_resp = await client.get_account_info(eval_pda)
            if eval_resp.value and eval_resp.value.owner == program_id:
                report["checks"]["evaluation_record"] = asdict(
                    decode_evaluation_record(eval_pda, bytes(eval_resp.value.data))
                )
            else:
                report["checks"]["evaluation_record"] = {
                    "pda": str(eval_pda),
                    "eval_id": args.eval_id,
                    "initialized": False,
                }

        # 6. BountyEscrow + EscrowVault + optional BountyClaim (if --job-id specified)
        if args.job_id:
            escrow_pda, _ = derive_escrow_pda(args.job_id, program_id)
            vault_pda, _ = derive_escrow_vault_pda(escrow_pda, program_id)
            escrow_resp = await client.get_account_info(escrow_pda)
            if escrow_resp.value and escrow_resp.value.owner == program_id:
                decoded_escrow = decode_bounty_escrow(
                    escrow_pda, vault_pda, bytes(escrow_resp.value.data)
                )
                bal_resp = await client.get_token_account_balance(vault_pda)
                if bal_resp.value:
                    decoded_escrow.vault_balance_usdc = float(bal_resp.value.ui_amount or 0.0)
                report["checks"]["bounty_escrow"] = asdict(decoded_escrow)
            else:
                report["checks"]["bounty_escrow"] = {
                    "pda": str(escrow_pda),
                    "vault_pda": str(vault_pda),
                    "job_id": args.job_id,
                    "initialized": False,
                }

            if candidate_pk:
                stake_pda, _ = derive_conviction_stake_pda(escrow_pda, candidate_pk, program_id)
                stake_resp = await client.get_account_info(stake_pda)
                if stake_resp.value and stake_resp.value.owner == program_id:
                    report["checks"]["conviction_stake"] = asdict(
                        decode_conviction_stake(stake_pda, bytes(stake_resp.value.data))
                    )
                else:
                    report["checks"]["conviction_stake"] = {
                        "pda": str(stake_pda),
                        "initialized": False,
                    }

                claim_pda, _ = derive_claim_pda(escrow_pda, candidate_pk, program_id)
                claim_resp = await client.get_account_info(claim_pda)
                report["checks"]["bounty_claim"] = {
                    "pda": str(claim_pda),
                    "claimed": claim_resp.value is not None,
                }

                dispute_pda, _ = derive_dispute_ticket_pda(escrow_pda, candidate_pk, program_id)
                dispute_resp = await client.get_account_info(dispute_pda)
                if dispute_resp.value and dispute_resp.value.owner == program_id:
                    report["checks"]["dispute_ticket"] = asdict(
                        decode_dispute_ticket(dispute_pda, bytes(dispute_resp.value.data))
                    )
                else:
                    report["checks"]["dispute_ticket"] = {
                        "pda": str(dispute_pda),
                        "initialized": False,
                    }

        # 7. Token-2022 Soulbound Mint Verification (if --mint specified)
        if args.mint:
            mint_pk = Pubkey.from_string(args.mint)
            mint_resp = await client.get_account_info(mint_pk)
            mint_acc = mint_resp.value
            if mint_acc:
                raw_mint = bytes(mint_acc.data)
                supply = struct.unpack_from("<Q", raw_mint, 36)[0] if len(raw_mint) >= 44 else None
                decimals = raw_mint[44] if len(raw_mint) > 44 else None
                ext_ids = parse_token2022_extension_types(raw_mint)
                report["checks"]["soulbound_mint"] = {
                    "mint": str(mint_pk),
                    "owned_by_token_2022": mint_acc.owner == TOKEN_2022_PROGRAM_ID,
                    "owner_program": str(mint_acc.owner),
                    "supply": supply,
                    "decimals": decimals,
                    "extension_type_ids": ext_ids,
                    "non_transferable_enabled": TOKEN_2022_EXT_NON_TRANSFERABLE in ext_ids,
                }
            else:
                report["checks"]["soulbound_mint"] = {
                    "mint": str(mint_pk),
                    "exists": False,
                }

    return report


def print_audit_report(report: dict[str, Any]) -> None:
    print("=" * 72)
    print("COOV PROTOCOL — SOLANA ON-CHAIN AUDIT REPORT")
    print("=" * 72)
    print(f"RPC Endpoint : {report['rpc_url']}")
    print(f"Program ID   : {report['program_id']}")
    print(f"USDC Mint    : {report['usdc_mint']}")
    print("-" * 72)

    checks = report["checks"]
    prog = checks.get("program", {})
    print(
        f"[Program]         exists={prog.get('exists')} executable={prog.get('executable')} owner={prog.get('owner')}"
    )

    cfg = checks.get("program_config", {})
    if "admin" in cfg:
        print(
            f"[ProgramConfig]   pda={cfg['pda']} oracle={cfg['oracle_authority']} paused={cfg['paused']}"
        )
    else:
        print(f"[ProgramConfig]   pda={cfg.get('pda')} initialized=False")

    usdc = checks.get("usdc_mint", {})
    print(
        f"[Devnet USDC]     exists={usdc.get('exists')} decimals={usdc.get('decimals')} owner={usdc.get('owner')}"
    )

    if "candidate_profile" in checks:
        p = checks["candidate_profile"]
        if "wallet" in p and "eval_count" in p:
            print(
                f"[CandidateProfile] pda={p['pda']} evals={p['eval_count']} high={p['highest_score']}/100 skills={p['top_skills']}"
            )
        else:
            print(f"[CandidateProfile] pda={p['pda']} initialized=False")

    if "evaluation_record" in checks:
        ev = checks["evaluation_record"]
        if "composite_score" in ev:
            print(
                f"[EvaluationProof] pda={ev['pda']} score={ev['composite_score']}/100 sbt_minted={ev['sbt_minted']} hash={ev['current_report_hash'][:16]}..."
            )
        else:
            print(f"[EvaluationProof] pda={ev['pda']} initialized=False")

    if "bounty_escrow" in checks:
        es = checks["bounty_escrow"]
        if "reward_per_winner_micros" in es:
            reward = es["reward_per_winner_micros"] / 1_000_000
            slashed = es.get("slashed_pool_amount_micros", 0) / 1_000_000
            stake_pct = es.get("stake_bps", 1000) / 100
            print(
                f"[BountyEscrow]    pda={es['pda']} reward={reward:.2f} USDC stake={stake_pct:.1f}% slashed_pool={slashed:.2f} USDC slots={es['claims_count']}/{es['max_winners']} min_score={es['min_score']} vault_usdc={es.get('vault_balance_usdc')}"
            )
        else:
            print(f"[BountyEscrow]    pda={es['pda']} initialized=False")

    if "conviction_stake" in checks:
        cs = checks["conviction_stake"]
        if "amount_staked_micros" in cs:
            staked = cs["amount_staked_micros"] / 1_000_000
            print(
                f"[ConvictionStake] pda={cs['pda']} status={cs['status']} staked={staked:.2f} USDC candidate={cs['candidate']}"
            )
        else:
            print(f"[ConvictionStake] pda={cs['pda']} initialized=False")

    if "bounty_claim" in checks:
        cl = checks["bounty_claim"]
        print(f"[BountyClaim]     pda={cl['pda']} claimed={cl['claimed']}")

    if "dispute_ticket" in checks:
        dt = checks["dispute_ticket"]
        if "status" in dt:
            print(
                f"[DisputeTicket]   pda={dt['pda']} status={dt['status']} score={dt['evaluation_score']} cand={dt['votes_for_candidate']}/2 rec={dt['votes_for_recruiter']}/2"
            )
        else:
            print(f"[DisputeTicket]   pda={dt['pda']} initialized=False")

    if "soulbound_mint" in checks:
        sbt = checks["soulbound_mint"]
        print(
            f"[Token-2022 SBT]  mint={sbt.get('mint')} token2022={sbt.get('owned_by_token_2022')} non_transferable={sbt.get('non_transferable_enabled')} supply={sbt.get('supply')} decimals={sbt.get('decimals')}"
        )

    print("=" * 72)


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description="COOV Solana Devnet On-Chain Audit CLI")
    parser.add_argument(
        "--rpc",
        default=os.getenv("SOLANA_RPC_URL") or os.getenv("NEXT_PUBLIC_SOLANA_RPC_URL") or DEFAULT_DEVNET_RPC,
        help="Solana JSON-RPC endpoint URL",
    )
    parser.add_argument(
        "--program-id",
        default=os.getenv("NEXT_PUBLIC_SOLANA_PROGRAM_ID") or DEFAULT_PROGRAM_ID,
        help="COOV Anchor Program ID",
    )
    parser.add_argument(
        "--usdc-mint",
        default=os.getenv("NEXT_PUBLIC_SOLANA_USDC_MINT") or DEFAULT_DEVNET_USDC_MINT,
        help="USDC SPL Mint Address",
    )
    parser.add_argument("--wallet", help="Candidate wallet pubkey for CandidateProfile / BountyClaim")
    parser.add_argument("--eval-id", help="Evaluation UUID to verify EvaluationRecord PDA")
    parser.add_argument("--job-id", help="Job UUID to verify BountyEscrow + EscrowVault PDAs")
    parser.add_argument("--mint", help="Token-2022 SBT Mint address to verify NonTransferable ownership")
    parser.add_argument("--json", action="store_true", help="Output raw JSON audit report")

    args = parser.parse_args()
    report = asyncio.run(run_audit(args))

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_audit_report(report)

    return 0


if __name__ == "__main__":
    sys.exit(main())
