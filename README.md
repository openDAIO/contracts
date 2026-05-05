# DAIO Contracts

DAIO is an on-chain review, audit, scoring, and settlement protocol for document-based requests. The current profile uses an upgradeable `DAIOCore`, direct USDAIO payments, relayed signed requests, optional ENS and ERC-8004 identity metadata, Uniswap v4 based auto-conversion, full-audit scoring, and round accounting.

## Sepolia Deployment

Network: Ethereum Sepolia
Status: complete
Deployment file: `deployments/sepolia.json`
Deployer: `0x2f149CaA0e931e13f6F32bd3E46eFc6e96bcC36A`
Deployed at block: `10779910`
Finalized at block: `10779946`

| Contract | Address | Role |
| --- | --- | --- |
| `DAIOCore` | `0x47aC6B98bB2B408954CD72b1B3Adc5A3f5856B26` | Canonical core proxy. Creates queued requests through `PaymentRouter`, starts active requests, enforces phase transitions, finalizes outcomes, and coordinates scoring, settlement, slashing, and retries. |
| `DAIOCoreImplementation` | `0xaAF48c03bA49921A920C6e96DBC29C9421618a1E` | Current `DAIOCore` implementation behind the proxy. |
| `DAIOCoreProxyAdmin` | `0x0732c2ACAe0b14da8FbD56F32E3900e885EAf9C5` | OpenZeppelin proxy admin for `DAIOCore` upgrades. |
| `PaymentRouter` | `0x59154659635eA0f743f57e0f1A46f8985266634a` | Payment entry point for direct and relayed USDAIO requests plus swap-backed payments. |
| `USDAIO` | `0xbfd961809993e88D34235eDB0bCE1cD13a3ebAac` | Test payment token for request fees, rewards, reviewer stakes, and v4 liquidity. Anyone can mint on this test token. |
| `StakeVault` | `0xcD72B9D839Bc4058774AA16a4139339fA15BEc3e` | Escrows request fees and reviewer stakes. Pays rewards, refunds requesters, and applies slashes. |
| `ReviewerRegistry` | `0x29CC861e715DeAC7D7C83A691EDf682D5c88dd5F` | Reviewer registration, stake accounting, eligibility checks, optional ENS/ERC-8004 checks, cooldowns, and fault tracking. |
| `AssignmentManager` | `0x838b8aeDd90e231e8355eFb186494671bf9ff16C` | Full-audit assignment helper. |
| `ConsensusScoring` | `0xe271d90C72D9a8D931f337C144C6C4e204F994ed` | Audit-backed consensus scoring module. Previous deployment: `0xEf348E9658087F7F459dE35207EF02bEb6923aaE`. |
| `Settlement` | `0x6026EAff802C542e0530F234dbCB1738CAb2b6f1` | Computes reviewer reward and slash outcomes. |
| `ReputationLedger` | `0x6099D8C70B4F0F43BdC8b8D1C5Aa58C1FFfab265` | Internal DAIO reputation source used by final weighting. |
| `DAIORoundLedger` | `0xC02ec80De42917A25f279BF1c715c59459C1CD86` | Durable round score and accounting history. |
| `DAIOCommitRevealManager` | `0xf79dcfEf2b09d29179045B1a2E3D5aa8f62fFCA1` | Commit/reveal wrapper used by reviewers and auditors. |
| `DAIOPriorityQueue` | `0xfDd5b220E542Fae4da00A006cEE19E2B32B865f6` | Core-controlled priority queue. |
| `FRAINVRFVerifier` | `0x0ce2B64d1321c4C3033223863C52533Da32C18b7` | FRAIN VRF proof verifier. |
| `DAIOVRFCoordinator` | `0x891aa574C0B226E6860A9778BeDb1ef6Ea1639Ea` | Builds DAIO-specific VRF messages and randomness. |
| `AcceptedTokenRegistry` | `0xe5E8574D93dAda254bcae37510A95Ad28a0F658a` | Registry of accepted payment tokens and swap requirements. |
| `ENSVerifier` | `0xdB7F67EA1284C05EC9E42B364e9FfD8439E89A33` | Optional ENS identity verifier. |
| `ERC8004Adapter` | `0x200eB6bF1af5936142A8aD3B6293fD159BF43916` | Optional ERC-8004 adapter and reputation mirror. |
| `UniswapV4SwapAdapter` | `0xCDcAFCC67dfe96BF4bc3E92623b75bc28706558B` | Adapter used by `PaymentRouter` to call the Universal Router. |
| `DAIOAutoConvertHook` | `0xc34f2d0a9D6c768479682d8c3aB114a4a4e00040` | Uniswap v4 `afterSwap` hook for DAIO payment intent validation. |
| `DAIOInfoReader` | `0x37338aBC72f328569F8E399EA4b4e8eB0030CD40` | Read-only helper for overview, request state, participants, submissions, and round/accounting views. |

## External Sepolia Integrations

