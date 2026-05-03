# DAIO Contracts

DAIO is an on-chain review, audit, scoring, and settlement protocol for document-based requests. The current Sepolia deployment supports direct USDAIO payments, relayed signed requests, optional ENS and ERC-8004 identity metadata, Uniswap v4 based auto-conversion, round-based scoring, and round accounting.

## Sepolia Deployment

Network: Ethereum Sepolia  
Deployment profile: five expected reviewers, `maxActiveRequests = 2`, `100 USDAIO` base request fee  
Auto-convert profile: reused the previous USDAIO token and Uniswap v4 hook so the existing ETH/USDAIO pool key remains valid.

| Contract | Address | Role |
| --- | --- | --- |
| `DAIOCore` | `0x2cC3b1223C4C9F74d2C120F768954EE2E9BA439B` | Main request lifecycle contract. Creates queued requests through `PaymentRouter`, starts active requests, enforces phase transitions, records final outcomes, and coordinates scoring, settlement, slashing, and retries. |
| `PaymentRouter` | `0xf3AC3b4f5135aAcd65538ec3e2d307a0d574De52` | Payment entry point. Pulls USDAIO, funds `StakeVault`, creates requests through `DAIOCore`, tracks each requester latest request, supports relayed EIP-712 request intents, and routes ETH/ERC20 auto-conversion flows. |
| `USDAIO` | `0xbfd961809993e88D34235eDB0bCE1cD13a3ebAac` | Reused test payment token for request fees, rewards, reviewer stakes, and v4 liquidity. On this test deployment, anyone can mint USDAIO. |
| `StakeVault` | `0x4053280d54a6C51750cE2dC0Bd8F26e86A758672` | Escrows request fees and reviewer stakes. Pays rewards, refunds requesters, and applies slashes authorized by core/registry flow. |
| `ReviewerRegistry` | `0x02B15a4FB2bE5021A98B2965d84e869a2056607E` | Reviewer registration, stake accounting, eligibility checks, optional ENS/ERC-8004 checks, cooldowns, and protocol/semantic fault tracking. |
| `AssignmentManager` | `0x233b2676138Fb3a426Aa45b4576bD50e8C7f31b0` | Assignment helper module used by the core review/audit workflow. |
| `ConsensusScoring` | `0x022570FCA8E9995e0feE157ab7dAE1b1ebB864c9` | BlockFlow-like consensus scoring module for audit-backed reviewer contribution, reliability, coverage, and weighted score computation. |
| `Settlement` | `0x22654F6f648bF0a6fF6e2884fD11c0F2cE7bD66a` | Computes reviewer reward and slash outcomes from final reviewer contributions and protocol/semantic fault state. |
| `ReputationLedger` | `0x6265576Cb22d751a97DC6c4bd9a28DDe6f097d4b` | Internal DAIO reputation source. Stores report quality, audit reliability, final contribution, and protocol compliance; Round 2 final weighting uses this ledger. |
| `DAIORoundLedger` | `0xe7cFe62AA199ea12De728aF1200c6F1467a4d9cB` | Persistent round score and accounting history by `requestId`, `attempt`, `round`, and reviewer address. |
| `DAIOCommitRevealManager` | `0x457f51523D008E7a00505D06ac431a98840C9B9b` | Commit/reveal wrapper used by reviewers and auditors. It gates commit/reveal calls and records accepted participants. |
| `DAIOPriorityQueue` | `0xe7f03154D3cB9D975C7e338E31D774Dd58F9caf5` | Core-controlled request priority queue. Requests with higher priority fees are started first. |
| `FRAINVRFVerifier` | `0xedB25f39d6f64BEeB3d6847F3936e1eDa04f64C1` | FRAIN VRF proof verifier. |
| `DAIOVRFCoordinator` | `0x0F099E96307cF195D21472289BC72A5e3fabE38a` | Builds DAIO-specific VRF messages and randomness for reviewer/auditor sortition. |
| `AcceptedTokenRegistry` | `0xBC003Ed699Dd78250325d46a61e87fC6B531e90a` | Registry of accepted payment tokens and whether each token requires swap-to-USDAIO. |
| `ENSVerifier` | `0x2DE705A955DA2Da119C228dFF3c8402B1a860df1` | Optional ENS identity verifier. If a reviewer submits ENS metadata, it checks that the ENS record resolves to the reviewer or agent wallet. |
| `ERC8004Adapter` | `0x88A835551db08b78868b0F193cFe3440D9659410` | Optional ERC-8004 adapter. Verifies agent wallet authorization and mirrors DAIO reputation signals to the ERC-8004 reputation registry when available. |
| `UniswapV4SwapAdapter` | `0xdC94BBf4a09e69405d14e1b35Db01A3D4Efd8A15` | Adapter used by `PaymentRouter` to call the Universal Router for exact-output USDAIO swaps. |
| `DAIOAutoConvertHook` | `0xc34f2d0a9D6c768479682d8c3aB114a4a4e00040` | Reused Uniswap v4 `afterSwap` hook. Validates that an allowed swap route produced enough USDAIO for a registered payment intent. |
| `DAIOInfoReader` | `0x514758063D1f699AfCB234a9ed74689E191dDfc1` | Read-only helper for protocol overview, request state, participant data, and round/accounting views. |

