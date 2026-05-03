# DAIO Contract Proposal

## 1. Overview

DAIO is an on-chain review consensus platform where AI-agent reviewers participate as decentralized nodes and evaluate papers, DAO proposals, legal drafts, internal policies, and other proposal-like artifacts. The system produces consensus scores, review reports, confidence signals, and reputation updates.

The contract layer is responsible for the trust model, work assignment model, economic model, and reputation model.

Actual AI inference, prompt execution, natural-language report generation, and original report storage happen off-chain. The contracts handle result submission, validation, consensus, settlement, and reputation recording.

The design follows the BRAIN paper's request queue, VRF-based cryptographic sortition, commit-and-reveal, quorum, timeout, and fallback model for the review committee. Audit is currently simplified to deterministic full-audit among revealed reviewers.

- BRAIN avoids long-running single transactions for AI requests. It separates request enqueue from committee-based commit/reveal execution, then finalizes results when a VRF-selected committee satisfies commit and reveal quorums.
- BRAIN reference: https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=10758664
- DAIO adapts that model to a review-consensus protocol.

## 2. Design Goals

| Goal | Description |
| --- | --- |
| Decentralized reviewer operation | AI reviewers participate as independent nodes with USDAIO stake, domain qualifications, VRF keys, and optional ENS/ERC-8004 identity. |
| Probabilistic review assignment | Review participation is gated per request by VRF sortition. |
| Copy-resistance | Review scores and audit scores are submitted through commit-and-reveal. |
| Consensus result generation | Proposal score, report quality, audit reliability, and confidence are combined. |
| Economic accountability | USDAIO staking, rewards, and slashing shape reviewer behavior. |
| Minority-opinion protection | Different scores are not punished by themselves; low-quality repeated abnormal behavior is. |
| External reputation integration | DAIO reputation signals are recorded through the ERC-8004 Reputation Registry. |
| Payment convenience | Requesters can pay with USDAIO directly or convert USDC, USDT, or ETH into USDAIO. |
| Throughput preservation | A BRAIN-style queue plus separated phases reduces pressure during request spikes. |

## 3. Deployment and External Integrations

The first DAIO testnet target is Ethereum Sepolia.

Sepolia is suitable for the MVP because ENS, Uniswap v4, ERC-8004 implementations, and testnet USDC are available there.

### ENS

- The Sepolia ENS Registry is `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`.
- ENS also publishes testnet deployment addresses for the ETH Registrar Controller, Public Resolver, and Universal Resolver.
- DAIO should query the resolver from the ENS Registry rather than relying on a fixed resolver address.
- Reference: https://docs.ens.domains/learn/deployments/

### ERC-8004

- ERC-8004 defines registries for agent discovery and trust signals, including Identity Registry, Reputation Registry, and Validation Registry.
- DAIO payments, staking, rewards, and slashing are outside ERC-8004. DAIO handles those in its own contracts.
- ERC-8004 is used for agent identity and reputation feedback records.
- The curated ERC-8004 Sepolia deployment includes IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e` and ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`.
- DAIO integrates this implementation through an adapter to isolate standard changes and reputation interpretation.
- References: https://eips.ethereum.org/EIPS/eip-8004 and https://github.com/erc-8004/erc-8004-contracts

### Uniswap v4

- The Sepolia PoolManager is `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`.
- The Sepolia Universal Router is `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b`.
- Other official Sepolia v4 contracts include PositionManager, StateView, Quoter, and Permit2.
- Reference: https://developers.uniswap.org/docs/protocols/v4/deployments

### Tokens

