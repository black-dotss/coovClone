use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::hashv,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
};
use anchor_lang::system_program::{create_account, transfer, CreateAccount, Transfer};
use anchor_spl::associated_token::{
    self, get_associated_token_address_with_program_id, AssociatedToken,
};
use anchor_spl::token_2022::{
    initialize_mint2, mint_to, set_authority, spl_token_2022, InitializeMint2, MintTo,
    SetAuthority, Token2022,
};
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface,
    TransferChecked,
};

declare_id!("FXboyZZ2em2FqXrcr4Uz5nfrHHQ4K1NaJ6kP9VMBJ3Yt");

pub const MAX_SKILLS: usize = 8;
pub const MAX_SKILL_LEN: usize = 24;
pub const MAX_ROLE_TITLE_LEN: usize = 64;
pub const MAX_MODEL_VERSION_LEN: usize = 48;
pub const MAX_SBT_NAME_LEN: usize = 64;
pub const MAX_SBT_SYMBOL_LEN: usize = 12;
pub const MAX_SBT_URI_LEN: usize = 200;
pub const MAX_SCORE_TIER_LEN: usize = 24;
pub const SBT_MIN_SCORE: u8 = 85;
pub const MAX_DEFENSE_BOOST: u8 = 15;
pub const DEFAULT_STAKE_BPS: u16 = 1_000; // 10%
pub const MAX_STAKE_BPS: u16 = 10_000; // 100%
pub const LEGACY_ESCROW_SPACE: usize = 144;
pub const LEGACY_ESCROW_DISC: [u8; 8] = [59, 18, 13, 80, 225, 187, 6, 16];

fn resolve_stake_bps(stake_bps: u16) -> u16 {
    if stake_bps == 0 {
        DEFAULT_STAKE_BPS
    } else {
        stake_bps
    }
}

fn compute_stake_amount(reward_per_winner: u64, stake_bps: u16) -> Result<u64> {
    let bps = resolve_stake_bps(stake_bps);
    require!(bps > 0 && bps <= MAX_STAKE_BPS, CoovError::InvalidStakeBps);
    let amount = ((reward_per_winner as u128)
        .checked_mul(bps as u128)
        .ok_or(CoovError::MathOverflow)?)
        / 10_000u128;
    let amount_u64 = u64::try_from(amount).map_err(|_| CoovError::MathOverflow)?;
    require!(amount_u64 > 0, CoovError::InvalidAmount);
    Ok(amount_u64)
}

#[program]
pub mod coov_protocol {
    use super::*;

