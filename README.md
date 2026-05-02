# DAIO Contracts

DAIO is an on-chain review, audit, scoring, and settlement protocol for document-based requests. The current Sepolia deployment supports direct USDAIO payments, relayed signed requests, optional ENS and ERC-8004 identity metadata, Uniswap v4 based auto-conversion, round-based scoring, and round accounting.

## Sepolia Deployment

Network: Ethereum Sepolia  
Deployment profile: five expected reviewers, `maxActiveRequests = 2`, `100 USDAIO` base request fee  
USDAIO/ETH pool: `1 ETH = 100000 USDAIO`, seeded with about `0.1 ETH <> 10000 USDAIO`

| Contract | Address | Role |
| --- | --- | --- |
| `DAIOCore` | `0xb61D8921B8E310D06dD38C913e43928780830B56` | Main request lifecycle contract. Creates queued requests through `PaymentRouter`, starts active requests, enforces phase transitions, records final outcomes, and coordinates scoring, settlement, slashing, and retries. |
| `PaymentRouter` | `0xe90dd5A9C6962b6308d8a46422eF8bCE32D7E063` | Payment entry point. Pulls USDAIO, funds `StakeVault`, creates requests through `DAIOCore`, tracks each requester latest request, supports relayed EIP-712 request intents, and routes ETH/ERC20 auto-conversion flows. |
| `USDAIO` | `0xbfd961809993e88D34235eDB0bCE1cD13a3ebAac` | Test payment token for request fees, rewards, reviewer stakes, and v4 liquidity. On this test deployment, anyone can mint USDAIO. |
| `StakeVault` | `0x263091C8A7B28E5f0F71C3AE8F60823B0DcC8504` | Escrows request fees and reviewer stakes. Pays rewards, refunds requesters, and applies slashes authorized by core/registry flow. |
| `ReviewerRegistry` | `0xE30531Df811b06d7D4eA6a799810112aE75635BE` | Reviewer registration, stake accounting, eligibility checks, optional ENS/ERC-8004 checks, cooldowns, and protocol/semantic fault tracking. |
| `AssignmentManager` | `0x96E8D837978632D75Eb8eA242afD25B7eBf83FC8` | Assignment helper module used by the core review/audit workflow. |
| `ConsensusScoring` | `0xDd9dEd9e8a6b68cD1759299ce8EcD3b87577FdfA` | BlockFlow-like consensus scoring module for audit-backed reviewer contribution, reliability, coverage, and weighted score computation. |
| `Settlement` | `0xB395CBBE231974167bB3d9B7e212C594f6932523` | Computes reviewer reward and slash outcomes from final reviewer contributions and protocol/semantic fault state. |
| `ReputationLedger` | `0x9685500168e6C5D60f3f060A49DE6F57F9AC1E9A` | Internal DAIO reputation source. Stores report quality, audit reliability, final contribution, and protocol compliance; Round 2 final weighting uses this ledger. |
| `DAIORoundLedger` | `0x6085A3371A420e5397E7edb34Dde0373BA5d00aE` | Persistent round score and accounting history by `requestId`, `attempt`, `round`, and reviewer address. |
| `DAIOCommitRevealManager` | `0x29c3E89D3D3e198F8e62ead7A39F24375EC0A647` | Commit/reveal wrapper used by reviewers and auditors. It gates commit/reveal calls and records accepted participants. |
| `DAIOPriorityQueue` | `0x8BDEA183c664E11c39Af5eF7948CE8cb46751117` | Core-controlled request priority queue. Requests with higher priority fees are started first. |
| `FRAINVRFVerifier` | `0xdf50FA950b5Afd2D551D0D5CCbA88b8aE77c5786` | FRAIN VRF proof verifier. |
| `DAIOVRFCoordinator` | `0x4040e3387115b81216301858168C6854038E5D28` | Builds DAIO-specific VRF messages and randomness for reviewer/auditor sortition. |
| `AcceptedTokenRegistry` | `0x98d00bc8Ddde42dfE4F3BA7fbAd23d6880c0c19d` | Registry of accepted payment tokens and whether each token requires swap-to-USDAIO. |
| `ENSVerifier` | `0xEf175ad939f9bDDe284d41b779ccc13b1377530f` | Optional ENS identity verifier. If a reviewer submits ENS metadata, it checks that the ENS record resolves to the reviewer or agent wallet. |
| `ERC8004Adapter` | `0x4CD72D5817b654A76e4000F1f84dC1A128Ac3649` | Optional ERC-8004 adapter. Verifies agent wallet authorization and mirrors DAIO reputation signals to the ERC-8004 reputation registry when available. |
| `UniswapV4SwapAdapter` | `0xDa724BA5Eba473De3dc7dd38A686003637d694B3` | Adapter used by `PaymentRouter` to call the Universal Router for exact-output USDAIO swaps. |
| `DAIOAutoConvertHook` | `0xc34f2d0a9D6c768479682d8c3aB114a4a4e00040` | Uniswap v4 `afterSwap` hook. Validates that an allowed swap route produced enough USDAIO for a registered payment intent. |

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

## Round Scoring

DAIO stores both live previews and durable snapshots by request, attempt, round, and reviewer address.

| Round | Name | Purpose |
| --- | --- | --- |
| `0` | Review | Uses revealed proposal scores. Request score is the median review score. |
| `1` | AuditConsensus | Uses audit-backed consensus scoring. Reviewer weights come from consensus contribution/reliability. |
| `2` | ReputationFinal | Applies internal reputation weights from `ReputationLedger` and records final rewards/slashes. |

Important view surfaces include:

- `latestAttempt(requestId)`
- `getRoundAggregate(requestId, attempt, round)`
- `getReviewerRoundScore(requestId, attempt, round, reviewer)`
- `getReviewerRoundAccounting(requestId, attempt, round, reviewer)`
- `previewRoundAggregate(requestId, round)`
- `previewReviewerRoundScore(requestId, round, reviewer)`
- `PaymentRouter.latestRequestByRequester(requester)`
- `PaymentRouter.latestRequestState(requester)`

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

## Verification

The Sepolia deployment was tested through Hardhat forks.

| Test | Result | Notes |
| --- | --- | --- |
| Compile with `OPTIMIZER_RUNS=10` | Passed | `DAIOCore` runtime bytecode: `24535 bytes`. |
| Full default Hardhat suite | `33 passing`, `3 pending` | Pending tests are opt-in fork suites. |
| Deployed-address Sepolia fork E2E | `2 passing` | Verified deployed wiring and ran request -> review -> audit -> round ledger -> accounting finalization on a local fork. |
| Official Sepolia integration fork E2E | `1 passing` | Publicnode lacked historical state for this test; dRPC succeeded. |