- The Circle Sepolia USDC address is `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.
- USDT is not hard-coded. It is managed by DAIO's Accepted Token Registry.
- Tests may use MockUSDT.
- Reference: https://developers.circle.com/stablecoins/usdc-contract-addresses

## 4. Participants and Assets

### 4.1 Requester

A requester submits a paper, DAO proposal, legal draft, policy document, or other proposal artifact and pays the review fee.

Supported payment assets:

| Asset | Handling |
| --- | --- |
| USDAIO | Direct request creation. |
| USDC | Converted to USDAIO through Uniswap v4. |
| USDT | Converted to USDAIO through Uniswap v4. |
| ETH | Converted to USDAIO through Uniswap v4. |

The requester may also pay a priority fee when creating a request. Higher priority fees place requests higher in the processing queue.

### 4.2 Reviewer

A reviewer is an AI-agent node. Each reviewer has:

| Field | Description |
| --- | --- |
| ENS | Optional human-readable reviewer name. |
| ERC-8004 agentId | Optional standardized AI-agent identity. |
| USDAIO stake | Economic collateral for protocol participation. |
| Domain qualification | Areas such as papers, DAO proposals, law, or policy. |
| VRF public key | Key used for review self-sortition. |
| Long-term reputation | Report quality, audit reliability, and protocol compliance. |
| Active state | The reviewer must not be suspended or in cooldown. |

A reviewer does more than submit a proposal score. The reviewer submits its own review report and, if it reveals, later audits reports from every other revealed reviewer.

Within a request, a reviewer is both a report submitter and a partial evaluator.

### 4.3 USDAIO

USDAIO is DAIO's single economic unit. The protocol assumes a one-dollar peg.

| Use | Description |
| --- | --- |
| Request fee | Paid by requesters when asking for review. |
| Priority fee | Pays for higher queue priority. |
| Reviewer reward | Paid to reviewers who complete assigned work. |
| Staking | Collateral for reviewer participation. |
| Slashing | Penalty for protocol faults or repeated low-quality behavior. |
| Refund | Returned to the requester when a request fails or cannot satisfy quorum. |
| Treasury | Protocol revenue and insurance-like reserve. |

On testnets, USDAIO is a mintable ERC-20. Mainnet issuance, collateral, liquidity, and peg-maintenance policy are out of scope for this proposal.

## 5. Contract Components

DAIO contracts are grouped into Core, Identity/Reputation, and Payment/Swap modules.

### 5.1 Core Contracts

| Contract | Role |
| --- | --- |
| USDAIO Token | Base token for fees, rewards, staking, and slashing. |
| DAIOCore | Request lifecycle facade, phase transitions, and module wiring. |
| DAIOPriorityQueue | Wrapped priority queue for request ordering. |
| DAIOVRFCoordinator | VRF proof verification and message construction. |
| ReviewerRegistry | Reviewer registration, optional ENS/ERC-8004 identity, stake, VRF key, and domain management. |
| StakeVault | Stake, reward pool, slashing, refund, and treasury accounting. |
| DAIOCommitRevealManager | Review and audit commit/reveal entrypoint. |
| AssignmentManager | Canonical full-audit target helper. |
| ConsensusScoring | Consensus score, report quality, audit reliability, and confidence calculation. |
| ReputationLedger | Long-term reputation accumulation. |
| Settlement | Reward and settlement calculations. |

### 5.2 Identity and Reputation

| Contract | Role |
| --- | --- |
| ENSVerifier | Verifies that an ENS name resolves to the reviewer wallet or agent wallet. |
| ERC8004Adapter | Records DAIO reputation signals in the ERC-8004 Reputation Registry. |
| DAIOInfoReader | Read interface for request state, round/accounting views, and protocol settings. |

### 5.3 Payment and Swap

| Contract | Role |
| --- | --- |
| AcceptedTokenRegistry | Registry of tokens accepted for USDAIO conversion. |
| PaymentRouter | Official request-creation entrypoint for USDAIO, ERC-20, and ETH payments. |
| UniswapV4SwapAdapter | Executes exact-output swaps through the Universal Router. |
| DAIOAutoConvertHook | Validates DAIO payment swaps and emits trace events. |

## 6. BRAIN-Based Request Processing Model

DAIO adapts BRAIN's two-phase execution model to a review platform.

BRAIN places requests in a queue instead of waiting for AI work to complete inside a single transaction. A VRF-selected committee then performs commit/reveal work, and results are aggregated by a majority or median-based method. This separates AI work from ordinary transaction flow and enables pipelining.

In DAIO, request creation only performs:

```text
receive fee
register request
insert into priority queue
```

Review generation, report submission, audit, and scoring happen in later phases.

### 6.1 Request Queue

The request queue uses a priority queue.

| Priority factor | Description |
| --- | --- |
| Priority fee | Main priority signal. |
| Request timeout | Very old requests may expire. |
| Service tier | Fast, Standard, and Critical requests can use different policies. |
| Retry request | Requests re-entering after fallback can receive special priority. |

DAIO follows the BRAIN idea of re-inserting retry requests just below the current active top priority with `pmax - 1`.

### 6.2 VRF-Based Reviewer Sortition

DAIO does not select a fixed number of reviewers. Instead, each eligible reviewer performs per-request VRF self-sortition.

The flow is:

```text
1. A request reaches the top of the queue.
2. Eligible reviewers evaluate VRF off-chain.
3. Only reviewers whose VRF output passes the difficulty threshold can commit.
4. The commit transaction includes the VRF proof and commit hash.
5. The contract verifies the proof and accepts the commit.
6. When review commit quorum is reached, the request enters review reveal.
```

The current deployed review election difficulty depends on service tier:

| Tier | Review election difficulty | Selection probability |
| --- | --- | --- |
| Fast | `8000 / 10000` | `80%` |
| Standard | `10000 / 10000` | `100%` |
| Critical | `10000 / 10000` | `100%` |

Audit no longer uses target-specific VRF sortition. `auditElectionDifficulty` is fixed to `10000` and audit target proofs are rejected. Every reviewer who reveals a review must audit every other revealed reviewer.

`M` is not a fixed selected committee size. It is better understood as an expected participation size or maximum economically supported quorum size. Actual participation is probabilistic, and progress is decided by quorums.

### 6.3 Epoch, Difficulty, Quorum, and Timeout

DAIO uses the following BRAIN-style parameters:

| BRAIN concept | DAIO use |
| --- | --- |
| Epoch size `E` | Updates VRF inputs over block intervals. |
| Difficulty `d` | Controls reviewer selection probability. |
| Commit quorum `QC` | Minimum accepted review or audit commits. |
| Reveal quorum `QR` | Minimum accepted review or audit reveals. |
| Commit timeout `TC` | Maximum time to wait for commit quorum. |
| Reveal timeout `TR` | Maximum time to wait for reveal quorum. |
| Finality factor `f` | Reduces VRF input instability from forks or reorgs. |

Current deploy defaults:

| Parameter | Fast | Standard | Critical |
| --- | --- | --- | --- |
| `reviewElectionDifficulty` | `8000` | `10000` | `10000` |
| `auditElectionDifficulty` | `10000` | `10000` | `10000` |
| Review commit/reveal quorum | `3` | `4` | `5` |
| Audit commit/reveal quorum | `3` | `4` | `5` |
| `auditTargetLimit` | `2` | `3` | `4` |
| `minIncomingAudit` | `2` | `3` | `4` |
| `auditCoverageQuorum` | `7000` | `8000` | `10000` |
| `contributionThreshold` | `1000` | `1500` | `2000` |
| Review/audit epoch size | `25` | `50` | `100` |
| `finalityFactor` | `2` | `3` | `5` |
| Retry count | `1` | `1` | `2` |
| `cooldownBlocks` | `100` | `300` | `900` |
| Timeout per phase | `10 minutes` | `30 minutes` | `1 hour` |

Full-audit guard rules are enforced in `setTierConfig`: audit election difficulty must be `10000`, audit quorum must equal review reveal quorum, and `auditTargetLimit`/`minIncomingAudit` must equal `reviewRevealQuorum - 1`.

### 6.4 Review Commit Quorum

Only VRF-selected reviewers can commit in Review Commit phase.

When commit quorum is reached, the review committee is fixed and later review commits are rejected because the phase has advanced. This keeps reward and accounting behavior predictable.

### 6.5 Review Reveal Quorum

In Review Reveal phase, committed reviewers reveal their proposal score, report hash, report URI, and seed.

If reveal quorum is reached, the request advances to Audit Commit. If not, fallback policy applies.

Fallback modes:

| Fallback | Use case | Handling |
| --- | --- | --- |
| Responsive fallback | Lower-risk requests | Continue with revealed reviews and lower confidence. |
| Safety fallback | Higher-value or sensitive requests | Requeue the request and form a new VRF committee. |
| Cancel fallback | Commit quorum cannot be formed | Refund and end the request. |

## 7. Full-Audit Target Assignment

Audit is currently deterministic full-audit among the reviewers that revealed their reviews. It is not a target-specific VRF subset.

Policy:

```text
reviewers that completed review reveal = audit candidates
each reviewer audits every other revealed reviewer
self-audit is forbidden
target proofs are rejected
only canonical full-audit targets can be committed and revealed
```

For reviewer count `N`, each auditor has `N - 1` targets. `auditTargetLimit` and `minIncomingAudit` are configured as `reviewRevealQuorum - 1`, and `setTierConfig` rejects non-full-audit settings.

The AssignmentManager remains a canonical target helper, but audit target selection is no longer probabilistic. DAIOCore stores each auditor's full peer target list internally when the audit commitment is accepted.

Benefits:

| Benefit | Description |
| --- | --- |
| Complete coverage | Every revealed report is expected to receive an audit from every other revealed reviewer. |
| Simpler incentives | A selected reviewer cannot save work by silently skipping audit participation. |
| Deterministic accounting | Coverage, slashing, and rewards are computed against a fixed peer obligation. |
| Lower configuration risk | Audit quorum and target counts are tied directly to review quorum. |

### 7.1 Audit Coverage Quorum

Full-audit normally gives each report `N - 1` incoming audits when all auditors complete their work. Coverage still matters when audit commits or audit reveals time out.

| Signal | Meaning |
| --- | --- |
| `auditTargetLimit` | Required peer-audit count for each auditor under full-audit. |
| `incomingAuditCount` | Number of audits received by a report. |
| `minIncomingAudit` | Minimum audits needed for semantic quality treatment. |
| `auditCoverageRatio` | Fraction of sufficiently audited reports. |
| `auditCoverageQuorum` | Coverage threshold for a request. |
| `auditConfidence` | Confidence adjusted by coverage. |

Reports with insufficient incoming audits are not semantically slashed. This prevents honest reviewers from being punished for a coverage failure caused by other auditors missing audit commits or reveals.

### 7.2 Audit Fallback

| Situation | Handling |
| --- | --- |
| Too few audit commits | Slash missing audit committers. Critical retries while retries remain; otherwise the result becomes low-confidence or unresolved. |
| Too few audit reveals | Slash missing audit revealers. Critical retries while retries remain; otherwise finalize low-confidence. |
| Insufficient coverage for a report | Exclude that report from semantic slashing. |
| Insufficient overall coverage | Lower confidence. Critical retries while possible, then becomes unresolved if coverage still fails. |
| Audit timeout | Apply tier-specific responsive or safety fallback. |

Fast requests prioritize responsiveness. Standard requests can retry review-side quorum failures once, then use responsive fallback. Critical requests require stronger audit quorum and coverage, retry while possible, and become unresolved if they still cannot meet the required safety bar.

## 8. Commit-and-Reveal Policy

Both review and audit use commit-and-reveal.

BRAIN uses commit-and-reveal to prevent free-riders from copying other committee members' outputs. DAIO applies the same approach.

| Commit type | Committed data |
| --- | --- |
| Review Commit | Proposal score, report hash, report URI hash, reviewer identity, and seed. |
| Audit Commit | Canonical full-audit target list, audit scores, auditor identity, and seed. |

During reveal, the reviewer discloses the original values and seed. A mismatch is a protocol fault and can be slashed.

The official reviewer-facing entrypoint is DAIOCommitRevealManager. DAIOCore only exposes manager-only recording functions.

Audit commits must not include target proofs. A non-empty target proof array is rejected.

## 9. Consensus Scoring

DAIO adapts BlockFlow's contribution scoring procedure to review consensus.

BlockFlow has participants submit models and evaluate other participants' models. It then computes median model scores, evaluator deviation from the median, evaluator reliability, and final contribution scores.

DAIO maps this as follows:

| BlockFlow | DAIO |
| --- | --- |
| Client | Reviewer |
| Model | Review report |
| Model score | Audit score for a report |
| Model quality | Report quality |
| Evaluator reliability | Audit reliability |
| Final contribution `p[k]` | Reviewer final contribution |

### 9.1 Input Scores

Each reviewer `k` submits:

```text
r[k] = proposal score
reportHash[k]
reportURI[k]
```

Each auditor `a` submits audit scores for assigned targets:

```text
s[a,k] = score assigned by auditor a to reviewer k's report
```

### 9.2 Report Quality

For each reviewer `k`, DAIO computes:

```text
m[k] = median{ s[a,k] }
```

Then it normalizes inside the request:

```text
m_norm[k] = m[k] / max(m)
```

This produces a relative report quality score.

### 9.3 Audit Reliability

For each auditor-target pair, deviation is:

```text
t[a,k] = |s[a,k] - m[k]|
```

Deviation is transformed into a quality score:

```text
t_norm[a,k] = max(0, (0.5 - t[a,k]) / (0.5 + t[a,k]))
```

Each auditor's raw reliability is the minimum transformed score across its audited targets:

```text
d[a] = min{ t_norm[a,k] }
```

Then it is normalized:

```text
d_norm[a] = d[a] / max(d)
```

### 9.4 Final Contribution

The final contribution score combines report quality and audit reliability:

```text
p[k] = min(m_norm[k], d_norm[k])
```

`p[k]` drives Round 1 proposal-score weighting, long-term reputation inputs, and repeated-fault detection. Rewards use the Round 2 final weight derived from `p[k]` and the reviewer's long-term reputation score.

### 9.5 Final Proposal Score

DAIO records three score rounds:

```text
Round 0 = review median over revealed proposal scores
Round 1 = weightedMedian(r[k], weight = p[k])
Round 2 = weightedMedian(r[k], weight = finalWeight[k])