    /// One-time initialization of global COOV protocol config.
    /// `oracle_authority` should be the public key of `COOV_ORACLE_PRIVATE_KEY`.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        oracle_authority: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.oracle_authority = oracle_authority;
        config.paused = false;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Admin-only config rotation or emergency pause toggle.
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_oracle_authority: Option<Pubkey>,
        paused: Option<bool>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        if let Some(auth) = new_oracle_authority {
            config.oracle_authority = auth;
        }
        if let Some(is_paused) = paused {
            config.paused = is_paused;
        }
        Ok(())
    }

    /// Feature 1: Initializes the deterministic Candidate Profile PDA
    /// (`seeds = [b"profile", candidate]`).
    /// Prepended atomically in the same transaction on a candidate's first anchor.
    pub fn init_profile(ctx: Context<InitProfile>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let profile = &mut ctx.accounts.profile;
        profile.wallet = ctx.accounts.candidate.key();
        profile.eval_count = 0;
        profile.highest_score = 0;
        profile.top_skills = Vec::new();
        profile.last_role_title = String::new();
        profile.updated_at = now;
        profile.bump = ctx.bumps.profile;

        emit!(ProfileInitialized {
            candidate: profile.wallet,
            timestamp: now,
        });
        Ok(())
    }

    /// Features 1 & 3: Anchors a completed 6-agent LangGraph evaluation on-chain
    /// and updates the candidate's on-chain Profile & Skill Registry.
    /// Co-signed by `candidate` (payer) and `oracle_authority` (COOV backend).
    pub fn record_evaluation(
        ctx: Context<RecordEvaluation>,
        eval_id: [u8; 16],
        job_id: [u8; 16],
        report_hash: [u8; 32],
        composite_score: u8,
        // [hr_recruiter, technical_interviewer, ats_scanner, hiring_manager, career_strategist, red_flag_analyst]
        agent_scores: [u8; 6],
        model_version: String,
        role_title: String,
        verified_skills: Vec<String>,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CoovError::ProtocolPaused);
        require!(composite_score <= 100, CoovError::InvalidScore);
        for s in agent_scores.iter() {
            require!(*s <= 100, CoovError::InvalidScore);
        }
        require!(
            !model_version.is_empty() && model_version.len() <= MAX_MODEL_VERSION_LEN,
            CoovError::StringTooLong
        );
        require!(
            !role_title.is_empty() && role_title.len() <= MAX_ROLE_TITLE_LEN,
            CoovError::StringTooLong
        );
        require!(verified_skills.len() <= MAX_SKILLS, CoovError::TooManySkills);
        for skill in verified_skills.iter() {
            require!(
                !skill.is_empty() && skill.len() <= MAX_SKILL_LEN,
                CoovError::StringTooLong
            );
        }

        let now = Clock::get()?.unix_timestamp;

        // 1. Update Candidate Profile PDA
        let profile = &mut ctx.accounts.profile;
        profile.eval_count = profile
            .eval_count
            .checked_add(1)
            .ok_or(CoovError::MathOverflow)?;
        if composite_score > profile.highest_score {
            profile.highest_score = composite_score;
        }
        if !verified_skills.is_empty() {
            profile.top_skills = verified_skills;
        }
        profile.last_role_title = role_title.clone();
        profile.updated_at = now;

        // 2. Write Evaluation Audit Trail PDA
        let eval_rec = &mut ctx.accounts.evaluation;
        eval_rec.candidate = ctx.accounts.candidate.key();
        eval_rec.eval_id = eval_id;
        eval_rec.job_id = job_id;
        eval_rec.initial_report_hash = report_hash;
        eval_rec.current_report_hash = report_hash;
        eval_rec.initial_score = composite_score;
        eval_rec.composite_score = composite_score;
        eval_rec.agent_scores = agent_scores;
        eval_rec.defense_count = 0;
        eval_rec.sbt_minted = false;
        eval_rec.sbt_mint = Pubkey::default();
        eval_rec.model_version = model_version;
        eval_rec.role_title = role_title;
        eval_rec.created_at = now;
        eval_rec.updated_at = now;
        eval_rec.bump = ctx.bumps.evaluation;

        emit!(EvaluationRecorded {
            candidate: eval_rec.candidate,
            eval_id,
            job_id,
            report_hash,
            composite_score,
            timestamp: now,
        });

        Ok(())
    }

    /// Feature 3 (Defense Reassessment Update): Updates `current_report_hash` and
    /// `composite_score` after `lib/reports/defense.ts` reassessment while preserving
    /// `initial_report_hash`, `initial_score`, `agent_scores`, and `created_at` immutable.
    pub fn update_evaluation_after_defense(
        ctx: Context<UpdateEvaluationAfterDefense>,
        new_report_hash: [u8; 32],
        new_composite_score: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CoovError::ProtocolPaused);
        let eval_rec = &mut ctx.accounts.evaluation;
        let max_allowed = eval_rec
            .initial_score
            .saturating_add(MAX_DEFENSE_BOOST)
            .min(100);
        require!(
            new_composite_score >= eval_rec.composite_score && new_composite_score <= max_allowed,
            CoovError::InvalidDefenseScore
        );

        let now = Clock::get()?.unix_timestamp;
        eval_rec.current_report_hash = new_report_hash;
        eval_rec.composite_score = new_composite_score;
        eval_rec.defense_count = eval_rec
            .defense_count
            .checked_add(1)
            .ok_or(CoovError::MathOverflow)?;
        eval_rec.updated_at = now;

        let profile = &mut ctx.accounts.profile;
        if new_composite_score > profile.highest_score {
            profile.highest_score = new_composite_score;
        }
        profile.updated_at = now;

        emit!(EvaluationDefended {
            candidate: eval_rec.candidate,
            eval_id: eval_rec.eval_id,
            new_report_hash,
            new_composite_score,
            defense_count: eval_rec.defense_count,
            timestamp: now,
        });

        Ok(())
    }

    /// Feature 2: Mints a 1-of-1 Token-2022 Non-Transferable (Soulbound) Credential
    /// with embedded on-chain TokenMetadata (`role_title`, `score_tier`, `report_hash`, `issued_at`).
    /// Allowed once per qualifying evaluation (`composite_score >= 85`).
    pub fn mint_credential(
        ctx: Context<MintCredential>,
        name: String,
        symbol: String,
        uri: String,
        role_title: String,
        score_tier: String,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CoovError::ProtocolPaused);
        require!(
            ctx.accounts.mint.data_is_empty(),
            CoovError::MintAlreadyInitialized
        );
        require!(
            !name.is_empty() && name.len() <= MAX_SBT_NAME_LEN,
            CoovError::StringTooLong
        );
        require!(
            !symbol.is_empty() && symbol.len() <= MAX_SBT_SYMBOL_LEN,
            CoovError::StringTooLong
        );
        require!(uri.len() <= MAX_SBT_URI_LEN, CoovError::StringTooLong);
        require!(
            !role_title.is_empty() && role_title.len() <= MAX_ROLE_TITLE_LEN,
            CoovError::StringTooLong
        );
        require!(
            !score_tier.is_empty() && score_tier.len() <= MAX_SCORE_TIER_LEN,
            CoovError::StringTooLong
        );

        let eval_rec = &ctx.accounts.evaluation;
        require!(!eval_rec.sbt_minted, CoovError::CredentialAlreadyMinted);
        require!(
            eval_rec.composite_score >= SBT_MIN_SCORE,
            CoovError::ScoreBelowThreshold
        );

        let expected_ata = get_associated_token_address_with_program_id(
            &ctx.accounts.candidate.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.token_2022_program.key(),
        );
        require_keys_eq!(
            ctx.accounts.candidate_ata.key(),
            expected_ata,
            CoovError::InvalidTokenAccount
        );

        let now = Clock::get()?.unix_timestamp;
        let report_hash_hex = bytes_to_hex(&eval_rec.current_report_hash);
        let issued_at_str = now.to_string();

        let token_2022_id = ctx.accounts.token_2022_program.key();
        let mint_key = ctx.accounts.mint.key();
        let config_key = ctx.accounts.config.key();
        let config_bump = ctx.accounts.config.bump;

        // 1. Compute base Mint size (NonTransferable + MetadataPointer) + rent for full TokenMetadata TLV
        let base_mint_len = spl_token_2022::extension::ExtensionType::try_calculate_account_len::<
            spl_token_2022::state::Mint,
        >(&[
            spl_token_2022::extension::ExtensionType::NonTransferable,
            spl_token_2022::extension::ExtensionType::MetadataPointer,
        ])?;

        let metadata_tlv_len = 4usize // TLV header
            + 32 + 32               // update_authority + mint
            + (4 + name.len())
            + (4 + symbol.len())
            + (4 + uri.len())
            + 4                     // additional_metadata Vec len
            + (8 + "role_title".len() + role_title.len())
            + (8 + "score_tier".len() + score_tier.len())
            + (8 + "report_hash".len() + report_hash_hex.len())
            + (8 + "issued_at".len() + issued_at_str.len())
            + 32;                   // safety margin

        let mut total_rent_len = base_mint_len + metadata_tlv_len;
        if total_rent_len == 355 {
            total_rent_len = 357;
        }
        let lamports = Rent::get()?.minimum_balance(total_rent_len);

        // 2. Allocate Mint owned by Token-2022 and pre-fund full rent for metadata expansion
        create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.candidate.to_account_info(),
                    to: ctx.accounts.mint.to_account_info(),
                },
            ),
            lamports,
            base_mint_len as u64,
            &token_2022_id,
        )?;

        // 3. Initialize NonTransferable + MetadataPointer extensions BEFORE initialize_mint2
        let non_transferable_ix = spl_token_2022::instruction::initialize_non_transferable_mint(
            &token_2022_id,
            &mint_key,
        )?;
        invoke(
            &non_transferable_ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.token_2022_program.to_account_info(),
            ],
        )?;

        let metadata_ptr_ix =
            spl_token_2022::extension::metadata_pointer::instruction::initialize(
                &token_2022_id,
                &mint_key,
                Some(config_key),
                Some(mint_key),
            )?;
        invoke(
            &metadata_ptr_ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.token_2022_program.to_account_info(),
            ],
        )?;

        // 4. Initialize base Mint (0 decimals, mint authority = config PDA, no freeze authority)
        initialize_mint2(
            CpiContext::new(
                ctx.accounts.token_2022_program.to_account_info(),
                InitializeMint2 {
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            0,
            &config_key,
            None,
        )?;

        let config_seeds: &[&[u8]] = &[b"config", &[config_bump]];
        let signer_seeds: &[&[&[u8]]] = &[config_seeds];

        // 5. Initialize embedded Token-2022 TokenMetadata + custom fields
        let init_meta_ix = build_token_metadata_init_ix(
            &token_2022_id,
            &mint_key,
            &config_key,
            &mint_key,
            &config_key,
            name,
            symbol,
            uri,
        )?;
        invoke_signed(
            &init_meta_ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.config.to_account_info(),
                ctx.accounts.token_2022_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        for (field_key, field_val) in [
            ("role_title", role_title),
            ("score_tier", score_tier),
            ("report_hash", report_hash_hex),
            ("issued_at", issued_at_str),
        ] {
            let update_ix = build_token_metadata_update_key_ix(
                &token_2022_id,
                &mint_key,
                &config_key,
                field_key,
                field_val,
            )?;
            invoke_signed(
                &update_ix,
                &[
                    ctx.accounts.mint.to_account_info(),
                    ctx.accounts.config.to_account_info(),
                    ctx.accounts.token_2022_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        }

        // 6. Create Candidate Token-2022 ATA, mint 1 Soulbound token, and lock supply permanently
        associated_token::create(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            associated_token::Create {
                payer: ctx.accounts.candidate.to_account_info(),
                associated_token: ctx.accounts.candidate_ata.to_account_info(),
                authority: ctx.accounts.candidate.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_2022_program.to_account_info(),
            },
        ))?;

        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_2022_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.candidate_ata.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer_seeds,
            ),
            1,
        )?;

        set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_2022_program.to_account_info(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: ctx.accounts.config.to_account_info(),
                },
                signer_seeds,
            ),
            spl_token_2022::instruction::AuthorityType::MintTokens,
            None,
        )?;

        // 7. Record mint on EvaluationRecord so each evaluation yields at most one SBT
        let eval_mut = &mut ctx.accounts.evaluation;
        eval_mut.sbt_minted = true;
        eval_mut.sbt_mint = mint_key;

        emit!(CredentialMinted {
            candidate: ctx.accounts.candidate.key(),
            eval_id: eval_mut.eval_id,
            mint: mint_key,
            composite_score: eval_mut.composite_score,
            timestamp: now,
        });

        Ok(())
    }

    /// Safely upgrades a legacy 144-byte `BountyEscrow` PDA to the v2 154-byte layout
    /// with default `stake_bps = 1000` (10%) and `slashed_pool_amount = 0`.
    pub fn migrate_escrow(ctx: Context<MigrateEscrow>) -> Result<()> {
        let escrow_info = ctx.accounts.escrow.to_account_info();
        require_keys_eq!(*escrow_info.owner, crate::ID, CoovError::InvalidEscrowAccount);
        require!(
            escrow_info.data_len() == LEGACY_ESCROW_SPACE,
            CoovError::InvalidEscrowAccount
        );

        let (job_id, bump) = {
            let data = escrow_info.try_borrow_data()?;
            require!(&data[0..8] == &LEGACY_ESCROW_DISC, CoovError::InvalidEscrowAccount);
            let mut job_id = [0u8; 16];
            job_id.copy_from_slice(&data[40..56]);
            let bump = data[142];
            (job_id, bump)
        };

        let expected_key = Pubkey::create_program_address(
            &[b"escrow", job_id.as_ref(), &[bump]],
            &crate::ID,
        )
        .map_err(|_| error!(CoovError::InvalidEscrowAccount))?;
        require_keys_eq!(escrow_info.key(), expected_key, CoovError::InvalidEscrowAccount);

        let min_rent = Rent::get()?.minimum_balance(BountyEscrow::SPACE);
        let current_lamports = escrow_info.lamports();
        if min_rent > current_lamports {
            let diff = min_rent
                .checked_sub(current_lamports)
                .ok_or(CoovError::MathOverflow)?;
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: escrow_info.clone(),
                    },
                ),
                diff,
            )?;
        }

        escrow_info.realloc(BountyEscrow::SPACE, false)?;
        let mut data = escrow_info.try_borrow_mut_data()?;
        data[LEGACY_ESCROW_SPACE..LEGACY_ESCROW_SPACE + 2]
            .copy_from_slice(&DEFAULT_STAKE_BPS.to_le_bytes());
        data[LEGACY_ESCROW_SPACE + 2..BountyEscrow::SPACE]
            .copy_from_slice(&0u64.to_le_bytes());

        Ok(())
    }

    /// Feature 4: Recruiter creates & funds a multi-winner USDC bounty escrow pool
    /// (`reward_per_winner * max_winners`) with an `expires_at` deadline and `stake_bps`.
    /// Passing `stake_bps == 0` defaults cleanly to 1,000 bps (10%).
    pub fn create_bounty_escrow(
        ctx: Context<CreateBountyEscrow>,
        job_id: [u8; 16],
        min_score: u8,
        reward_per_winner: u64,
        max_winners: u16,
        expires_at: i64,
        stake_bps: u16,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CoovError::ProtocolPaused);
        require!(min_score > 0 && min_score <= 100, CoovError::InvalidScore);
        require!(reward_per_winner > 0, CoovError::InvalidAmount);
        require!(max_winners > 0, CoovError::InvalidMaxWinners);

        let effective_stake_bps = resolve_stake_bps(stake_bps);
        let _stake_preview = compute_stake_amount(reward_per_winner, effective_stake_bps)?;

        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now, CoovError::InvalidExpiry);

        let total_deposit = reward_per_winner
            .checked_mul(max_winners as u64)
            .ok_or(CoovError::MathOverflow)?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.recruiter_token_account.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.recruiter.to_account_info(),
                },
            ),
            total_deposit,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.recruiter = ctx.accounts.recruiter.key();
        escrow.job_id = job_id;
        escrow.usdc_mint = ctx.accounts.usdc_mint.key();
        escrow.vault = ctx.accounts.vault.key();
        escrow.reward_per_winner = reward_per_winner;
        escrow.max_winners = max_winners;
        escrow.claims_count = 0;
        escrow.min_score = min_score;
        escrow.expires_at = expires_at;
        escrow.is_closed = false;
        escrow.bump = ctx.bumps.escrow;
        escrow.vault_bump = ctx.bumps.vault;
        escrow.stake_bps = effective_stake_bps;
        escrow.slashed_pool_amount = 0;

        emit!(BountyCreated {
            escrow: escrow.key(),
            recruiter: escrow.recruiter,
            job_id,
            usdc_mint: escrow.usdc_mint,
            reward_per_winner,
            max_winners,
            min_score,
            expires_at,
            stake_bps: effective_stake_bps,
        });

        Ok(())
    }

    /// Feature 5 (Anti-Spam Conviction Stake): Candidate locks `(reward_per_winner * stake_bps) / 10_000`
    /// Devnet USDC into the bounty's escrow vault BEFORE entering review.
    pub fn submit_with_conviction_stake(ctx: Context<SubmitWithConvictionStake>) -> Result<()> {
        require!(!ctx.accounts.config.paused, CoovError::ProtocolPaused);
        let now = Clock::get()?.unix_timestamp;

        let escrow = &ctx.accounts.escrow;
        require!(!escrow.is_closed, CoovError::EscrowClosed);
        require!(now <= escrow.expires_at, CoovError::EscrowExpired);
        require!(
            escrow.claims_count < escrow.max_winners,
            CoovError::BountyFullyClaimed
        );

        let amount_staked = compute_stake_amount(escrow.reward_per_winner, escrow.stake_bps)?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.candidate_token_account.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.candidate.to_account_info(),
                },
            ),
            amount_staked,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let stake = &mut ctx.accounts.conviction_stake;
        stake.escrow = escrow.key();
        stake.candidate = ctx.accounts.candidate.key();
        stake.amount_staked = amount_staked;
        stake.status = ConvictionStatus::Pending;
        stake.submitted_at = now;
        stake.resolved_at = 0;
        stake.bump = ctx.bumps.conviction_stake;

        emit!(ConvictionStakeLocked {
            escrow: escrow.key(),
            candidate: stake.candidate,
            stake_pda: stake.key(),
            amount_staked,
            timestamp: now,
        });

        Ok(())
    }

    /// Feature 5 (Recruiter Approval OR 24h Timeout Oracle Auto-Claim):
    /// Transfers `reward_per_winner` + 100% refund of `amount_staked` + pro-rata bonus share
    /// from `slashed_pool_amount` back to the candidate's ATA, and marks ConvictionStake Approved.
    pub fn approve_and_payout(
        ctx: Context<ApproveAndPayout>,
        evaluation_key: Pubkey,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, CoovError::ProtocolPaused);
        let now = Clock::get()?.unix_timestamp;
        let escrow_info = ctx.accounts.escrow.to_account_info();

        let job_id = ctx.accounts.escrow.job_id;
        let bump = ctx.accounts.escrow.bump;
        let reward_per_winner = ctx.accounts.escrow.reward_per_winner;
        let max_winners = ctx.accounts.escrow.max_winners;
        let claims_count = ctx.accounts.escrow.claims_count;
        let expires_at = ctx.accounts.escrow.expires_at;
        let is_closed = ctx.accounts.escrow.is_closed;
        let slashed_pool_amount = ctx.accounts.escrow.slashed_pool_amount;

        require!(!is_closed, CoovError::EscrowClosed);
        require!(now <= expires_at, CoovError::EscrowExpired);
        require!(claims_count < max_winners, CoovError::BountyFullyClaimed);
        require!(
            ctx.accounts.conviction_stake.status == ConvictionStatus::Pending,
            CoovError::StakeAlreadyResolved
        );

        let remaining_slots = (max_winners - claims_count) as u64;
        let bonus_share = slashed_pool_amount
            .checked_div(remaining_slots)
            .unwrap_or(0);
        let stake_refund = ctx.accounts.conviction_stake.amount_staked;

        let total_payout = reward_per_winner
            .checked_add(stake_refund)
            .ok_or(CoovError::MathOverflow)?
            .checked_add(bonus_share)
            .ok_or(CoovError::MathOverflow)?;

        let escrow_seeds: &[&[u8]] = &[b"escrow", job_id.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[escrow_seeds];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.candidate_token_account.to_account_info(),
                    authority: escrow_info,
                },
                signer_seeds,
            ),
            total_payout,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let stake_mut = &mut ctx.accounts.conviction_stake;
        stake_mut.status = ConvictionStatus::Approved;
        stake_mut.resolved_at = now;

        let escrow_mut = &mut ctx.accounts.escrow;
        escrow_mut.slashed_pool_amount = escrow_mut
            .slashed_pool_amount
            .checked_sub(bonus_share)
            .ok_or(CoovError::MathOverflow)?;
        escrow_mut.claims_count = escrow_mut
            .claims_count
            .checked_add(1)
            .ok_or(CoovError::MathOverflow)?;
        if escrow_mut.claims_count >= escrow_mut.max_winners {
            escrow_mut.is_closed = true;
        }

        let receipt = &mut ctx.accounts.claim_receipt;
        receipt.escrow = escrow_mut.key();
        receipt.candidate = ctx.accounts.candidate.key();
        receipt.evaluation = evaluation_key;
        receipt.amount_paid = total_payout;
        receipt.claimed_at = now;
        receipt.bump = ctx.bumps.claim_receipt;

        emit!(ConvictionStakeApproved {
            escrow: escrow_mut.key(),
            candidate: receipt.candidate,
            stake_pda: stake_mut.key(),
            reward_paid: reward_per_winner,
            stake_refunded: stake_refund,
            bonus_share,
            total_paid: total_payout,
            timestamp: now,
        });

        emit!(BountyClaimed {
            escrow: escrow_mut.key(),
            candidate: receipt.candidate,
            evaluation: receipt.evaluation,
            amount_paid: total_payout,
            claims_count: escrow_mut.claims_count,
            timestamp: now,
        });

        Ok(())
    }

    /// Feature 5 (Anti-Fraud Slash): Called by `oracle_authority` or `recruiter` when a
    /// submission fails the Duplicate Resume / Fake Detector gate or is flagged in review.
    /// Keeps `amount_staked` inside the vault, credits `slashed_pool_amount` for honest winners,
    /// frees the winner slot, and marks ConvictionStake Slashed.
    pub fn slash_fraud_stake(ctx: Context<SlashFraudStake>, reason_code: u8) -> Result<()> {
        require!(!ctx.accounts.config.paused, CoovError::ProtocolPaused);
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.escrow.is_closed, CoovError::EscrowClosed);

        let stake = &mut ctx.accounts.conviction_stake;
        require!(
            stake.status == ConvictionStatus::Pending,
            CoovError::StakeAlreadyResolved
        );

        let amount_slashed = stake.amount_staked;
        stake.status = ConvictionStatus::Slashed;
        stake.resolved_at = now;

        let escrow = &mut ctx.accounts.escrow;
        escrow.slashed_pool_amount = escrow
            .slashed_pool_amount
            .checked_add(amount_slashed)
            .ok_or(CoovError::MathOverflow)?;

        emit!(FraudStakeSlashed {
            escrow: escrow.key(),
            candidate: stake.candidate,
            stake_pda: stake.key(),
            amount_slashed,
            slashed_pool_amount: escrow.slashed_pool_amount,
            reason_code,
            timestamp: now,
        });

        Ok(())
    }

    /// Refunds 100% of principal `amount_staked` (0 reward, 0 bonus) back to an honest
    /// candidate whose evaluation was non-fraudulent but did not win (e.g., below min_score,
    /// waitlisted when slots filled, or bounty expired).
    pub fn refund_conviction_stake(ctx: Context<RefundConvictionStake>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let escrow_info = ctx.accounts.escrow.to_account_info();
        let authority_key = ctx.accounts.authority.key();
        let is_oracle = authority_key == ctx.accounts.config.oracle_authority;
        let is_recruiter = authority_key == ctx.accounts.escrow.recruiter;
        let is_candidate_after_close_or_expiry = authority_key == ctx.accounts.candidate.key()
            && (ctx.accounts.escrow.is_closed
                || ctx.accounts.escrow.claims_count >= ctx.accounts.escrow.max_winners
                || now > ctx.accounts.escrow.expires_at);

        require!(
            is_oracle || is_recruiter || is_candidate_after_close_or_expiry,
            CoovError::UnauthorizedAuthority
        );
        require!(
            ctx.accounts.conviction_stake.status == ConvictionStatus::Pending,
            CoovError::StakeAlreadyResolved
        );

        let refund_amount = ctx.accounts.conviction_stake.amount_staked;
        let job_id = ctx.accounts.escrow.job_id;
        let bump = ctx.accounts.escrow.bump;
        let escrow_seeds: &[&[u8]] = &[b"escrow", job_id.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[escrow_seeds];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.candidate_token_account.to_account_info(),
                    authority: escrow_info,
                },
                signer_seeds,
            ),
            refund_amount,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let stake_mut = &mut ctx.accounts.conviction_stake;
        stake_mut.status = ConvictionStatus::Refunded;
        stake_mut.resolved_at = now;

        emit!(ConvictionStakeRefunded {
            escrow: ctx.accounts.escrow.key(),
            candidate: stake_mut.candidate,
            stake_pda: stake_mut.key(),
            amount_refunded: refund_amount,
            timestamp: now,
        });

        Ok(())
    }

    /// Feature 4: Trustless bounty claim. Any candidate with an on-chain `EvaluationRecord`
    /// matching `escrow.job_id` and `composite_score >= escrow.min_score` claims their
    /// `reward_per_winner` USDC payout directly without needing an off-chain oracle signature.
    pub fn claim_bounty(ctx: Context<ClaimBounty>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let escrow_info = ctx.accounts.escrow.to_account_info();

        let job_id = ctx.accounts.escrow.job_id;
        let bump = ctx.accounts.escrow.bump;
        let reward_per_winner = ctx.accounts.escrow.reward_per_winner;
        let max_winners = ctx.accounts.escrow.max_winners;
        let claims_count = ctx.accounts.escrow.claims_count;
        let min_score = ctx.accounts.escrow.min_score;
        let expires_at = ctx.accounts.escrow.expires_at;
        let is_closed = ctx.accounts.escrow.is_closed;

        require!(!is_closed, CoovError::EscrowClosed);
        require!(now <= expires_at, CoovError::EscrowExpired);
        require!(claims_count < max_winners, CoovError::BountyFullyClaimed);

        let eval_rec = &ctx.accounts.evaluation;
        require!(eval_rec.job_id == job_id, CoovError::JobMismatch);
        require!(
            eval_rec.composite_score >= min_score,
            CoovError::ScoreBelowBountyThreshold
        );

        let escrow_seeds: &[&[u8]] = &[b"escrow", job_id.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[escrow_seeds];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.candidate_token_account.to_account_info(),
                    authority: escrow_info,
                },
                signer_seeds,
            ),
            reward_per_winner,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let escrow_mut = &mut ctx.accounts.escrow;
        escrow_mut.claims_count = escrow_mut
            .claims_count
            .checked_add(1)
            .ok_or(CoovError::MathOverflow)?;
        if escrow_mut.claims_count >= escrow_mut.max_winners {
            escrow_mut.is_closed = true;
        }

        let receipt = &mut ctx.accounts.claim_receipt;
        receipt.escrow = escrow_mut.key();
        receipt.candidate = ctx.accounts.candidate.key();
        receipt.evaluation = eval_rec.key();
        receipt.amount_paid = reward_per_winner;
        receipt.claimed_at = now;
        receipt.bump = ctx.bumps.claim_receipt;

        emit!(BountyClaimed {
            escrow: escrow_mut.key(),
            candidate: receipt.candidate,
            evaluation: receipt.evaluation,
            amount_paid: reward_per_winner,
            claims_count: escrow_mut.claims_count,
            timestamp: now,
        });

        Ok(())
    }

    /// Feature 4: Recruiter reclaims all remaining unclaimed USDC and closes the vault
    /// once `expires_at` has passed.
    pub fn withdraw_expired_escrow(ctx: Context<WithdrawExpiredEscrow>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let escrow_info = ctx.accounts.escrow.to_account_info();

        let job_id = ctx.accounts.escrow.job_id;
        let bump = ctx.accounts.escrow.bump;
        let expires_at = ctx.accounts.escrow.expires_at;
        let is_closed = ctx.accounts.escrow.is_closed;

        require!(!is_closed, CoovError::EscrowClosed);
        require!(now > expires_at, CoovError::EscrowNotExpired);

        let remaining_amount = ctx.accounts.vault.amount;
        let escrow_seeds: &[&[u8]] = &[b"escrow", job_id.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[escrow_seeds];

        if remaining_amount > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.usdc_mint.to_account_info(),
                        to: ctx.accounts.recruiter_token_account.to_account_info(),
                        authority: escrow_info.clone(),
                    },
                    signer_seeds,
                ),
                remaining_amount,
                ctx.accounts.usdc_mint.decimals,
            )?;
        }

        close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.recruiter.to_account_info(),
                authority: escrow_info,
            },
            signer_seeds,
        ))?;

        let escrow_mut = &mut ctx.accounts.escrow;
        escrow_mut.is_closed = true;

        emit!(BountyWithdrawn {
            escrow: escrow_mut.key(),
            recruiter: ctx.accounts.recruiter.key(),
            amount_returned: remaining_amount,
            timestamp: now,
        });

        Ok(())
    }
}