## External Sepolia Integrations

| Integration | Address | Usage |
| --- | --- | --- |
| ENS Registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` | Used by `ENSVerifier`. |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Used by `ERC8004Adapter` for optional agent authorization checks. |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Receives optional mirrored DAIO feedback signals. |
| Uniswap v4 PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | Owns v4 pool state and invokes hooks. |
| Uniswap v4 PositionManager | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` | Used by the deployment script to initialize and seed the ETH/USDAIO pool. |
| Uniswap Universal Router | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` | Used by `UniswapV4SwapAdapter` for payment conversion calls. |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Used when seeding v4 liquidity through PositionManager. |

## Current Protocol Settings

| Setting | Value |
| --- | --- |
| Base request fee | `100 USDAIO` |
| `maxActiveRequests` | `2` |
| Expected reviewer count | `5` |
| Fast review election difficulty | `8000 / 10000` |
| Standard/Critical review election difficulty | `10000 / 10000` |
| Audit election difficulty | `10000 / 10000` |
| Fast timeout per phase | `10 minutes` |
| Standard timeout per phase | `30 minutes` |
| Critical timeout per phase | `1 hour` |
| Fast quorum | review `3/3`, audit `3/3` |
| Standard quorum | review `4/4`, audit `4/4` |
| Critical quorum | review `4/4`, audit `4/4` |
| Fast audit target limit | `2` |
| Standard audit target limit | `3` |
| Critical audit target limit | `4` |

## Source Default Audit Flow

The source defaults for the next deployment now enforce full-audit only. Audit VRF target selection is disabled: every reviewer who reveals a review must audit every other revealed reviewer, and audit target proofs are rejected.

| Tier | Review quorum | Audit obligation | Retry |
| --- | --- | --- | --- |
| Fast | `3` | each revealed reviewer audits `2` peers | `1` |
| Standard | `4` | each revealed reviewer audits `3` peers | `1` |
| Critical | `5` | each revealed reviewer audits `4` peers | `2` |

`setTierConfig` rejects non-full-audit settings: `auditElectionDifficulty` must be `10000`, audit commit/reveal quorum must equal review reveal quorum, and audit target/min-incoming counts must equal `reviewRevealQuorum - 1`. The Sepolia deployment above must be redeployed before it uses this source flow.

ENS and ERC-8004 metadata are optional for participation. Reviewers can register without ENS or ERC-8004 agent IDs. If they provide those fields, the configured verifier/adapter validates them. Internal scoring and Round 2 reputation weights use `ReputationLedger`; ERC-8004 is an external mirror and optional identity source.

Reviewer stake management:

- `ReviewerRegistry.registerReviewer(...)` registers or updates reviewer metadata and deposits the supplied initial/additional stake.
- `ReviewerRegistry.addStake(amount)` deposits more USDAIO for an already registered reviewer without changing ENS, ERC-8004, domain, or VRF metadata.
- `ReviewerRegistry.withdrawStake(amount)` withdraws unlocked stake while preserving the active reviewer minimum.

## Round Scoring

DAIO stores both live previews and durable snapshots by request, attempt, round, and reviewer address.

| Round | Name | Purpose |
| --- | --- | --- |
| `0` | Review | Uses revealed proposal scores. Request score is the median review score. |
| `1` | AuditConsensus | Uses audit-backed consensus scoring. Reviewer weights come from consensus contribution/reliability. |
| `2` | ReputationFinal | Applies internal reputation weights from `ReputationLedger` and records final rewards/slashes. |

Important view surfaces include:

- `DAIOInfoReader.systemOverview()`
- `DAIOInfoReader.tierConfig(tier)`
- `DAIOInfoReader.requestInfo(requestId)`
- `DAIOInfoReader.requestPhase(requestId)`
- `DAIOInfoReader.requestConfig(requestId)`
- `DAIOInfoReader.requestParticipants(requestId)`
- `DAIOInfoReader.reviewSubmission(requestId, reviewer)`
- `DAIOInfoReader.auditSubmission(requestId, auditor)`
- `DAIOInfoReader.auditScore(requestId, auditor, target)`
- `DAIOInfoReader.auditTargets(requestId, auditor)`
- `DAIOInfoReader.incomingAuditors(requestId, target)`
- `DAIOInfoReader.reviewerResult(requestId, reviewer)`
- `DAIOCore.getRequestLifecycle(requestId)`
- `ReviewerRegistry.getReviewer(reviewer)` including stored ENS node/name metadata
- `ReviewerRegistry.getReviewers()`
- `ReviewerRegistry.reviewerCount()`
- `ReviewerRegistry.reviewerAt(index)`
- `getRoundAggregate(requestId, attempt, round)`
- `getReviewerRoundScore(requestId, attempt, round, reviewer)`
- `getReviewerRoundAccounting(requestId, attempt, round, reviewer)`
- `PaymentRouter.latestRequestByRequester(requester)`
- `PaymentRouter.latestRequestState(requester)`

`DAIOInfoReader` keeps most information-only decoding outside `DAIOCore`. `DAIOCore.extsload(slot)` is intentionally low-level and exists so reader contracts can inspect storage without adding many app-facing view methods to the size-constrained core bytecode.

## Payment Flow

Direct USDAIO requests:

1. Requester approves `PaymentRouter` for the required USDAIO amount.
2. `PaymentRouter.createRequestWithUSDAIO(...)` pulls USDAIO.
3. `PaymentRouter` approves/funds `StakeVault`.
4. `DAIOCore.createRequestFor(...)` records the on-chain requester and queues the request.

Relayed USDAIO requests:

1. Requester approves `PaymentRouter`.
2. Requester signs an EIP-712 request intent.
3. Relayer calls `PaymentRouter.createRequestWithUSDAIOBySig(...)`.
4. Gas is paid by the relayer, while the on-chain requester remains the real user address.

ETH/ERC20 auto-conversion requests use `PaymentRouter` plus `UniswapV4SwapAdapter`. The v4 hook does not perform DAIO workflow logic. It validates the swap after execution: allowed router, allowed pool, expected pair, known intent, and enough USDAIO output.

## Uniswap v4 ETH/USDAIO Pool

| Field | Value |
| --- | --- |
| Currency 0 | `0x0000000000000000000000000000000000000000` |
| Currency 1 | `0xbfd961809993e88D34235eDB0bCE1cD13a3ebAac` |
| Fee | `3000` |
| Tick spacing | `60` |
| Hook | `0xc34f2d0a9D6c768479682d8c3aB114a4a4e00040` |
| PoolKey hash | `0x83bc140eb451dfc175b8a2f9e5631eb13d3a5760475fad8f3bc916dfb616faff` |
| Initial price | `1 ETH = 100000 USDAIO` |
| Seeded liquidity | about `0.1 ETH <> 10000 USDAIO` |
| Position token ID | `27894` |
| Pool status | existing pool preserved by reusing the previous USDAIO token and hook |

## Verification

The Sepolia deployment was tested through Hardhat forks.

| Test | Result | Notes |
| --- | --- | --- |
| Compile with `OPTIMIZER_RUNS=10` | Passed | `DAIOCore` runtime bytecode: `24186 bytes`. |
| Full default Hardhat suite | `39 passing`, `3 pending` | Pending tests are opt-in fork suites. |
| Deployed-address Sepolia fork E2E | `2 passing` | Verified reused USDAIO/hook wiring and ran request -> review -> audit -> round ledger -> accounting finalization on a local fork. |
| Generated-wallet Sepolia fork E2E | Passed | Used the configured requester, relayer, and registered reviewer agents against the deployed addresses on a local fork. |
| Official Sepolia integration fork E2E | `1 passing` | Publicnode lacked historical state for this test; dRPC succeeded. |
