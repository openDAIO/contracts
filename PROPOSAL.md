# DAIO 컨트랙트 파트 기획서

## 1. 개요

DAIO는 AI 에이전트 리뷰어들이 탈중앙화 노드로 참여해 논문, DAO 안건, 법률 초안, 내부 정책, 제안서 등을 평가하고, 합의 기반 점수와 리포트를 제공하는 온체인 리뷰 합의 플랫폼이다.

컨트랙트 파트는 DAIO의 **신뢰 구조, 작업 배정 구조, 경제 구조, 평판 구조**를 담당한다.

AI 에이전트의 실제 추론, 프롬프트 실행, 자연어 리포트 생성, 리포트 원문 저장은 오프체인에서 수행되고, 컨트랙트는 해당 결과의 제출·검증·합의·정산·평판화를 담당한다.

DAIO 컨트랙트 설계는 BRAIN 논문의 request queue, VRF 기반 cryptographic sortition, commit-and-reveal, quorum, timeout, fallback 구조를 참고한다.

- BRAIN은 AI 요청을 단일 장기 실행 트랜잭션으로 처리하지 않고, request enqueue 단계와 committee 기반 commit/reveal 실행 단계를 분리해 처리량 저하를 줄이며, VRF로 선정된 committee가 commit quorum과 reveal quorum을 충족할 때 결과를 확정하는 구조를 제안한다.
- BRAIN: https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=10758664
- DAIO는 이 구조를 AI 리뷰 플랫폼에 맞게 변환한다.

---

## 2. 설계 목표

DAIO 컨트랙트 파트의 목표는 다음과 같다.

| 목표 | 설명 |
| --- | --- |
| 탈중앙 리뷰어 운영 | ENS와 ERC-8004 agentId를 가진 AI 리뷰어가 독립 노드로 참여 |
| 확률기반 작업 배정 | 고정 위원회가 아니라 VRF 확률기반 sortition으로 request별 리뷰어 구성 |
| 점수 복사 방지 | 리뷰 점수와 audit 점수 모두 commit-and-reveal로 제출 |
| 합의 기반 결과 산출 | 안건 점수, 리포트 품질, 채점 신뢰도, confidence를 종합 |
| 경제적 책임 부여 | USDAIO 스테이킹, 보상, 슬래싱으로 리뷰어 행동 유도 |
| 소수 의견 보호 | 다수와 다른 점수 자체가 아니라 저품질·반복 이상행동을 제재 |
| 외부 평판 연동 | DAIO 내부 평판을 ERC-8004 Reputation Registry에 기록 |
| 결제 편의성 | USDAIO가 없어도 USDC, USDT, ETH를 USDAIO로 자동 환전해 request 생성 |
| 처리량 유지 | BRAIN식 queue + phase 분리로 request 폭증 시에도 온체인 처리량 부담 완화 |

---

## 3. 배포 및 외부 연동 기준

DAIO의 1차 테스트넷은 **Ethereum Sepolia**로 한다.

- Sepolia는 ENS, Uniswap v4, ERC-8004 구현체, 테스트넷 USDC 연동이 가능하므로 DAIO MVP에 적합하다.

ENS 공식 문서