// ============================================================================
// Helpers: SPL Token Metadata Interface CPI Builders (Zero External Crates)
// ============================================================================

fn bytes_to_hex(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for &b in bytes.iter() {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn build_token_metadata_init_ix(
    token_program_id: &Pubkey,
    metadata: &Pubkey,
    update_authority: &Pubkey,
    mint: &Pubkey,
    mint_authority: &Pubkey,
    name: String,
    symbol: String,
    uri: String,
) -> Result<Instruction> {
    let disc = hashv(&[b"spl_token_metadata_interface:initialize_account"]).to_bytes();
    let mut data = Vec::with_capacity(8 + 12 + name.len() + symbol.len() + uri.len());
    data.extend_from_slice(&disc[..8]);
    name.serialize(&mut data)?;
    symbol.serialize(&mut data)?;
    uri.serialize(&mut data)?;

    Ok(Instruction {
        program_id: *token_program_id,
        accounts: vec![
            AccountMeta::new(*metadata, false),
            AccountMeta::new_readonly(*update_authority, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(*mint_authority, true),
        ],
        data,
    })
}

fn build_token_metadata_update_key_ix(
    token_program_id: &Pubkey,
    metadata: &Pubkey,
    update_authority: &Pubkey,
    key: &str,
    value: String,
) -> Result<Instruction> {
    let disc = hashv(&[b"spl_token_metadata_interface:updating_field"]).to_bytes();
    let mut data = Vec::with_capacity(8 + 1 + 8 + key.len() + value.len());
    data.extend_from_slice(&disc[..8]);
    data.push(3u8); // Field::Key variant index
    key.to_string().serialize(&mut data)?;
    value.serialize(&mut data)?;

    Ok(Instruction {
        program_id: *token_program_id,
        accounts: vec![
            AccountMeta::new(*metadata, false),
            AccountMeta::new_readonly(*update_authority, true),
        ],
        data,
    })
}

// ============================================================================
// Account Contexts
// ============================================================================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = ProgramConfig::SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin
    )]
    pub config: Box<Account<'info, ProgramConfig>>,
}

