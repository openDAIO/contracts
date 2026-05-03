# DAIO Contracts

DAIO is an on-chain review, audit, scoring, and settlement protocol for document-based requests. The current Sepolia deployment supports direct USDAIO payments, relayed signed requests, optional ENS and ERC-8004 identity metadata, Uniswap v4 based auto-conversion, round-based scoring, and round accounting.

## Sepolia Deployment

Network: Ethereum Sepolia  
Deployment profile: five expected reviewers, `maxActiveRequests = 2`, `100 USDAIO` base request fee  
Auto-convert profile: Sepolia Uniswap v4 hook deployed; ETH/USDAIO pool seeding is not run by the deployment-contract profile.

| Contract | Address | Role |
| --- | --- | --- |
| `DAIOCore` | `0x41D1570eA26561C381FC94e61d1381826F45cD4d` | Main request lifecycle contract. Creates queued requests through `PaymentRouter`, starts active requests, enforces phase transitions, records final outcomes, and coordinates scoring, settlement, slashing, and retries. |
| `PaymentRouter` | `0x28e88241B4E887619E21869fDb835efD10B4bb80` | Payment entry point. Pulls USDAIO, funds `StakeVault`, creates requests through `DAIOCore`, tracks each requester latest request, supports relayed EIP-712 request intents, and routes ETH/ERC20 auto-conversion flows. |
| `USDAIO` | `0x3bB1A142b5abE17e5B2e577fa83b5247b6532606` | Test payment token for request fees, rewards, reviewer stakes, and v4 liquidity. On this test deployment, anyone can mint USDAIO. |
| `StakeVault` | `0x9b790bf0bB552716dc8d3234DFf3e4a3A5a6a8F8` | Escrows request fees and reviewer stakes. Pays rewards, refunds requesters, and applies slashes authorized by core/registry flow. |
| `ReviewerRegistry` | `0x7e7Ea105168dd18293dC128eA43b3d1BE0000686` | Reviewer registration, stake accounting, eligibility checks, optional ENS/ERC-8004 checks, cooldowns, and protocol/semantic fault tracking. |
| `AssignmentManager` | `0xA77B2A24474F839616D9a1696D53861C8029E306` | Assignment helper module used by the core review/audit workflow. |
| `ConsensusScoring` | `0xfEa92280128c4dc6d658F1D18b38019336ae452d` | BlockFlow-like consensus scoring module for audit-backed reviewer contribution, reliability, coverage, and weighted score computation. |
| `Settlement` | `0xde10633fEa33c0f56919d9eFa632294Bde6AA5A1` | Computes reviewer reward and slash outcomes from final reviewer contributions and protocol/semantic fault state. |
| `ReputationLedger` | `0xBe13def9be39A5235FEDAa1571296f3C384258Be` | Internal DAIO reputation source. Stores report quality, audit reliability, final contribution, and protocol compliance; Round 2 final weighting uses this ledger. |
| `DAIORoundLedger` | `0x30D6A783716bC30aAF04cf1022d31627D00c6f9D` | Persistent round score and accounting history by `requestId`, `attempt`, `round`, and reviewer address. |
| `DAIOCommitRevealManager` | `0xBd2f6A66f4AD5162aE3eb564119C8325A660CD02` | Commit/reveal wrapper used by reviewers and auditors. It gates commit/reveal calls and records accepted participants. |
| `DAIOPriorityQueue` | `0x4e7179a751F09e643f27CAD157BF40d5e9915c79` | Core-controlled request priority queue. Requests with higher priority fees are started first. |
| `FRAINVRFVerifier` | `0x5E43cE1E1dE9a7C041463C189aA5c2dC975C10df` | FRAIN VRF proof verifier. |
| `DAIOVRFCoordinator` | `0x97dD41B2950C203bA75F0FD9189144047EF0B374` | Builds DAIO-specific VRF messages and randomness for reviewer/auditor sortition. |
| `AcceptedTokenRegistry` | `0x449c80B3E923DB9CB8E2E592Ba3Ec5E4a19a49a7` | Registry of accepted payment tokens and whether each token requires swap-to-USDAIO. |
| `ENSVerifier` | `0x87B674Ec26F8F8001E2FCfB25a47a93746760cc1` | Optional ENS identity verifier. If a reviewer submits ENS metadata, it checks that the ENS record resolves to the reviewer or agent wallet. |
| `ERC8004Adapter` | `0xF89d23b89f3c4C514b90073A36cc9618E127c0eA` | Optional ERC-8004 adapter. Verifies agent wallet authorization and mirrors DAIO reputation signals to the ERC-8004 reputation registry when available. |
| `UniswapV4SwapAdapter` | `0x42dfA56F457aAcc6243931534C08E99DEA4f6866` | Adapter used by `PaymentRouter` to call the Universal Router for exact-output USDAIO swaps. |
| `DAIOAutoConvertHook` | `0xc0f32B14f0529158dDceD48Bfd2558F0AB134040` | Uniswap v4 `afterSwap` hook. Validates that an allowed swap route produced enough USDAIO for a registered payment intent. |

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
| Review election difficulty | `10000 / 10000` |
| Audit election difficulty | `10000 / 10000` |
| Fast timeout per phase | `10 minutes` |
| Standard timeout per phase | `30 minutes` |
| Critical timeout per phase | `1 hour` |
| Fast quorum | review `4/4`, audit `4/4` |
| Standard quorum | review `4/4`, audit `4/4` |
| Critical quorum | review `4/4`, audit `4/4` |
| Fast audit target limit | `3` |
| Standard audit target limit | `3` |
| Critical audit target limit | `4` |

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
| Currency 1 | `0x3bB1A142b5abE17e5B2e577fa83b5247b6532606` |
| Fee | `3000` |
| Tick spacing | `60` |
| Hook | `0xc0f32B14f0529158dDceD48Bfd2558F0AB134040` |
| Pool status | not initialized by the deployment-contract profile |

## Verification

The Sepolia deployment was tested through Hardhat forks.

| Test | Result | Notes |
| --- | --- | --- |
| Compile with `OPTIMIZER_RUNS=10` | Passed | `DAIOCore` runtime bytecode: `24535 bytes`. |
| Full default Hardhat suite | `33 passing`, `3 pending` | Pending tests are opt-in fork suites. |
| Deployed-address Sepolia fork E2E | `2 passing` | Verified deployed wiring and ran request -> review -> audit -> round ledger -> accounting finalization on a local fork. |
| Official Sepolia integration fork E2E | `1 passing` | Publicnode lacked historical state for this test; dRPC succeeded. |