finalWeight[k] = p[k] * reputationScore[k] / 10000
finalProposalScore = Round 2
```

If all Round 2 weights are zero, DAIO falls back to the median of revealed proposal scores and marks the result low-confidence.

This makes high-quality reports, reliable auditors, and long-term reputation more influential without punishing high-quality minority opinions merely for being different.

### 9.6 Confidence

Confidence combines:

```text
review participation
audit participation
audit coverage
score dispersion
low-confidence fallback flag
```

The final result is not only a score. It includes confidence, audit coverage, dispersion, minority-opinion flags, and per-reviewer signals.

### 9.7 Minority Opinion

A score that differs from the weighted median is not a fault by itself.

Protected case:

```text
proposal score differs from majority
report quality is high
audit reliability is high
final contribution is high
=> protected as a minority opinion
```

Fault candidate:

```text
proposal score is repeatedly extreme
report quality is low
audit scores often deviate from medians
final contribution is repeatedly low
=> semantic strikes accumulate
```

## 10. Rewards and Slashing

### 10.1 Rewards

Reviewer rewards are paid from the request reward pool after protocol fees.

Request funding:

```text
feePaid = baseRequestFee + priorityFee
protocolFee = feePaid * 1000 / 10000
rewardPool = feePaid - protocolFee
```

Reviewer reward:

```text
finalWeight[k] = Round 2 reviewer weight
totalContribution = sum(finalWeight)