#[derive(Accounts)]
pub struct InitProfile<'info> {
    #[account(mut)]
    pub candidate: Signer<'info>,

    #[account(
        init,
        payer = candidate,
        space = CandidateProfile::SPACE,
        seeds = [b"profile", candidate.key().as_ref()],
        bump
    )]
    pub profile: Box<Account<'info, CandidateProfile>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(eval_id: [u8; 16])]
pub struct RecordEvaluation<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = oracle_authority
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    pub oracle_authority: Signer<'info>,

    #[account(mut)]
    pub candidate: Signer<'info>,

    #[account(
        mut,
        seeds = [b"profile", candidate.key().as_ref()],
        bump = profile.bump,
        constraint = profile.wallet == candidate.key() @ CoovError::UnauthorizedCandidate
    )]
    pub profile: Box<Account<'info, CandidateProfile>>,

    #[account(
        init,
        payer = candidate,
        space = EvaluationRecord::SPACE,
        seeds = [b"eval", candidate.key().as_ref(), eval_id.as_ref()],
        bump
    )]
    pub evaluation: Box<Account<'info, EvaluationRecord>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateEvaluationAfterDefense<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = oracle_authority
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    pub oracle_authority: Signer<'info>,

    pub candidate: Signer<'info>,

    #[account(
        mut,
        seeds = [b"profile", candidate.key().as_ref()],
        bump = profile.bump,
        constraint = profile.wallet == candidate.key() @ CoovError::UnauthorizedCandidate
    )]
    pub profile: Box<Account<'info, CandidateProfile>>,

    #[account(
        mut,
        seeds = [b"eval", candidate.key().as_ref(), evaluation.eval_id.as_ref()],
        bump = evaluation.bump,
        has_one = candidate
    )]
    pub evaluation: Box<Account<'info, EvaluationRecord>>,
}