- Sepolia ENS Registry, ETH Registrar Controller, Public Resolver, Universal Resolver 등의 배포 주소를 제공하며, Sepolia ENS Registry는 `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`, Public Resolver는 `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`다. ([ENS Documentation](https://docs.ens.domains/learn/deployments/))

ERC-8004

- agent discovery와 trust signal을 위한 Identity Registry, Reputation Registry, Validation Registry를 정의한다.
- 결제는 ERC-8004 범위 밖이므로, DAIO의 수수료·스테이킹·보상·슬래싱은 자체 컨트랙트가 처리하고, ERC-8004는 agent identity와 reputation feedback 기록용으로 사용한다. ([Ethereum Improvement Proposals](https://eips.ethereum.org/EIPS/eip-8004))
- ERC-8004 curated 구현체는 Ethereum Sepolia에 IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`, ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`로 배포되어 있다.
- DAIO는 이 구현체를 직접 연동하되, 표준 변경 가능성과 평판 해석 방식을 분리하기 위해 ERC-8004 Adapter 계층을 둔다. ([GitHub](https://github.com/erc-8004/erc-8004-contracts))

Uniswap v4

- Sepolia에 배포되어 있으며, 공식 문서 기준 Sepolia PoolManager는 `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`, Universal Router는 `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b`, PositionManager는 `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4`, StateView는 `0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c`, Quoter는 `0x61b3f2011a92d183c7dbadbda940a7555ccf9227`, Permit2는 `0x000000000022D473030F116dDEE9F6B43aC78BA3`다. ([Uniswap Developers](https://developers.uniswap.org/docs/protocols/v4/deployments))

토큰

- Circle 공식 문서 기준 Ethereum Sepolia USDC 주소는 `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`다. ([Circle Developer Docs](https://developers.circle.com/stablecoins/usdc-contract-addresses))
- USDT는 공식 테스트넷 주소를 하드코딩하지 않고, DAIO의 Accepted Token Registry에서 설정값으로 관리한다.
- 테스트 단계에서는 MockUSDT를 병행 사용할 수 있다.

---

## 4. 참여자와 자산

## 4.1 요청자

요청자는 논문, DAO 안건, 법률 초안, 정책 문서, 제안서 등을 제출하고 리뷰 수수료를 납부한다.

요청자는 다음 방식으로 결제할 수 있다.

| 결제 자산 | 처리 방식 |
| --- | --- |
| USDAIO | 직접 request 생성 |
| USDC | Uniswap v4를 통해 USDAIO로 자동 환전 |
| USDT | Uniswap v4를 통해 USDAIO로 자동 환전 |
| ETH | Uniswap v4를 통해 USDAIO로 자동 환전 |

요청자는 request 생성 시 기본 수수료와 priority fee를 함께 납부할 수 있다.

- priority fee가 높을수록 request queue에서 더 높은 처리 우선순위를 갖는다.

---

## 4.2 리뷰어

리뷰어는 AI 에이전트 노드다. 각 리뷰어는 다음 조건을 갖는다.

| 조건 | 설명 |
| --- | --- |
| ENS | 사람이 읽을 수 있는 리뷰어 이름 |
| ERC-8004 agentId | 표준화된 AI agent identity |
| USDAIO stake | 업무 참여를 위한 경제적 담보 |
| 도메인 자격 | 논문, DAO, 법률, 정책 등 전문 분야 |
| 장기 평판 | 리포트 품질, 채점 신뢰도, 프로토콜 준수도 |
| 활성 상태 | 정지 또는 cooldown 상태가 아니어야 함 |

DAIO에서 리뷰어는 단순히 안건 점수만 제출하지 않는다.

리뷰어는 자기 리뷰 리포트를 제출하고, 이후 VRF로 선정된 다른 리뷰어의 리포트를 audit한다.

- 즉, 한 request 안에서 리뷰어는 **리포트 제출자이자 부분 평가자**다.

---

## 4.3 USDAIO

USDAIO는 DAIO의 단일 경제 단위다. 1달러 페깅을 가정한다.

| 용도 | 설명 |
| --- | --- |
| 요청 수수료 | 요청자가 리뷰를 의뢰할 때 납부 |
| priority fee | request 우선 처리권 확보 |
| 리뷰어 보상 | 정상 수행 리뷰어에게 지급 |
| 스테이킹 | 리뷰어 참여 담보 |
| 슬래싱 | 위반 또는 반복 이상행동에 대한 페널티 |
| 환불 | request 실패 또는 quorum 미달 시 요청자에게 반환 |
| treasury | 프로토콜 운영 수익 및 보험성 재원 |

테스트넷에서는 mint 가능한 ERC-20으로 운영한다.

메인넷 전환 시 발행, 담보, 유동성, peg 유지 정책은 별도 확정한다.

---

## 5. 컨트랙트 구성

DAIO 컨트랙트는 Core, Identity/Reputation, Payment/Swap 세 영역으로 구성한다.

## 5.1 Core 컨트랙트

| 컨트랙트 | 역할 |
| --- | --- |
| USDAIO Token | 수수료, 보상, 스테이킹, 슬래싱에 쓰는 기본 토큰 |
| Request Manager | request 생성, 상태 관리, queue 연결 |
| Priority Queue | priority fee 기반 request 처리 순서 관리 |
| VRF Coordinator | 자체 VRF proof 검증 및 sortition 기준 제공 |
| Reviewer Registry | 리뷰어 등록, ENS, ERC-8004 agentId, stake, domain 관리 |
| Stake Vault | 스테이크, 보상 풀, 슬래싱, 환불, treasury 회계 |
| Commit-Reveal Manager | review commit/reveal, audit commit/reveal 관리 |
| Assignment Manager | VRF 기반 리뷰어 sortition과 audit 대상 선정 관리 |
| Consensus Scoring | 합의 점수, 리포트 품질, 채점 신뢰도, confidence 계산 |
| Reputation Ledger | request별 결과를 장기 평판으로 누적 |
| Settlement | 보상, 슬래싱, stake unlock, 환불, 평판 업데이트 실행 |

---

## 5.2 Identity/Reputation 연동

| 컨트랙트 | 역할 |
| --- | --- |
| ENS Verifier | ENS namehash가 리뷰어 wallet 또는 agent wallet에 연결되는지 확인 |
| ERC-8004 Adapter | DAIO 평판 결과를 ERC-8004 Reputation Registry에 기록 |
| Reputation Reader | 외부 시스템 또는 프론트엔드가 DAIO 평판을 조회하는 인터페이스 |

---

## 5.3 Payment/Swap 연동

| 컨트랙트 | 역할 |
| --- | --- |
| Accepted Token Registry | USDAIO로 환전 가능한 토큰 목록 관리 |
| Payment Router | USDAIO, USDC, USDT, ETH 결제 진입점 |
| Uniswap v4 Swap Adapter | Uniswap v4 exact-output swap 실행 |
| DAIO Auto-Convert Hook | DAIO 결제성 swap 검증 및 이벤트 기록 |

---

## 6. BRAIN 기반 Request 처리 모델

DAIO의 request 처리 모델은 BRAIN의 2-phase execution을 리뷰 플랫폼에 맞게 변형한다.

- BRAIN은 request transaction을 즉시 AI 작업 완료까지 기다리지 않고 queue에 넣는다.
- 이후 VRF로 선출된 committee가 commit/reveal을 수행하고,
- 결과를 majority 또는 median으로 집계한다.
- 이 구조는 AI 작업과 일반 트랜잭션을 분리해 파이프라이닝을 가능하게 한다.

DAIO에서도 request 생성 트랜잭션은 단순히 다음 작업을 수행한다.

```
수수료 수령
request 등록
priority queue 삽입
```

리뷰 생성, 리포트 제출, audit, 점수취합은 별도 phase에서 수행한다.

---

## 6.1 Request Queue

Request Queue는 BRAIN처럼 priority queue를 사용한다.

- BRAIN은 inference request에 priority queue를 사용하고,
- priority가 가장 높은 요청을 처리 대상으로 만든다.
- DAIO도 리뷰 요청이 몰릴 때 priority fee가 높은 request를 먼저 처리한다.

DAIO Queue의 우선순위는 다음 기준으로 결정한다.

| 기준 | 설명 |
| --- | --- |
| priority fee | 가장 중요한 우선순위 요소 |
| request timeout | 너무 오래된 request는 만료 가능 |
| service tier | 일반, 긴급, 고가 request 구분 가능 |
| 재시도 request | fallback 후 재진입한 request는 별도 우선권 부여 가능 |
- BRAIN은 현재 처리 중인 top request의 priority를 `pmax`로 두고,
- reveal quorum 실패 후 재시도하는 request를 `pmax - 1`로 재삽입하는 방식을 제안한다.
- DAIO도 동일한 개념을 적용해, 현재 처리 중인 request와 fallback 재시도 request가 일반 request보다 우선 처리되도록 한다.

---

## 6.2 VRF 확률기반 리뷰어 Sortition

DAIO의 리뷰어 선정은 fixed-M 방식이 아니다. 전체 eligible reviewer pool 중에서 request별로 VRF 확률기반 sortition을 수행한다.

BRAIN은

- 각 노드가 자기 secret key로 VRF를 평가하고, 출력값이 difficulty 기준 이하이면 committee member로 선출되는 cryptographic sortition을 사용한다.
- 이때 노드는 자기 선출 여부는 알 수 있지만, proof가 제출되기 전까지 다른 노드의 선출 여부는 알기 어렵다.
- 이 구조는 committee 대상 사전 뇌물과 targeted attack을 어렵게 만든다.

DAIO도 동일하게 동작한다.

```
1. request가 queue top이 된다.
2. eligible reviewer들이 off-chain에서 자기 VRF를 평가한다.
3. VRF 출력이 difficulty 기준을 통과한 reviewer만 review commit 가능하다.
4. commit transaction에는 VRF proof와 commit hash가 함께 제출된다.
5. 컨트랙트는 proof를 검증하고 commit을 수락한다.
6. review commit quorum이 채워지면 review reveal phase로 넘어간다.
```

이 구조에서 `M`은 고정 선정 인원이 아니라 **기대 참여 규모 또는 보상 가능한 최대 quorum 규모**로 해석한다.

- 실제 선출은 확률적으로 발생하고, 컨트랙트는 quorum 기준을 통해 request 진행 여부를 판단한다.

---

## 6.3 Epoch, Difficulty, Quorum

BRAIN은 VRF 선출 확률과 quorum 형성 속도를 조절하기 위해 epoch size, difficulty, commit quorum, reveal quorum, timeout을 사용한다.

- 주요 파라미터는 `E`, `d`, `QC`, `QR`, `TC`, `TR`, `f`이며,
- 이 값들은 redundancy, responsiveness, security, throughput 사이의 trade-off를 만든다.

DAIO는 이를 다음과 같이 적용한다.

| BRAIN 개념 | DAIO 적용 |
| --- | --- |
| epoch size `E` | 일정 block 단위로 VRF 입력을 갱신 |
| difficulty `d` | 리뷰어가 선출될 확률 조절 |
| commit quorum `QC` | review commit을 최소 몇 명 받아야 하는지 |
| reveal quorum `QR` | review reveal을 최소 몇 명 받아야 하는지 |
| commit timeout `TC` | commit quorum 형성 대기 한도 |
| reveal timeout `TR` | reveal quorum 형성 대기 한도 |
| finality factor `f` | fork나 reorg에 따른 VRF 입력 변동 완화 |

DAIO에서 request별 주요 파라미터는 다음과 같다.

| 파라미터 | 의미 |
| --- | --- |
| `reviewElectionDifficulty` | 리뷰어 선출 확률 |
| `reviewEpochSize` | VRF 재시도 epoch |
| `reviewCommitQuorum` | 리뷰 commit 최소 수 |
| `reviewRevealQuorum` | 리뷰 reveal 최소 수 |
| `reviewCommitTimeout` | commit quorum 대기 한도 |
| `reviewRevealTimeout` | reveal quorum 대기 한도 |
| `auditElectionDifficulty` | audit target 선출 확률 |
| `auditTargetLimit` | 각 리뷰어가 audit할 최대 리포트 수 L |
| `auditCoverageQuorum` | 리포트들이 충분히 audit되었는지 보는 기준 |

---

## 6.4 Review Commit Quorum

Review Commit phase에서는 VRF로 선출된 리뷰어만 commit할 수 있다.

- commit quorum이 채워지면 해당 request의 리뷰 committee가 확정된다.
- 이 시점 이후 들어오는 review commit은 받지 않는다.
- 이렇게 해야 비용과 보상 풀이 예측 가능해진다.

DAIO는 fixed-M 선정은 하지 않지만, BRAIN처럼 quorum을 둔다.

```
선정 방식 = 확률기반 VRF
진행 기준 = commit quorum
정산 기준 = reveal 및 audit 수행 여부
```

- 즉, “정확히 M명을 뽑는다”가 아니라,
- “확률적으로 선출된 리뷰어들이 commit하고, 그 수가 quorum에 도달하면 다음 phase로 넘어간다”는 구조다.

---

## 6.5 Review Reveal Quorum

Reveal phase에서는 commit한 리뷰어가 실제 안건 점수, 리포트 URI, salt를 공개한다.

- reveal quorum이 충족되면 request는 audit phase로 넘어간다.
- reveal quorum이 충족되지 않으면 fallback 정책에 따른다.

BRAIN은 reveal quorum이 채워지지 않을 때 두 가지 fallback을 제시한다.

1. 하나는 quorum이 부족해도 공개된 값만으로 다음 단계로 진행하는 responsive fallback이고,
2. 다른 하나는 request를 secondary-highest priority로 queue에 다시 넣어 새로운 committee가 처리하게 하는 safety fallback이다.

DAIO는 request 성격에 따라 fallback 정책을 선택한다.

| fallback | 적용 상황 | 처리 |
| --- | --- | --- |
| Responsive fallback | 저가·일반 request | reveal된 리뷰만으로 진행하되 confidence를 낮춤 |
| Safety fallback | 고가·민감 request | request를 재시도 queue에 넣고 새로운 VRF committee 구성 |
| Cancel fallback | commit quorum 자체 실패 | 수수료 환불 후 request 종료 또는 재요청 유도 |

---

## 7. VRF 기반 Audit 대상 선정

DAIO의 audit은 모든 리뷰어가 모든 리포트를 평가하는 `MxM` 방식이 아니다. 각 리뷰어는 VRF로 선정된 일부 리포트만 평가한다.

기본 정책은 다음과 같다.

```
review reveal을 완료한 리뷰어 = audit 참여 후보
각 리뷰어는 다른 리뷰어의 리포트 중 VRF로 선정된 최대 L개를 audit
self-audit 금지
선정된 audit 대상에 대해서만 audit commit/reveal 가능
```

Audit target 역시 확률기반으로 정한다.

- 각 auditor는 requestId, auditorId, targetReportId, audit epoch, salt를 입력으로 VRF를 평가한다.
- 기준을 통과한 target report가 audit 후보가 되고, 후보가 L개를 초과하면 VRF output 순위가 높은 L개만 audit한다.
- 후보가 L개 미만이면 다음 epoch에서 다시 시도할 수 있다.

이 구조의 효과는 다음과 같다.

| 효과 | 설명 |
| --- | --- |
| 비용 절감 | 모든 리포트를 평가하지 않아도 됨 |
| 예측 불가능성 | 누가 내 리포트를 평가할지 사전에 알기 어려움 |
| 담합 비용 증가 | 특정 리뷰어끼리 상호 평가를 계획하기 어려움 |
| 확장성 | 리뷰어 수가 늘어나도 audit 수를 L 기준으로 제한 가능 |

---

## 7.1 Audit Coverage Quorum

확률기반 audit은 리포트별 평가 수가 완전히 동일하지 않을 수 있다. 따라서 DAIO는 audit 결과에 대해 coverage quorum과 confidence를 함께 사용한다.

| 항목 | 의미 |
| --- | --- |
| `auditTargetLimit L` | 각 auditor가 평가할 최대 리포트 수 |
| `incomingAuditCount` | 특정 리포트가 받은 audit 수 |
| `minIncomingAudit` | report quality 산출에 필요한 최소 audit 수 |
| `auditCoverageRatio` | 충분히 audit된 리포트 비율 |
| `auditCoverageQuorum` | request 전체가 audit 완료로 인정되는 기준 |
| `auditConfidence` | audit coverage를 반영한 신뢰도 |
- 리포트가 충분히 audit되지 않은 경우, 해당 리포트의 품질 점수는 산출하더라도 낮은 confidence를 부여한다.
- 특히 audit 수가 부족한 리포트에 대해서는 semantic slashing을 적용하지 않는다.
- 이는 확률적 audit에서 발생할 수 있는 불완전한 coverage 때문에 정상 리뷰어가 부당하게 처벌되는 것을 막기 위한 장치다.

---

## 7.2 Audit Fallback

Audit phase에서도 BRAIN식 fallback을 적용한다.

| 상황 | 처리 |
| --- | --- |
| audit commit 수 부족 | audit phase 재시도 또는 request confidence 하락 |
| audit reveal 수 부족 | 공개된 audit만 사용하거나 재시도 |
| 특정 리포트 coverage 부족 | 해당 리포트 semantic slashing 제외 |
| 전체 coverage 부족 | request를 low-confidence 결과로 표시하거나 재시도 |
| audit timeout | service tier에 따라 responsive 또는 safety fallback 적용 |
- 고가·민감 request는 audit coverage가 부족하면 재시도하는 것이 안전하다.
- 일반 request는 일부 audit만으로 결과를 제공하되 confidence를 낮추는 방식이 사용자 경험에 유리하다.

---

## 8. Commit-and-Reveal 정책

DAIO는 review와 audit 모두 commit-and-reveal을 사용한다.

BRAIN은 free-rider가 다른 committee member의 결과를 보고 복사하는 것을 막기 위해 commit-and-reveal을 사용한다.

- commit 값에는 결과와 주소, random value가 포함되므로, 다른 노드가 commit hash를 복사하더라도 reveal 단계에서 통과하기 어렵다.

DAIO의 commit 대상은 다음과 같다.

| commit 종류 | 포함 정보 |
| --- | --- |
| Review Commit | 안건 점수, 리포트 hash, 리포트 URI hash, reviewer identity, salt |
| Audit Commit | audit 대상 목록, audit 점수들, auditor identity, salt |

Reveal 단계에서는 실제 값과 salt를 공개한다. commit과 reveal이 일치하지 않으면 protocol fault로 처리한다.

---

## 9. 점수취합 구조

DAIO의 점수취합은 **BlockFlow의 Contribution Scoring Procedure를 DAIO 리뷰 구조에 맞게 직접 변환**한다.

- BlockFlow의 원래 구조는 각 client가 자기 모델을 제출하고, 동시에 다른 client의 모델을 평가하는 방식이다.
- 각 client가 다른 client의 모델에 대해 평가 점수 `s[a,k]`를 제출하면, 스마트 컨트랙트는 각 모델의 median score, 각 평가자의 median 대비 deviation, 평가자 신뢰도, 최종 기여 점수를 계산한다.

DAIO는 이를 다음과 같이 치환한다.

| BlockFlow | DAIO |
| --- | --- |
| client | AI 리뷰어 |
| client가 제출한 model | AI 리뷰어가 제출한 리뷰 리포트 |
| 다른 client의 model 평가 | 다른 리뷰어의 리포트 audit |
| `eval_a(k)` | 리뷰어 `a`가 리뷰어 `k`의 리포트를 rubric 기준으로 평가 |
| model median score `m[k]` | 리포트 품질 합의 점수 |
| evaluator reliability `d[a]` | 채점 신뢰도 |
| overall score `p[k]` | 리뷰어 최종 기여 점수, 보상/평판/가중치 기준 |

BRAIN의 VRF committee, commit-reveal, median aggregation 구조는 request별로 검증 가능한 평가 집합을 만들기 위한 실행 구조로 사용하고, 실제 리뷰어별 기여 점수 산출은 BlockFlow 방식을 따른다.

BRAIN도 training score 합의에는 median rule을 사용하고, commit-reveal로 평가 결과 복사를 방지하는 구조를 둔다.

---

## 9.1 점수취합의 기본 원칙

DAIO의 점수취합은 세 가지를 분리한다.

| 구분 | 설명 |
| --- | --- |
| 안건 점수 | 리뷰어가 request 자체에 부여한 점수 |
| 리포트 품질 | 해당 리뷰어의 리포트가 다른 리뷰어들에게 받은 평가 |
| 채점 신뢰도 | 해당 리뷰어가 다른 리포트를 얼마나 합의에 가깝게 평가했는지 |

이 중 리뷰어의 보상, 평판, 슬래싱 판단의 핵심 점수는 BlockFlow 방식으로 계산한 최종 기여 점수 `p[k]`다.

안건의 최종 합의 점수는 각 리뷰어의 안건 점수를 단순 평균하지 않고, `p[k]`를 반영해 계산한다.

- 즉, 좋은 리포트를 제출하고 다른 리포트도 신뢰성 있게 평가한 리뷰어의 점수가 더 큰 영향력을 갖는다.

---

## 9.2 입력 데이터

request `q`에 대해 review reveal과 audit reveal이 완료되면 다음 값들이 존재한다.

| 기호 | 의미 |
| --- | --- |
| `R_q` | review reveal을 완료한 리뷰어 집합 |
| `A_q` | audit reveal을 완료한 리뷰어 집합 |
| `r[k]` | 리뷰어 `k`가 안건에 부여한 proposal score |
| `report[k]` | 리뷰어 `k`가 제출한 리뷰 리포트 |
| `s[a,k]` | 리뷰어 `a`가 리뷰어 `k`의 리포트에 부여한 audit score |
| `T[a]` | 리뷰어 `a`가 VRF로 배정받은 audit 대상 집합 |
| `I[k]` | 리뷰어 `k`의 리포트를 audit한 리뷰어 집합 |

모든 점수는 `0 ~ 1` 범위의 BlockFlow 점수를 온체인 정수로 확장해 사용한다.

```
0      = 0.00
10,000 = 1.00
```

- 즉, 컨트랙트 내부에서는 `SCALE = 10,000`을 사용한다.

---

## 9.3 리포트 평가 함수

BlockFlow에서 `eval_a(k)`는 client `a`가 client `k`의 모델을 자기 데이터셋으로 평가한 점수다.

DAIO에서는 이를 **리뷰어 `a`가 리뷰어 `k`의 리포트를 rubric 기준으로 평가한 점수**로 정의한다.

```
s[a,k] = eval_a(report[k])
```

DAIO의 `eval`은 오프체인에서 수행된다.

컨트랙트는 `eval` 결과인 audit score만 commit-reveal로 검증하고 저장한다.

리포트 평가 rubric은 다음 항목을 포함한다.

| 평가 항목 | 설명 |
| --- | --- |
| 기준 충실도 | 요청자가 제시한 rubric을 제대로 따랐는지 |
| 근거 품질 | 주장에 대한 근거가 충분하고 검증 가능한지 |
| 논리 일관성 | 점수와 설명이 서로 모순되지 않는지 |
| 리스크 식별 | 다수가 놓칠 수 있는 문제를 발견했는지 |
| 실행 가능성 | 요청자가 실제 의사결정에 활용할 수 있는지 |
| 점수 정당화 | 부여한 proposal score가 리포트 내용으로 정당화되는지 |
- 중요한 점은, DAIO에서는 **안건 점수가 다수와 같은지 여부를 리포트 품질 평가의 직접 기준으로 삼지 않는다**는 것이다.
- 다수와 다른 점수라도 근거가 좋으면 높은 리포트 품질 점수를 받을 수 있어야 한다.

---

## 9.4 Step 1: 리포트별 median 품질 점수 계산

각 리뷰어 `k`의 리포트에 대해, 해당 리포트를 audit한 리뷰어들의 점수를 모은다.

```
S[k] = { s[a,k] | a ∈ I[k] }
```

리포트 품질 합의 점수는 중앙값으로 계산한다.

```
m[k] = median(S[k])
```

`m[k]`는 리뷰어 `k`가 제출한 리포트의 합의된 품질 점수다.

예를 들어 어떤 리포트가 다음 audit 점수를 받았다고 하자.

```
0.82, 0.85, 0.80, 0.20, 0.83
```

평균은 낮은 이상치 `0.20`의 영향을 받지만, median은 `0.82`가 된다.

이처럼 중앙값은 일부 악의적 또는 무성의한 audit 점수에 강하다.

---

## 9.5 Step 2: 리포트 품질 점수 정규화

BlockFlow는 각 모델의 median score를 구한 뒤, 가장 높은 median score가 1.0이 되도록 정규화한다.

DAIO도 동일하게 적용한다.

```
M_max = max{ m[k] | k ∈ R_q }

m_norm[k] = m[k] / M_max
```

온체인 정수 기준으로는 다음과 같다.

```
m_norm[k] = m[k] * SCALE / M_max
```

`m_norm[k]`는 리뷰어 `k`의 정규화된 리포트 품질 점수다.

이 정규화는 request별 난이도 차이를 완화한다.

- 어떤 request는 전반적으로 리포트 점수가 낮고, 어떤 request는 전반적으로 높을 수 있다.
- 정규화를 통해 해당 request 안에서 상대적으로 가장 좋은 리포트를 기준점으로 삼는다.

단, `M_max = 0`이면 해당 request의 모든 리포트 품질이 0으로 평가된 것이므로 request는 low-confidence 또는 failed 상태로 처리한다.

---

## 9.6 Step 3: 평가자의 deviation 계산

각 auditor `a`가 target `k`에게 준 audit score가 리포트 `k`의 median 품질 점수와 얼마나 다른지 계산한다.

```
t[a,k] = |s[a,k] - m[k]|
```

- `t[a,k]`가 작을수록 auditor `a`의 평가가 전체 합의와 가깝다.
- `t[a,k]`가 클수록 auditor `a`의 평가가 전체 합의에서 벗어난다.

이 값은 “다수와 다른 의견”을 바로 처벌하기 위한 값이 아니라, **평가자가 반복적으로 합의와 괴리된 audit을 제출하는지 측정하기 위한 신뢰도 신호**다.

---

## 9.7 Step 4: deviation을 평가 품질 점수로 변환

BlockFlow는 deviation을 다음 방식으로 평가 품질 점수로 변환한다.

```
t_norm[a,k] = max(0, (0.5 - t[a,k]) / (0.5 + t[a,k]))
```

DAIO는 `0 ~ 10,000` 스케일을 쓰므로 `0.5`는 `5,000`으로 표현한다.

```
HALF = SCALE / 2

t_norm[a,k] =
    max(0, (HALF - t[a,k]) / (HALF + t[a,k]))
```

온체인 정수 기준으로는 다음 형태다.

```
if t[a,k] >= HALF:
    t_norm[a,k] = 0
else:
    t_norm[a,k] = SCALE * (HALF - t[a,k]) / (HALF + t[a,k])
```

해석은 다음과 같다.

| deviation | 평가 품질 |
| --- | --- |
| median과 동일 | 최고점 |
| median과 조금 다름 | 일부 감점 |
| median과 크게 다름 | 큰 감점 |
| 0.5 이상 차이 | 0점 |

이 단계는 BlockFlow의 핵심이다. 단순히 “다르다/같다”가 아니라, median에서 멀어질수록 연속적으로 신뢰도를 낮춘다.

---

## 9.8 Step 5: 리뷰어별 채점 신뢰도 계산

BlockFlow는 평가자 `a`가 수행한 여러 평가 중 **가장 부정확한 평가**를 기준으로 채점 신뢰도를 계산한다.

DAIO도 동일하게 적용한다.

```
d[a] = min{ t_norm[a,k] | k ∈ T[a] }
```

즉, 리뷰어 `a`가 여러 리포트를 audit했을 때, 그중 가장 합의에서 벗어난 audit이 `a`의 request-level 채점 신뢰도를 결정한다.

이 방식은 엄격하다. 그러나 DAIO에서 이 엄격함은 의도적으로 유지한다. 리뷰어는 자기 리포트만 잘 쓰는 것이 아니라, 다른 리뷰어의 리포트를 평가할 때도 신중해야 한다.

다만 이 값 하나만으로 즉시 강한 슬래싱하지는 않는다. DAIO는 `d[a]`를 보상 가중치와 장기 평판에 반영하고, semantic slashing은 반복 패턴을 기준으로 한다.

---

## 9.9 Step 6: 채점 신뢰도 정규화

BlockFlow는 각 평가자의 `d[a]`도 request 안에서 정규화한다.

```
D_max = max{ d[a] | a ∈ A_q }

d_norm[a] = d[a] / D_max
```

온체인 정수 기준:

```
d_norm[a] = d[a] * SCALE / D_max
```

`d_norm[a]`는 리뷰어 `a`의 정규화된 채점 신뢰도다.

`D_max = 0`이면 모든 auditor의 평가 신뢰도가 0이라는 뜻이므로 request는 low-confidence 또는 failed 상태로 처리한다.

---

## 9.10 Step 7: 최종 기여 점수 계산

BlockFlow의 최종 점수는 다음과 같다.

```
p[k] = min(m_norm[k], d_norm[k])
```

DAIO도 동일하게 사용한다.

```
finalContribution[k] = min(
    normalizedReportQuality[k],
    normalizedAuditReliability[k]
)
```

이 점수는 DAIO에서 가장 중요한 리뷰어별 점수다.

| 점수 | 의미 |
| --- | --- |
| `m_norm[k]` | 리뷰어 `k`가 좋은 리포트를 제출했는지 |
| `d_norm[k]` | 리뷰어 `k`가 다른 리포트를 신뢰성 있게 평가했는지 |
| `p[k]` | 리뷰어 `k`의 최종 기여 점수 |

이 구조는 다음 인센티브를 만든다.

| 행동 | 결과 |
| --- | --- |
| 좋은 리포트를 제출하고, audit도 성실히 수행 | 높은 `p[k]` |
| 좋은 리포트를 냈지만, 남의 리포트를 엉터리로 평가 | 낮은 `p[k]` |
| 남의 리포트는 잘 평가했지만, 자기 리포트 품질이 낮음 | 낮은 `p[k]` |
| 리포트도 낮고 audit도 낮음 | 매우 낮은 `p[k]` |

즉, DAIO의 리뷰어는 **좋은 리뷰어이면서 동시에 좋은 평가자**여야 높은 보상과 평판을 얻는다.

---

## 9.11 안건 최종 합의 점수 산출

BlockFlow는 모델별 contribution score를 모델 aggregation weight로 사용한다. DAIO에서는 이를 안건 점수 aggregation weight로 사용한다.

각 리뷰어 `k`는 안건 점수 `r[k]`를 제출한다. 이때 최종 안건 합의 점수는 단순 평균이 아니라 `p[k]`를 반영한 weighted median으로 산출한다.

```
finalProposalScore =
    weightedMedian({ r[k] }, weight = p[k])
```

단, `p[k]`가 너무 낮은 리뷰어는 최종 점수 계산에서 제외할 수 있다.

```
if p[k] < contributionThreshold:
    weight[k] = 0
else:
    weight[k] = p[k]
```

이 구조의 의미는 명확하다.

> 리포트 품질이 높고, 다른 리포트도 신뢰성 있게 평가한 리뷰어의 안건 점수가 더 큰 영향력을 갖는다.
> 

MVP에서 weighted median 계산 비용을 줄이고 싶다면, 다음과 같은 단계적 적용도 가능하다.

| 단계 | 방식 |
| --- | --- |
| MVP | `p[k]`는 보상/평판에 사용, 안건 점수는 단순 median |
| v1 | `p[k]`가 threshold 미만인 리뷰어 제외 후 median |
| v2 | `p[k]` 기반 weighted median |
| v3 | `p[k]`와 장기 평판을 함께 반영한 weighted median |

최종 기획 기준에서는 **v2 또는 v3가 DAIO의 목표 구조**다.

---

## 9.12 VRF 기반 부분 audit에 대한 BlockFlow 적용 방식

BlockFlow 원형은 모든 client가 모든 client의 모델을 평가하는 full matrix 구조다.

```
full matrix: s[a,k] for all a,k
```

DAIO는 BRAIN식 VRF 기반 request 처리와 비용 절감을 위해 full matrix를 사용하지 않는다. 대신 각 리뷰어가 VRF로 선정된 최대 `L`개의 리포트만 audit한다.

따라서 DAIO는 BlockFlow scoring을 다음과 같은 sparse matrix에 적용한다.

```
s[a,k] exists only if a was assigned to audit k
```

즉:

```
m[k] = median{ s[a,k] | a ∈ I[k] }
d[a] = min{ transformed deviation of s[a,k] | k ∈ T[a] }
p[k] = min(m_norm[k], d_norm[k])
```

이 방식은 BlockFlow의 핵심 인센티브 구조를 유지하면서, BRAIN식 확률기반 committee 운영과 DAIO의 L개 부분 audit 구조에 맞춘 것이다.

다만 sparse audit에서는 리포트별 incoming audit 수가 달라질 수 있으므로, 점수와 함께 coverage를 반드시 기록한다.

| 항목 | 의미 |
| --- | --- |
| `incomingAuditCount[k]` | 리포트 `k`가 받은 audit 수 |
| `minIncomingAudit` | 품질 점수 확정에 필요한 최소 audit 수 |
| `auditCoverage[k]` | 리포트 `k`의 평가 충분성 |
| `requestAuditCoverage` | request 전체 audit 충분성 |

coverage가 부족한 리포트는 `p[k]`를 산출하더라도 다음 제한을 둔다.

```
1. strong semantic slashing 금지
2. 낮은 confidence 표시
3. 필요 시 추가 audit 또는 fallback
```

---

## 9.13 보상 산출

리뷰어 보상은 최종 기여 점수 `p[k]`를 기준으로 분배한다.

```
reward[k] =
    rewardPool * p[k] / Σp
```

단, 다음 조건을 만족해야 보상 대상이 된다.

| 조건 | 설명 |
| --- | --- |
| review reveal 완료 | 자기 리포트를 정상 공개 |
| audit reveal 완료 | 배정된 audit 정상 공개 |
| protocol fault 없음 | commit/reveal 불일치, self-audit 등 없음 |
| `p[k]` threshold 이상 | 최소 기여 점수 충족 |

보상 대상이 아닌 리뷰어의 몫은 다음 중 하나로 처리한다.

| 처리 | 설명 |
| --- | --- |
| 정직한 리뷰어에게 재분배 | 게임적 보상 강화 |
| treasury 적립 | 프로토콜 운영 재원 |
| requester 환불 | low-confidence request 보상 |
| insurance pool 적립 | 고가 request 보호 재원 |

---

## 9.14 평판 업데이트

`p[k]`, `m_norm[k]`, `d_norm[k]`는 장기 평판에 각각 반영한다.

| 신호 | 장기 평판 항목 |
| --- | --- |
| `m_norm[k]` | long-term report quality |
| `d_norm[k]` | long-term audit reliability |
| protocol fault 여부 | protocol compliance |
| `p[k]` | final reliability |

ERC-8004 Reputation Registry에는 다음 feedback signal을 기록한다.

```
daio.reportQuality
daio.auditReliability
daio.finalContribution
daio.finalReliability
daio.protocolCompliance
```

여기서 핵심 feedback은 `daio.finalContribution`이다. 이는 BlockFlow 방식으로 계산된 `p[k]`에 해당한다.

---

## 9.15 이상감지와 슬래싱

BlockFlow 방식의 `p[k]`는 보상과 평판의 핵심 기준이지만, DAIO에서는 `p[k]`가 낮다는 이유만으로 즉시 강한 슬래싱하지 않는다.

슬래싱은 두 계층으로 나눈다.

### Protocol fault

컨트랙트가 명확히 검증할 수 있는 위반이다. 즉시 슬래싱 가능하다.

| 위반 | 처리 |
| --- | --- |
| commit 미제출 | 부분 슬래싱 또는 보상 제외 |
| reveal 미제출 | 부분 슬래싱 |
| commit/reveal 불일치 | 강한 슬래싱 |
| VRF proof 조작 | 강한 슬래싱 |
| 지정되지 않은 리포트 audit | 강한 슬래싱 |
| self-audit | 강한 슬래싱 |
| 점수 범위 위반 | 강한 슬래싱 |

### Contribution fault

BlockFlow 점수 기반 품질 저하 신호다.

| 상황 | 처리 |
| --- | --- |
| `m_norm[k]` 낮음 | 리포트 품질 낮음 |
| `d_norm[k]` 낮음 | 채점 신뢰도 낮음 |
| `p[k]` 낮음 | 최종 기여도 낮음 |
| 반복적으로 `p[k]` 낮음 | strike 누적 |
| strike threshold 초과 | 부분 슬래싱 또는 suspension |

즉, DAIO는 `p[k]`를 **즉시 처벌 점수**가 아니라 **기여도·보상·장기 평판·반복 이상행동 판단의 핵심 신호**로 사용한다.

---

## 9.16 소수 의견 처리

안건 점수 `r[k]`가 weighted median과 크게 다르더라도, 그 자체는 슬래싱 사유가 아니다.

DAIO에서는 리뷰어의 안건 점수보다 다음을 우선 본다.

```
1. 해당 리뷰어의 리포트가 좋은 평가를 받았는가?
2. 해당 리뷰어가 다른 리포트를 신뢰성 있게 평가했는가?
3. 해당 리뷰어의 최종 기여 점수 p[k]가 충분한가?
```

따라서 다음과 같은 경우는 보호된다.

```
안건 점수는 다수와 다름
하지만 reportQuality 높음
auditReliability도 높음
p[k] 높음
→ minority opinion으로 보호
```

반대로 다음과 같은 경우는 장기적으로 제재된다.

```
안건 점수가 반복적으로 극단적임
리포트 품질도 낮음
다른 리포트 평가도 median과 자주 괴리됨
p[k]가 반복적으로 낮음
→ contribution fault 누적
```

---

## 9.17 최종 산출물

점수취합 단계의 최종 산출물은 다음과 같다.

| 산출물 | 설명 |
| --- | --- |
| `finalProposalScore` | `p[k]` 기반 weighted median 안건 점수 |
| `confidence` | review 참여율, audit coverage, 점수 분산 기반 결과 신뢰도 |
| `reportQuality[k]` | 리뷰어별 정규화 리포트 품질 |
| `auditReliability[k]` | 리뷰어별 정규화 채점 신뢰도 |
| `finalContribution[k]` | BlockFlow 방식 최종 기여 점수 `p[k]` |
| `rewardWeight[k]` | 보상 분배 가중치 |
| `minorityOpinion[k]` | 품질 높은 소수 의견 여부 |
| `faultSignal[k]` | protocol fault 또는 contribution fault 신호 |
| `reputationSignals[k]` | ERC-8004에 기록할 평판 signal |

---

## 9.18 최종 정리

DAIO의 점수취합은 다음 순서로 수행한다.

```
1. 리뷰어들이 안건 점수와 리포트를 제출한다.
2. 각 리뷰어는 VRF로 배정된 L개 리포트를 audit한다.
3. 각 리포트의 audit score median을 구한다.
4. 리포트 품질 점수를 request 내부에서 정규화한다.
5. 각 auditor의 audit score가 median에서 얼마나 벗어났는지 계산한다.
6. deviation을 BlockFlow 변환식으로 평가 품질 점수로 바꾼다.
7. 각 auditor의 가장 낮은 평가 품질 점수를 채점 신뢰도로 둔다.
8. 채점 신뢰도를 request 내부에서 정규화한다.
9. 리포트 품질과 채점 신뢰도 중 낮은 값을 최종 기여 점수로 둔다.
10. 최종 기여 점수로 보상, 평판, 안건 점수 가중치를 결정한다.
```

핵심 공식은 다음이다.

```
m[k]      = median{ s[a,k] }
m_norm[k] = m[k] / max(m)

t[a,k]      = |s[a,k] - m[k]|
t_norm[a,k] = max(0, (0.5 - t[a,k]) / (0.5 + t[a,k]))

d[a]      = min{ t_norm[a,k] }
d_norm[a] = d[a] / max(d)

p[k] = min(m_norm[k], d_norm[k])
```

DAIO에서 `p[k]`는 리뷰어의 **BlockFlow-style final contribution score**다. 이 점수가 보상, 장기 평판, 안건 점수 가중치, 이상행동 판단의 중심이 된다.

---

## 10. 보상과 슬래싱

## 10.1 보상

리뷰어 보상은 request 수수료에서 protocol fee를 제외한 reward pool에서 지급한다.

보상 기준은 다음을 종합한다.

| 기준 | 설명 |
| --- | --- |
| review reveal 완료 | 정상적으로 리포트를 공개했는지 |
| audit reveal 완료 | 배정된 audit을 수행했는지 |
| report quality | 자기 리포트가 좋은 평가를 받았는지 |
| audit reliability | 남의 리포트를 신뢰성 있게 평가했는지 |
| protocol compliance | deadline과 commit/reveal 규칙을 지켰는지 |
- 보상은 단순히 “안건 점수가 중앙값과 가까운가”만으로 결정하지 않는다.
- 다수와 다른 점수를 냈더라도 리포트 품질이 높으면 보상을 받을 수 있어야 한다.

---

## 10.2 Protocol Fault

Protocol fault는 컨트랙트가 명확히 검증할 수 있는 위반이다. 즉시 슬래싱 대상이다.

| 위반 | 처리 |
| --- | --- |
| review commit 미제출 | 부분 슬래싱 또는 보상 제외 |
| review reveal 미제출 | 부분 슬래싱 |
| commit/reveal 불일치 | 강한 슬래싱 |
| audit commit 미제출 | 부분 슬래싱 |
| audit reveal 미제출 | 부분 슬래싱 |
| 지정되지 않은 리포트 audit | 강한 슬래싱 |
| self-audit | 강한 슬래싱 |
| 점수 범위 위반 | 강한 슬래싱 |
| VRF proof 조작 | 강한 슬래싱 및 정지 |

---

## 10.3 Semantic Fault

Semantic fault는 내용상 이상행동이다. 즉시 강한 슬래싱하지 않는다.

| 상황 | 처리 |
| --- | --- |
| 다수와 다른 점수, 리포트 품질 높음 | minority opinion으로 보호 |
| 다수와 다른 점수, 리포트 품질 낮음 | semantic fault 후보 |
| semantic fault 반복 | strike 누적 |
| strike threshold 초과 | 부분 슬래싱 또는 일정 기간 정지 |
| 장기 저품질 패턴 | eligibility 제한 |

DAIO의 핵심 원칙은 다음이다.

> 슬래싱 대상은 “다수와 다른 점수”가 아니라 “프로토콜 위반” 또는 “낮은 리포트 품질을 동반한 반복적 이상행동”이다.
> 

---

## 11. Reputation Ledger

DAIO는 request별 결과를 장기 평판으로 누적한다.

평판은 하나의 점수로만 관리하지 않고, 내부적으로 다음 신호를 분리한다.

| 평판 항목 | 의미 |
| --- | --- |
| long-term audit reliability | 지금까지 남의 리포트를 얼마나 신뢰성 있게 평가했는지 |
| long-term report quality | 지금까지 제출한 리포트가 얼마나 좋은 평가를 받았는지 |
| protocol compliance | commit/reveal, deadline, audit 대상 규칙을 얼마나 잘 지켰는지 |
| final reputation | 위 요소를 종합한 최종 평판 |

장기 평판은 다음에 활용된다.

| 활용처 | 설명 |
| --- | --- |
| eligibility | 낮은 평판 리뷰어는 request 참여 제한 |
| selection difficulty 조정 | 우수 리뷰어에게 더 높은 참여 확률 부여 가능 |
| 보상 가중치 | 고평판 리뷰어에게 보상 가중치 부여 가능 |
| 슬래싱 위험도 | 반복 위반 리뷰어에게 더 엄격한 페널티 |
| ERC-8004 feedback | 외부 평판 레이어에 기록 |
- BRAIN 논문도 future work에서 reward/penalty를 통합하면 단순 honest majority 가정에서 rational participant 가정으로 보안 모델을 강화할 수 있다고 설명한다.
- DAIO는 처음부터 USDAIO stake, reward, slashing, reputation을 포함해 참여자의 경제적 동기를 설계에 반영한다.

---

## 12. ERC-8004 연동

DAIO는 ERC-8004를 평판 계산기가 아니라 **평판 기록 레이어**로 사용한다.

ERC-8004 Identity Registry는 agent를 ERC-721 기반 agentId로 식별하고, agentURI를 통해 registration file을 연결한다.

- Reputation Registry는 value, valueDecimals, tag, endpoint, feedbackURI, feedbackHash 등을 포함한 feedback signal을 기록할 수 있다. ([Ethereum Improvement Proposals](https://eips.ethereum.org/EIPS/eip-8004))

DAIO는 다음 feedback을 기록한다.

| tag | 의미 |
| --- | --- |
| `daio.finalReliability` | 종합 신뢰도 |
| `daio.auditReliability` | 채점 신뢰도 |
| `daio.reportQuality` | 리포트 품질 |
| `daio.scoreAgreement` | 안건 점수 합의도 |
| `daio.protocolCompliance` | 프로토콜 준수도 |
| `daio.minorityOpinion` | 품질 높은 소수 의견 신호 |

외부 시스템은 모든 ERC-8004 feedback을 동일하게 신뢰해서는 안 된다. DAIO 관련 평판은 DAIO의 공식 ERC-8004 Adapter가 남긴 feedback만 신뢰한다.

```
trusted feedback source = DAIO ERC-8004 Adapter
```

---

## 13. ENS 연동

DAIO 리뷰어는 ENS를 가진다.

ENS의 역할은 다음과 같다.

| 역할 | 설명 |
| --- | --- |
| 공개 식별자 | 사람이 읽을 수 있는 리뷰어 이름 |
| 캐릭터 브랜딩 | 게임형 AI 리뷰어 캐릭터와 연결 |
| wallet 연결 | ENS resolver가 리뷰어 wallet 또는 agent wallet을 가리키는지 확인 |
| ERC-8004 metadata 연결 | agentURI 또는 service endpoint에 ENS 포함 |
| 평판 지속성 | 리뷰어가 장기 정체성을 갖고 활동하도록 유도 |
- ENS는 Sybil 방지의 완전한 해결책이 아니다.
- ENS는 지속적 정체성을 제공하고, 실제 Sybil 비용은 USDAIO stake, 장기 평판, 도메인 자격, cooldown 정책이 만든다.

---

## 14. Payment Router와 Uniswap v4 Hook

DAIO의 기본 결제 토큰은 USDAIO다. 사용자가 USDAIO를 보유하지 않은 경우 USDC, USDT, ETH를 USDAIO로 자동 환전한다.

결제 흐름은 다음과 같다.

```
USDC / USDT / ETH
→ Payment Router
→ Uniswap v4 exact-output swap
→ USDAIO 확보
→ Request Manager에 수수료 납부
→ request 생성
```

Payment Router는 결제의 중심이다. Uniswap v4 Hook은 request 생성 주체가 아니다.

| 구성요소 | 역할 |
| --- | --- |
| Payment Router | 입력 자산 수령, USDAIO 환전, request 생성 |
| Swap Adapter | Uniswap v4 swap 실행 |
| Auto-Convert Hook | DAIO 결제성 swap 검증 및 이벤트 기록 |
| Request Manager | request 생성과 상태 관리 |
| Stake Vault | 수수료 escrow와 reward pool 회계 |

Hook이 request 생성까지 직접 수행하지 않는 이유는 swap lifecycle과 DAIO request 상태 전이를 과도하게 결합하지 않기 위해서다.

- Hook 안에서 request 생성까지 수행하면 reentrancy, rollback, partial execution 처리 복잡도가 커진다.
- 따라서 Hook은 DAIO router 경유 swap인지, 허용된 USDAIO pool인지, request intent와 연결되는 swap인지 검증하고 이벤트로 남기는 역할에 집중한다.

---

## 15. Request 처리 전체 흐름

DAIO request는 다음 순서로 처리된다.

```
1. 리뷰어 등록
   - ENS 준비
   - ERC-8004 agent 등록
   - USDAIO stake 예치
   - domain 등록

2. 요청자 request 생성
   - proposal URI/hash 제출
   - rubric hash 제출
   - required fee + priority fee 납부
   - USDAIO가 없으면 USDC/USDT/ETH 자동 환전

3. Priority Queue 진입
   - priority fee 기준 정렬
   - queue top request부터 처리

4. Review Commit Phase
   - eligible reviewer들이 VRF self-sortition 수행
   - 선출된 reviewer만 commit 제출
   - commit quorum 충족 시 committee 확정

5. Review Reveal Phase
   - commit한 reviewer가 점수와 리포트 공개
   - reveal quorum 충족 시 audit phase 진입
   - 미충족 시 fallback 정책 적용

6. Audit Target Selection
   - reveal 완료 reviewer들이 audit 후보
   - 각 reviewer가 VRF로 최대 L개 리포트 선정
   - self-audit 금지

7. Audit Commit Phase
   - audit 점수 commitment 제출

8. Audit Reveal Phase
   - audit 점수 공개
   - coverage quorum 확인

9. Consensus Scoring
   - 안건 합의 점수 산출
   - report quality 산출
   - audit reliability 산출
   - confidence 산출
   - minority opinion 식별

10. Settlement
   - 보상 지급
   - stake unlock
   - protocol fault 슬래싱
   - semantic strike 누적
   - requester refund 또는 treasury 배분

11. Reputation Update
   - DAIO Reputation Ledger 갱신
   - ERC-8004 Reputation Registry에 feedback 기록
```

---

## 16. Fallback 정책

DAIO는 BRAIN의 fallback 구조를 request 리뷰 환경에 맞게 확장한다.

- BRAIN에서는 commit quorum이 timeout까지 충족되지 않으면 request를 취소하고 자산을 환불하는 a-fallback이 발생한다.
- reveal quorum이 부족하면, 공개된 값만으로 진행하는 b-I fallback 또는 request를 높은 우선순위로 다시 queue에 넣는 b-II fallback을 선택할 수 있다.

DAIO의 fallback은 다음과 같다.

| 단계 | 실패 상황 | 기본 처리 |
| --- | --- | --- |
| Review Commit | commit quorum 미달 | request 취소 또는 재시도 |
| Review Reveal | reveal quorum 미달 | responsive/safety fallback 선택 |
| Audit Commit | audit commit 부족 | audit 재시도 또는 confidence 하락 |
| Audit Reveal | audit reveal 부족 | 공개된 audit만 사용하거나 재시도 |
| Coverage | 특정 리포트 audit 부족 | semantic slashing 제외, confidence 하락 |
| Finalization | request timeout 초과 | request 실패 처리 및 수수료 정산 |

DAIO는 request 생성 시 service tier를 선택할 수 있다.

| service tier | fallback 정책 |
| --- | --- |
| Fast | 일부 quorum 부족 시 낮은 confidence로 결과 제공 |
| Safe | quorum 부족 시 재시도 우선 |
| Critical | quorum과 coverage 모두 충족되지 않으면 결과 미확정 |

---

## 17. 주요 설계 인사이트

### 17.1 리뷰어 선정은 fixed-M이 아니라 BRAIN식 확률기반 quorum 형성이다

DAIO는 request마다 정확히 M명을 사전에 고정 선정하지 않는다.

대신 각 eligible reviewer가 VRF를 통해 자기 선출 여부를 확인하고, 선출된 리뷰어가 commit을 제출한다. commit 수가 quorum에 도달하면 committee가 확정된다.

이 구조는 “고정 위원회”가 아니라 “확률적 위원회 형성”이다. 선출 확률은 difficulty로 조정하고, 실제 진행 여부는 quorum으로 판단한다.

---

### 17.2 Difficulty와 quorum은 함께 설계해야 한다

선출 확률이 낮고 quorum이 높으면 request가 오래 걸리거나 timeout될 수 있다.

반대로 선출 확률이 높고 quorum이 낮으면 빠르지만 redundancy가 줄어든다.

BRAIN 실험은 quorum 크기, VRF 선출 확률, timeout 설정이 처리량과 timeout에 직접 영향을 준다는 점을 보여준다. 특히 많은 노드가 선출되어야 하는데 선출 확률이 낮으면 timeout이 급증할 수 있다.

DAIO는 request tier별로 difficulty와 quorum을 다르게 둔다.

| tier | 특징 |
| --- | --- |
| Fast | 낮은 quorum, 높은 선출 확률, 빠른 응답 |
| Standard | 중간 quorum, 중간 선출 확률 |
| Critical | 높은 quorum, 충분한 timeout, 높은 confidence |

---

### 17.3 Audit도 확률기반 L개 선정이 기본이다

DAIO의 audit은 균형 그래프를 강제하지 않는다. 각 리뷰어는 VRF로 선정된 최대 L개의 리포트를 평가한다.

이 방식은 coverage 불균형을 만들 수 있지만, 그 대신 예측 가능성을 낮춰 담합을 어렵게 한다.

DAIO는 coverage 불균형을 강제로 제거하지 않고, confidence와 fallback으로 관리한다.

---

### 17.4 Confidence는 결과의 일부다

확률기반 구조에서는 결과 점수만 제공하면 충분하지 않다.

실제 몇 명이 참여했는지, 몇 명이 reveal했는지, 리포트들이 얼마나 audit되었는지, 점수 분산이 얼마나 되는지를 함께 제공해야 한다.

따라서 DAIO의 결과는 항상 다음 조합으로 제공된다.

```
final consensus score
confidence
review participation
audit coverage
score dispersion
minority opinions
```

---

### 17.5 단순 outlier 슬래싱은 금지한다

DAIO는 리뷰 플랫폼이다. 논문, 정책, 법률, DAO 안건에서는 소수 의견이 핵심일 수 있다.

따라서 다수와 다른 점수를 냈다는 이유만으로 슬래싱하지 않는다.

다수와 다르면서 리포트 품질도 낮고, 이 패턴이 반복될 때 semantic fault로 처리한다.

---

### 17.6 ERC-8004는 외부 신뢰 레이어다

DAIO 내부 평판은 DAIO가 계산한다.

ERC-8004는 그 결과를 외부 시스템에서도 조회할 수 있게 해주는 표준 기록 레이어다.

DAIO는 ERC-8004 feedback을 활용해 AI reviewer identity와 reputation을 외부 생태계와 연결한다.

단, DAIO 평판으로 해석할 때는 DAIO Adapter가 남긴 feedback만 신뢰한다.

---

### 17.7 Uniswap Hook은 결제성 swap 검증 레이어다

USDAIO 자동 환전은 Payment Router가 담당한다. Hook은 DAIO 결제성 swap을 검증하고 이벤트화한다.

이 역할 분리를 통해 request 생성, 수수료 escrow, queue 진입은 DAIO 컨트랙트가 명확히 책임지고, Uniswap v4 Hook은 swap 단계의 검증과 추적성만 담당한다.

---

## 18. 최종 컨트랙트 아키텍처

```
Requester
  |
  | USDAIO / USDC / USDT / ETH
  v
Payment Router
  |
  +--> Uniswap v4 Swap Adapter
  |       |
  |       v
  |   Uniswap v4 Pool + Auto-Convert Hook
  |
  v
Request Manager
  |
  v
Priority Queue
  |
  v
VRF-based Review Sortition
  |
  v
Commit-Reveal Manager
  |
  v
VRF-based Audit Target Selection
  |
  v
Consensus Scoring
  |
  v
Settlement ----> Stake Vault
  |
  v
Reputation Ledger
  |
  v
ERC-8004 Adapter ----> ERC-8004 Reputation Registry

Reviewer
  |
  | ENS + ERC-8004 agentId + USDAIO stake
  v
Reviewer Registry
```

---

## 19. 최종 설계 결론

DAIO 컨트랙트 파트는 다음 방향으로 구현한다.

```
1. Ethereum Sepolia에서 시작한다.
2. 리뷰어는 ENS와 ERC-8004 agentId를 가진 AI agent로 등록한다.
3. 모든 경제 단위는 USDAIO로 통일한다.
4. 요청자는 USDAIO, USDC, USDT, ETH로 request를 생성할 수 있다.
5. USDC, USDT, ETH는 Payment Router와 Uniswap v4를 통해 USDAIO로 자동 환전된다.
6. Uniswap v4 Hook은 request 생성이 아니라 DAIO 결제성 swap 검증을 담당한다.
7. request는 priority fee 기반 queue에 들어간다.
8. 리뷰어 선정은 fixed-M이 아니라 BRAIN식 VRF 확률기반 sortition으로 한다.
9. commit quorum이 충족되면 review committee가 확정된다.
10. reveal quorum이 충족되면 audit phase로 넘어간다.
11. audit 대상도 VRF 확률기반으로 선정하며, 각 리뷰어는 최대 L개 리포트를 audit한다.
12. audit coverage 부족은 confidence와 fallback으로 처리한다.
13. review 점수와 audit 점수는 모두 commit-and-reveal을 거친다.
14. 점수취합은 중앙값 기반 합의와 리포트 품질, 채점 신뢰도, confidence를 함께 산출한다.
15. 장기 채점 신뢰도는 Reputation Ledger에 누적한다.
16. ERC-8004는 DAIO 평판을 외부에 공개하는 표준 feedback layer로 사용한다.
17. 슬래싱은 프로토콜 위반과 반복적 저품질 이상행동에 적용한다.
18. 품질 높은 소수 의견은 minority opinion으로 보호한다.
```

DAIO는 고정된 심사위원단이 아니라, **VRF로 매 request마다 확률적으로 형성되는 리뷰 네트워크**를 사용한다.

- 이 구조는 BRAIN의 request queue, cryptographic sortition, commit/reveal, quorum, fallback 방식을 리뷰 합의 플랫폼에 맞게 확장한 것이다.
- DAIO의 핵심 결과물은 단순 점수 하나가 아니라, **합의 점수 + confidence + 리포트 품질 + 채점 신뢰도 + 장기 평판**이다.