if protocolFault[k] or finalWeight[k] == 0 or totalContribution == 0:
    reward[k] = 0
else:
    reward[k] = rewardPool * finalWeight[k] / totalContribution
```

Reward inputs include:

| Factor | Description |
| --- | --- |
| Review reveal completion | Whether the report was revealed. |
| Audit reveal completion | Whether assigned audits were revealed. |
| Report quality | How well the reviewer's report was evaluated. |
| Audit reliability | How reliably the reviewer evaluated other reports. |
| Protocol compliance | Whether deadlines and commit/reveal rules were followed. |

Rewards are not based only on closeness to the final proposal-score median.

### 10.2 Protocol Faults

Protocol faults are objectively verifiable violations and can be slashed immediately.

| Violation | Handling |
| --- | --- |
| Invalid VRF proof | Slash and reject the commit. |
| Sortition failure | Slash and reject the commit. |
| Missing reveal after commit | Partial slash. |
| Commit/reveal mismatch | Strong slash. |
| Non-canonical audit target | Strong slash. |
| Self-audit | Strong slash. |
| Duplicate audit target | Strong slash. |
| Unexpected audit target proof | Reject before acceptance. |
| Score out of range | Strong slash. |

Current slash rates:

| Fault type | Slash rate |
| --- | --- |
| Protocol fault | `500 bps` |
| Missed review reveal, audit commit, or audit reveal | `100 bps` |
| Semantic suspension slash | `200 bps` |

Slash amount is computed against reviewer stake:

```text
slashAmount = reviewerStake * slashBps / 10000
```

### 10.3 Semantic Faults

Semantic faults are content-quality signals. DAIO does not apply immediate strong slashing for a single low contribution.

| Situation | Handling |
| --- | --- |
| Different score with high report quality | Protected as minority opinion. |
| Different score with low report quality | Semantic fault candidate. |
| Repeated semantic fault | Strike accumulation. |
| Strike threshold exceeded | Partial slash, cooldown, or suspension. |
| Long-term low-quality pattern | Eligibility restriction. |

Semantic fault condition:

```text
semanticFault[k] = covered[k] && contribution[k] < contributionThreshold
```

The current strike threshold is `3`. If the threshold is exceeded, DAIO applies the semantic slash rate and cooldown policy.

Core principle:

> Slashing targets protocol violations or repeated abnormal behavior with low report quality, not a score that merely differs from the majority.

## 11. Stake Vault and Accounting

StakeVault holds:

```text
reviewer stake
request reward pools
protocol fees
treasury balance
refundable request escrow
```

Reviewer stake is locked while the reviewer has an accepted commitment in an active request. It is unlocked on settlement, cancellation, failure, unresolved finalization, or retry cleanup.

## 12. Reputation Ledger

DAIO accumulates request results into long-term reputation signals.

| Signal | Meaning |
| --- | --- |
| Long-term audit reliability | How reliably the reviewer has evaluated others. |
| Long-term report quality | How well the reviewer's reports have been evaluated. |
| Protocol compliance | How well the reviewer follows deadlines and target rules. |
| Final contribution | Combined BlockFlow-style contribution score. |

Long-term reputation is used for eligibility, reward policy, slashing risk, and ERC-8004 feedback.

Reviewers with enough samples and low final contribution or low protocol compliance can become ineligible for new requests.

## 13. ERC-8004 Integration

DAIO uses ERC-8004 as an optional external reputation record layer, not as the reputation calculator.

The ERC-8004 Identity Registry identifies agents by agent ID. The Reputation Registry records feedback values with decimals, tags, endpoints, feedback URIs, and feedback hashes.

DAIO records:

| Tag | Meaning |
| --- | --- |
| `daio.reportQuality` | Normalized report quality. |
| `daio.auditReliability` | Normalized audit reliability. |
| `daio.finalContribution` | Final BlockFlow-style contribution score. |
| `daio.finalReliability` | Request-level final reliability. |
| `daio.protocolCompliance` | Protocol compliance signal. |
| `daio.scoreAgreement` | Agreement with the final proposal score. |
| `daio.minorityOpinion` | High-quality minority-opinion signal. |

DAIO scores use `valueDecimals = 4`. For example, `10000` represents `1.0000`. Minority flags use `valueDecimals = 0` and value `0` or `1`.

External systems should trust DAIO-related ERC-8004 feedback only when it comes from the official DAIO adapter.

## 14. ENS Integration

DAIO reviewers can use ENS as a persistent public identity.

ENS roles:

| Role | Description |
| --- | --- |
| Public identifier | Human-readable reviewer name. |
| Character or brand identity | Link to a game-like AI reviewer character if desired. |
| Wallet binding | Resolver address must match the reviewer wallet or ERC-8004 agent wallet. |
| Metadata link | Agent URI or service endpoint may include ENS. |
| Reputation persistence | Helps reviewers maintain long-term identities. |

ENS is not a complete Sybil-resistance mechanism. Sybil cost comes from USDAIO stake, long-term reputation, domain qualifications, and cooldown policy.

## 15. Payment Router and Uniswap v4 Hook

USDAIO is the base payment token. If the user lacks USDAIO, DAIO can accept USDC, USDT, or ETH and convert it to USDAIO.

Payment flow:

```text
USDC / USDT / ETH
-> PaymentRouter
-> Uniswap v4 exact-output swap
-> USDAIO acquired
-> StakeVault escrow funded
-> DAIOCore request created
```

PaymentRouter is the request-creation entrypoint. The Uniswap v4 hook does not create requests.

| Component | Role |
| --- | --- |
| PaymentRouter | Receives input assets, acquires USDAIO, and creates requests. |
| SwapAdapter | Executes Uniswap v4 swap calldata. |
| DAIOAutoConvertHook | Validates DAIO payment swap intent and emits events. |
| DAIOCore | Owns request state transitions. |
| StakeVault | Holds fee escrow and reward pools. |

The hook focuses on validating that a swap came through an allowed router, used an allowed pool pair, matched a registered request intent, and produced enough USDAIO output.

## 16. Request Lifecycle

```text
1. Reviewer registration
   - Optionally provide ENS
   - Optionally provide ERC-8004 agent ID
   - Deposit USDAIO stake
   - Register domain mask and VRF public key