#[derive(Accounts)]
pub struct MintCredential<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = oracle_authority
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    pub oracle_authority: Signer<'info>,

    #[account(mut)]
    pub candidate: Signer<'info>,

    #[account(
        mut,
        seeds = [b"eval", candidate.key().as_ref(), evaluation.eval_id.as_ref()],
        bump = evaluation.bump,
        has_one = candidate
    )]
    pub evaluation: Box<Account<'info, EvaluationRecord>>,

    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: Verified via `get_associated_token_address_with_program_id` and initialized via ATA CPI.
    #[account(mut)]
    pub candidate_ata: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateEscrow<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Verified owner == crate::ID, discriminator == BountyEscrow, and len == 144 bytes.
    #[account(mut)]
    pub escrow: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: [u8; 16])]
pub struct CreateBountyEscrow<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    #[account(mut)]
    pub recruiter: Signer<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = recruiter,
        token::token_program = token_program
    )]
    pub recruiter_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = recruiter,
        space = BountyEscrow::SPACE,
        seeds = [b"escrow", job_id.as_ref()],
        bump
    )]
    pub escrow: Box<Account<'info, BountyEscrow>>,

    #[account(
        init,
        payer = recruiter,
        seeds = [b"escrow_vault", escrow.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = escrow,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitWithConvictionStake<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    #[account(mut)]
    pub candidate: Signer<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.job_id.as_ref()],
        bump = escrow.bump,
        has_one = usdc_mint,
        has_one = vault
    )]
    pub escrow: Box<Account<'info, BountyEscrow>>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = candidate,
        token::token_program = token_program
    )]
    pub candidate_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = candidate,
        space = ConvictionStake::SPACE,
        seeds = [b"conviction_stake", escrow.key().as_ref(), candidate.key().as_ref()],
        bump
    )]
    pub conviction_stake: Box<Account<'info, ConvictionStake>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveAndPayout<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        constraint = authority.key() == escrow.recruiter || authority.key() == config.oracle_authority @ CoovError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,

    /// CHECK: Candidate wallet verified against conviction_stake and ATA authority
    pub candidate: UncheckedAccount<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.job_id.as_ref()],
        bump = escrow.bump,
        has_one = usdc_mint,
        has_one = vault
    )]
    pub escrow: Box<Account<'info, BountyEscrow>>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = candidate,
        token::token_program = token_program
    )]
    pub candidate_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"conviction_stake", escrow.key().as_ref(), candidate.key().as_ref()],
        bump = conviction_stake.bump,
        has_one = escrow,
        has_one = candidate
    )]
    pub conviction_stake: Box<Account<'info, ConvictionStake>>,

    #[account(
        init,
        payer = payer,
        space = BountyClaim::SPACE,
        seeds = [b"claim", escrow.key().as_ref(), candidate.key().as_ref()],
        bump
    )]
    pub claim_receipt: Box<Account<'info, BountyClaim>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashFraudStake<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    #[account(
        constraint = authority.key() == escrow.recruiter || authority.key() == config.oracle_authority @ CoovError::UnauthorizedAuthority
    )]
    pub authority: Signer<'info>,

    /// CHECK: Candidate wallet verified against conviction_stake has_one and PDA seeds
    pub candidate: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.job_id.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Box<Account<'info, BountyEscrow>>,

    #[account(
        mut,
        seeds = [b"conviction_stake", escrow.key().as_ref(), candidate.key().as_ref()],
        bump = conviction_stake.bump,
        has_one = escrow,
        has_one = candidate
    )]
    pub conviction_stake: Box<Account<'info, ConvictionStake>>,
}