| Integration | Address | Usage |
| --- | --- | --- |
| ENS Registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` | Used by `ENSVerifier`. |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Used by `ERC8004Adapter` for optional agent authorization checks. |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Receives optional mirrored DAIO feedback signals. |
| Uniswap v4 PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | Owns v4 pool state and invokes hooks. |
| Uniswap v4 PositionManager | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` | Used when initializing or seeding v4 liquidity. |
| Uniswap Universal Router | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` | Used by `UniswapV4SwapAdapter`. |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Used when seeding v4 liquidity through PositionManager. |

## Deployment Profile

| Setting | Fast | Standard | Critical |
| --- | --- | --- | --- |
| Review election difficulty | `10000 / 10000` | `10000 / 10000` | `10000 / 10000` |
| Audit election difficulty | `10000 / 10000` | `10000 / 10000` | `10000 / 10000` |
| Review quorum | `3` | `4` | `4` |
| Audit quorum | `3` | `4` | `4` |
| Audit obligation | each revealed reviewer audits `2` peers | each revealed reviewer audits `3` peers | each revealed reviewer audits `3` peers |
| Retry count | `1` | `1` | `2` |
| Timeout per phase | `10 minutes` | `30 minutes` | `1 hour` |

Global settings:

- Base request fee: `100 USDAIO`
- `maxActiveRequests`: `2`
- Expected reviewer count: `5`
- Fast tier is the generated-wallet operational profile used by the requester/relayer/agent setup.

## Full-Audit Flow

Audit VRF target selection is disabled. Every reviewer who reveals a review must audit every other revealed reviewer, and audit target proofs are rejected.

`setTierConfig` rejects non-full-audit settings:

- `auditElectionDifficulty` must be `10000`.
- Audit commit/reveal quorum must equal review reveal quorum.
- `auditTargetLimit` and `minIncomingAudit` must equal `reviewRevealQuorum - 1`.
- Review reveal quorum must be at least `2`.

Timeout behavior:

- Missed review reveals are slashed and Fast requests can continue as low-confidence.
- Missed audit commits are slashed when the audit commit timeout finalizes the request path.
- Retry behavior is tier-specific: Fast and Standard allow one retry; Critical allows two.

## Upgradeable Core

`DAIOCore` is deployed behind `DAIOTransparentUpgradeableProxy`. The proxy address is the canonical core address used by `PaymentRouter`, `StakeVault`, `ReviewerRegistry`, `ReputationLedger`, `DAIOCommitRevealManager`, `DAIOPriorityQueue`, `DAIORoundLedger`, and `DAIOInfoReader`.

`DAIOCore.initialize(...)` replaces constructor initialization, implementation contracts disable direct initialization, and the low-level storage slot map used by `DAIOInfoReader` is kept stable.

## Identity And Reviewers

ENS and ERC-8004 metadata are optional for participation. Reviewers can register without ENS or ERC-8004 agent IDs. If they provide those fields, the configured verifier/adapter validates them. Internal scoring and Round 2 reputation weights use `ReputationLedger`; ERC-8004 is an external mirror and optional identity source.

Reviewer stake management:

- `ReviewerRegistry.registerReviewer(...)` registers or updates reviewer metadata and deposits the supplied stake.
- `ReviewerRegistry.addStake(amount)` deposits more USDAIO without changing metadata.
- `ReviewerRegistry.withdrawStake(amount)` withdraws unlocked stake while preserving the active reviewer minimum.
- `ReviewerRegistry.getReviewers()`, `reviewerCount()`, and `reviewerAt(index)` enumerate registered reviewers.
- `ReviewerRegistry.getReviewer(reviewer)` returns registration, status, agent ID, stake, domain, counters, ENS node, and ENS name.

## Round Scoring

DAIO stores live state plus durable snapshots by request, attempt, round, and reviewer address.

| Round | Name | Purpose |
| --- | --- | --- |
| `0` | Review | Uses revealed proposal scores. Request score is the median review score. |
| `1` | AuditConsensus | Uses audit-backed consensus scoring. Reviewer weights come from consensus contribution/reliability. When a reviewer received no incoming audit (auditors timed out), their weight falls back to their own audit reliability so honest effort is still rewarded. |
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
- `DAIORoundLedger.getRoundAggregate(requestId, attempt, round)`
- `DAIORoundLedger.getReviewerRoundScore(requestId, attempt, round, reviewer)`
- `DAIORoundLedger.getReviewerRoundAccounting(requestId, attempt, round, reviewer)`
- `PaymentRouter.latestRequestByRequester(requester)`
- `PaymentRouter.latestRequestState(requester)`

`DAIOInfoReader` keeps information-only decoding outside `DAIOCore`. `DAIOCore.extsload(slot)` exists so reader contracts can inspect storage without adding many app-facing view methods to the size-constrained core bytecode.

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

ETH/ERC20 auto-conversion requests use `PaymentRouter` plus `UniswapV4SwapAdapter`. The v4 hook validates the swap after execution: allowed router, allowed pool, expected pair, known intent, and enough USDAIO output.

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
| Pool status | preserved by keeping the USDAIO token and hook addresses fixed |

## Scripts

Deployment and setup scripts support RPC fallback through `SEPOLIA_RPC_URLS`. `scripts/deploy.js` writes `deployments/sepolia.json` incrementally, so reruns reuse already deployed contracts and continue from the saved addresses.

Useful commands:

- `npm run deploy:sepolia`
- `npm run finalize:sepolia`
- `npm run setup:sepolia`
- `npm run verify:sepolia`
- `DAIO_DEPLOYMENT_FILE=deployments/sepolia.json npx hardhat run scripts/generated-wallets-fork-e2e.js`

## Verification

| Check | Result | Notes |
| --- | --- | --- |
| Compile | Passed | `npx hardhat compile` |
| Full default Hardhat suite | `43 passing`, `3 pending` | Pending suites are opt-in fork tests. |
| Sepolia finalize | Passed | Confirmed `DAIOCore` points to the current `PaymentRouter` and hook/router settings are complete. |
| Sepolia setup | Passed | Registered 5 `.env` agents, funded requester/relayer/agents, minted/approved USDAIO, and staked reviewers. |
| Sepolia setup verification | Passed | `npm run verify:sepolia` confirmed addresses, tier settings, hook routing, reviewer enumeration, stakes, and allowances. |
| Generated-wallet Sepolia fork E2E | Passed | Forked Sepolia at block `10780028`; request, review, full audit, round ledger, and finalization completed. |