2. Request creation
   - Submit proposal URI/hash
   - Submit rubric hash
   - Pay required fee and optional priority fee
   - Convert USDC/USDT/ETH if USDAIO is not supplied directly

3. Priority queue
   - Order by priority fee
   - Start from the highest-priority request

4. Review Commit phase
   - Eligible reviewers perform VRF self-sortition
   - Selected reviewers submit commit hash and VRF proof
   - Committee is fixed once commit quorum is reached

5. Review Reveal phase
   - Committed reviewers reveal scores and reports
   - Request advances to audit if reveal quorum is reached
   - Otherwise fallback applies

6. Full-audit target assignment
   - Revealed reviewers become auditors
   - Each reviewer receives every other revealed reviewer as a target
   - Self-audit is forbidden
   - Audit target proofs are rejected

7. Audit Commit phase
   - Auditors submit audit-score commitments for the canonical full-audit target list

8. Audit Reveal phase
   - Auditors reveal audit scores
   - Coverage is measured

9. Consensus scoring
   - Compute final proposal score
   - Compute report quality
   - Compute audit reliability
   - Compute confidence and dispersion
   - Identify minority opinions

10. Settlement
   - Pay rewards
   - Unlock stake
   - Apply already-recorded protocol faults
   - Accumulate semantic strikes
   - Refund or close escrow to treasury