#[derive(Accounts)]
pub struct RefundConvictionStake<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Box<Account<'info, ProgramConfig>>,

    pub authority: Signer<'info>,

    /// CHECK: Candidate wallet verified against conviction_stake and ATA authority
    pub candidate: UncheckedAccount<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.job_id.as_ref()],
        bump = escrow.bump,
        has_one = usdc_mint,
        has_one = vault
    )]
    pub escrow: Box<Account<'info, BountyEscrow>>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = candidate,
        token::token_program = token_program
    )]
    pub candidate_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"conviction_stake", escrow.key().as_ref(), candidate.key().as_ref()],
        bump = conviction_stake.bump,
        has_one = escrow,
        has_one = candidate
    )]
    pub conviction_stake: Box<Account<'info, ConvictionStake>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimBounty<'info> {
    #[account(mut)]
    pub candidate: Signer<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.job_id.as_ref()],
        bump = escrow.bump,
        has_one = usdc_mint,
        has_one = vault
    )]
    pub escrow: Box<Account<'info, BountyEscrow>>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = candidate,
        token::token_program = token_program
    )]
    pub candidate_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"eval", candidate.key().as_ref(), evaluation.eval_id.as_ref()],
        bump = evaluation.bump,
        has_one = candidate
    )]
    pub evaluation: Box<Account<'info, EvaluationRecord>>,

    #[account(
        init,
        payer = candidate,
        space = BountyClaim::SPACE,
        seeds = [b"claim", escrow.key().as_ref(), candidate.key().as_ref()],
        bump
    )]
    pub claim_receipt: Box<Account<'info, BountyClaim>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawExpiredEscrow<'info> {
    #[account(mut)]
    pub recruiter: Signer<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.job_id.as_ref()],
        bump = escrow.bump,
        has_one = recruiter,
        has_one = usdc_mint,
        has_one = vault
    )]
    pub escrow: Box<Account<'info, BountyEscrow>>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = recruiter,
        token::token_program = token_program
    )]
    pub recruiter_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