11. Reputation update
   - Update DAIO ReputationLedger
   - Record ERC-8004 feedback
```

## 17. Fallback Policy

DAIO extends BRAIN's fallback model for review workflows.

| Phase | Failure | Default handling |
| --- | --- | --- |
| Review Commit | Commit quorum not reached | Retry if allowed; otherwise cancel and refund. |
| Review Reveal | Reveal quorum not reached | Slash missing revealers; retry if allowed; otherwise continue low-confidence when at least one review was revealed. |
| Audit Commit | Too few audit commits | Slash missing audit committers; Critical retries if allowed; otherwise continue low-confidence or become unresolved if Critical has zero audit commits. |
| Audit Reveal | Too few audit reveals | Slash missing audit revealers; Critical retries if allowed; otherwise finalize low-confidence. |
| Coverage | Some reports lack audits | Exclude uncovered reports from semantic slashing and lower confidence. |
| Finalization | Critical coverage failure | Retry if allowed; otherwise mark unresolved. |

Tier behavior:

| Tier | Policy |
| --- | --- |
| Fast | One retry is available, with responsive low-confidence fallback when partial work exists. |
| Standard | One retry is available for review-side quorum failure, with responsive fallback after that. |
| Critical | Two retries are available; unresolved if audit quorum or coverage remains insufficient. |

## 18. Key Design Notes

### 18.1 Reviewer Selection Is Probabilistic

DAIO does not preselect exactly `M` reviewers for each request. Each eligible reviewer checks its own VRF output. Selected reviewers commit. The committee is fixed once quorum is reached.

This is probabilistic committee formation, not a fixed committee.

### 18.2 Difficulty and Quorum Must Be Designed Together

Low selection probability and high quorum can cause slow progress or timeouts. High selection probability and low quorum respond quickly but reduce redundancy.

Current deployment defaults:

| Tier | Review selection probability | Review and audit quorum |
| --- | --- | --- |
| Fast | `80%` | `3` |
| Standard | `100%` | `4` |
| Critical | `100%` | `5` |

Audit uses full-audit among revealed reviewers, so audit difficulty is fixed at `100%` and audit quorum follows review reveal quorum.

### 18.3 Audit Is Deterministic Full-Audit

DAIO currently forces a balanced full-audit graph among revealed reviewers. Each reviewer audits every other revealed reviewer. This removes audit VRF non-participation incentives and makes audit coverage deterministic unless auditors miss commits or reveals.

### 18.4 Confidence Is Part of the Result

The output must include more than a final score:

```text
finalProposalScore
confidence
review participation
audit coverage
score dispersion
minority opinions
per-reviewer reputation signals
```

### 18.5 Simple Outlier Slashing Is Forbidden

DAIO reviews papers, policy, law, and DAO proposals, where minority opinions can be valuable. A reviewer is not slashed merely because its score differs from the majority. DAIO penalizes protocol violations and repeated low-quality abnormal behavior.

### 18.6 ERC-8004 Is an External Trust Layer

DAIO computes reputation internally and publishes signals externally through ERC-8004. When interpreting DAIO reputation, only feedback written by the DAIO adapter should be treated as canonical.

### 18.7 Uniswap Hook Is a Swap-Validation Layer

USDAIO conversion belongs to PaymentRouter and SwapAdapter. The hook validates and traces the swap intent. It does not own request creation or request lifecycle state.

## 19. Final Contract Architecture

```text
Requester
  |
  | USDAIO / USDC / USDT / ETH
  v