// ============================================================================
// State Accounts
// ============================================================================

#[account]
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub oracle_authority: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

impl ProgramConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 1;
}

#[account]
pub struct CandidateProfile {
    pub wallet: Pubkey,
    pub eval_count: u32,
    pub highest_score: u8,
    pub top_skills: Vec<String>,
    pub last_role_title: String,
    pub updated_at: i64,
    pub bump: u8,
}

impl CandidateProfile {
    pub const SPACE: usize =
        8 + 32 + 4 + 1 + (4 + MAX_SKILLS * (4 + MAX_SKILL_LEN)) + (4 + MAX_ROLE_TITLE_LEN) + 8 + 1;
}

#[account]
pub struct EvaluationRecord {
    pub candidate: Pubkey,
    pub eval_id: [u8; 16],
    pub job_id: [u8; 16],
    pub initial_report_hash: [u8; 32],
    pub current_report_hash: [u8; 32],
    pub initial_score: u8,
    pub composite_score: u8,
    pub agent_scores: [u8; 6],
    pub defense_count: u8,
    pub sbt_minted: bool,
    pub sbt_mint: Pubkey,
    pub model_version: String,
    pub role_title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl EvaluationRecord {
    pub const SPACE: usize = 8
        + 32
        + 16
        + 16
        + 32
        + 32
        + 1
        + 1
        + 6
        + 1
        + 1
        + 32
        + (4 + MAX_MODEL_VERSION_LEN)
        + (4 + MAX_ROLE_TITLE_LEN)
        + 8
        + 8
        + 1;
}

#[account]
pub struct BountyEscrow {
    pub recruiter: Pubkey,
    pub job_id: [u8; 16],
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub reward_per_winner: u64,
    pub max_winners: u16,
    pub claims_count: u16,
    pub min_score: u8,
    pub expires_at: i64,
    pub is_closed: bool,
    pub bump: u8,
    pub vault_bump: u8,
    pub stake_bps: u16,
    pub slashed_pool_amount: u64,
}

impl BountyEscrow {
    pub const SPACE: usize = 8 + 32 + 16 + 32 + 32 + 8 + 2 + 2 + 1 + 8 + 1 + 1 + 1 + 2 + 8; // 154
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConvictionStatus {
    Pending,
    Approved,
    Slashed,
    Refunded,
}

#[account]
pub struct ConvictionStake {
    pub escrow: Pubkey,
    pub candidate: Pubkey,
    pub amount_staked: u64,
    pub status: ConvictionStatus,
    pub submitted_at: i64,
    pub resolved_at: i64,
    pub bump: u8,
}

impl ConvictionStake {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 8 + 8 + 1; // 98
}

#[account]
pub struct BountyClaim {
    pub escrow: Pubkey,
    pub candidate: Pubkey,
    pub evaluation: Pubkey,
    pub amount_paid: u64,
    pub claimed_at: i64,
    pub bump: u8,
}

impl BountyClaim {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
}

// ============================================================================
// Events & Errors
// ============================================================================

#[event]
pub struct ProfileInitialized {
    pub candidate: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EvaluationRecorded {
    pub candidate: Pubkey,
    pub eval_id: [u8; 16],
    pub job_id: [u8; 16],
    pub report_hash: [u8; 32],
    pub composite_score: u8,
    pub timestamp: i64,
}

#[event]
pub struct EvaluationDefended {
    pub candidate: Pubkey,
    pub eval_id: [u8; 16],
    pub new_report_hash: [u8; 32],
    pub new_composite_score: u8,
    pub defense_count: u8,
    pub timestamp: i64,
}

#[event]
pub struct CredentialMinted {
    pub candidate: Pubkey,
    pub eval_id: [u8; 16],
    pub mint: Pubkey,
    pub composite_score: u8,
    pub timestamp: i64,
}

#[event]
pub struct BountyCreated {
    pub escrow: Pubkey,
    pub recruiter: Pubkey,
    pub job_id: [u8; 16],
    pub usdc_mint: Pubkey,
    pub reward_per_winner: u64,
    pub max_winners: u16,
    pub min_score: u8,
    pub expires_at: i64,
    pub stake_bps: u16,
}

#[event]
pub struct ConvictionStakeLocked {
    pub escrow: Pubkey,
    pub candidate: Pubkey,
    pub stake_pda: Pubkey,
    pub amount_staked: u64,
    pub timestamp: i64,
}

#[event]
pub struct ConvictionStakeApproved {
    pub escrow: Pubkey,
    pub candidate: Pubkey,
    pub stake_pda: Pubkey,
    pub reward_paid: u64,
    pub stake_refunded: u64,
    pub bonus_share: u64,
    pub total_paid: u64,
    pub timestamp: i64,
}

#[event]
pub struct FraudStakeSlashed {
    pub escrow: Pubkey,
    pub candidate: Pubkey,
    pub stake_pda: Pubkey,
    pub amount_slashed: u64,
    pub slashed_pool_amount: u64,
    pub reason_code: u8,
    pub timestamp: i64,
}

#[event]
pub struct ConvictionStakeRefunded {
    pub escrow: Pubkey,
    pub candidate: Pubkey,
    pub stake_pda: Pubkey,
    pub amount_refunded: u64,
    pub timestamp: i64,
}

#[event]
pub struct BountyClaimed {
    pub escrow: Pubkey,
    pub candidate: Pubkey,
    pub evaluation: Pubkey,
    pub amount_paid: u64,
    pub claims_count: u16,
    pub timestamp: i64,
}

#[event]
pub struct BountyWithdrawn {
    pub escrow: Pubkey,
    pub recruiter: Pubkey,
    pub amount_returned: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum CoovError {
    #[msg("COOV protocol is currently paused")]
    ProtocolPaused,
    #[msg("Score must be between 0 and 100")]
    InvalidScore,
    #[msg("Defense score must be >= current score and at most +15 above initial score")]
    InvalidDefenseScore,
    #[msg("Input string is empty or exceeds maximum byte length")]
    StringTooLong,
    #[msg("Exceeds maximum of 8 verified skills")]
    TooManySkills,
    #[msg("Candidate does not match profile wallet")]
    UnauthorizedCandidate,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Mint account is already initialized")]
    MintAlreadyInitialized,
    #[msg("Soulbound credential was already minted for this evaluation")]
    CredentialAlreadyMinted,
    #[msg("Candidate composite score must be >= 85 to mint credential")]
    ScoreBelowThreshold,
    #[msg("Provided ATA does not match derived Token-2022 ATA")]
    InvalidTokenAccount,
    #[msg("Reward or stake amount must be greater than zero")]
    InvalidAmount,
    #[msg("Max winners must be greater than zero")]
    InvalidMaxWinners,
    #[msg("Escrow expiration must be in the future")]
    InvalidExpiry,
    #[msg("Bounty escrow is already closed")]
    EscrowClosed,
    #[msg("Bounty escrow has expired")]
    EscrowExpired,
    #[msg("Bounty escrow has not expired yet")]
    EscrowNotExpired,
    #[msg("All bounty winner slots have been claimed")]
    BountyFullyClaimed,
    #[msg("Evaluation job_id does not match this bounty escrow")]
    JobMismatch,
    #[msg("Evaluation composite score does not meet bounty min_score")]
    ScoreBelowBountyThreshold,
    #[msg("Stake basis points must be between 1 and 10,000")]
    InvalidStakeBps,
    #[msg("Conviction stake has already been approved, slashed, or refunded")]
    StakeAlreadyResolved,
    #[msg("Signer is not authorized as recruiter, oracle, or expired-stake owner")]
    UnauthorizedAuthority,
    #[msg("Escrow account is not a valid legacy 144-byte BountyEscrow PDA")]
    InvalidEscrowAccount,
}