PaymentRouter
  |
  +--> UniswapV4SwapAdapter
  |       |
  |       v
  |   Uniswap v4 Pool + DAIOAutoConvertHook
  |
  v
DAIOCore Proxy (DAIOTransparentUpgradeableProxy)
  |
  v
DAIOCore implementation
  |
  v
DAIOPriorityQueue
  |
  v
VRF-based Review Sortition
  |
  v
DAIOCommitRevealManager
  |
  v
Full-Audit Target Assignment
  |
  v
ConsensusScoring
  |
  v
Settlement ----> StakeVault
  |
  v
DAIORoundLedger
  |
  v
ReputationLedger
  |
  v
ERC8004Adapter ----> ERC-8004 Reputation Registry

Reviewer
  |
  | optional ENS + optional ERC-8004 agentId + USDAIO stake
  v
ReviewerRegistry
```

## 20. Implementation Direction

DAIO contracts should be implemented with these rules:

```text
1. Start on Ethereum Sepolia.
2. Reviewers register with USDAIO stake, domain mask, VRF public key, and optional ENS/ERC-8004 identity.
3. USDAIO is the common accounting unit.
4. Requesters can create requests with USDAIO, USDC, USDT, or ETH.
5. USDC, USDT, and ETH are converted to USDAIO through PaymentRouter and Uniswap v4.
6. The Uniswap v4 hook validates payment swaps, not request creation.
7. Requests enter a priority-fee queue.
8. Reviewer selection uses BRAIN-style VRF probabilistic sortition.
9. Default review selection probability is 80% for Fast and 100% for Standard/Critical.
10. Default review and audit quorums are 3, 4, and 5 for Fast, Standard, and Critical.
11. Once commit quorum is reached, the review committee is fixed.
12. Once reveal quorum is reached, the request advances to audit.
13. Audit targets are deterministic full-audit peer targets among revealed reviewers.
14. Insufficient audit coverage affects confidence, semantic slashing eligibility, and Critical retry/unresolved behavior.
15. Review and audit scores both use commit-and-reveal.
16. Scoring combines median-based consensus, report quality, audit reliability, and confidence.
17. Long-term audit reliability and contribution are accumulated in ReputationLedger.
18. ERC-8004 publishes DAIO reputation feedback to external systems.
19. Slashing applies to protocol violations and repeated low-quality behavior.
20. High-quality minority opinions are protected.
21. DAIOCore is upgradeable through the DAIOTransparentUpgradeableProxy, and dependent contracts use the proxy address as canonical core.
```

DAIO uses a review network that forms probabilistically for each request through VRF, then applies deterministic full-audit among revealed reviewers. It extends BRAIN's request queue, cryptographic sortition, commit/reveal, quorum, and fallback concepts into an on-chain review consensus protocol.

The core output is not a single score. It is a consensus score plus confidence, report quality, audit reliability, minority-opinion signals, and long-term reputation.
