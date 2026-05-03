const { expect } = require("chai");
const { ethers } = require("hardhat");

const SCALE = 10_000n;

function baseInput(overrides = {}) {
  return {
    reviewRevealCount: 3,
    auditRevealCount: 3,
    reviewCommitQuorum: 3,
    auditCommitQuorum: 3,
    minIncomingAudit: 1,
    auditCoverageQuorum: 0,
    contributionThreshold: 1000,
    minorityThreshold: 1500,
    lowConfidence: false,
    proposalScores: [],
    incomingScoresByTarget: [],
    auditorTargetIndexes: [],
    auditorScores: [],
    ...overrides
  };
}

describe("ConsensusScoring weight calculation", function () {
  let scoring;

  before(async function () {
    const Factory = await ethers.getContractFactory("ConsensusScoring");
    scoring = await Factory.deploy();
    await scoring.waitForDeployment();
  });

  it("rewards a reviewer whose incoming audits never arrived but who audited others", async function () {
    // R0, R1 audit each other. R2's auditors timed out (incoming empty), but R2 audited R0.
    const input = baseInput({
      proposalScores: [8000, 8000, 8000],
      incomingScoresByTarget: [
        [8000], // R0 was audited by R1
        [8000], // R1 was audited by R0
        []      // R2 received no audit (timeout)
      ],
      auditorTargetIndexes: [
        [1], // R0 audited R1
        [0], // R1 audited R0
        [0]  // R2 audited R0
      ],
      auditorScores: [
        [8000],
        [8000],
        [8000]
      ]
    });

    const out = await scoring.compute(input);

    expect(out.incomingCounts[2]).to.equal(0n);
    expect(out.normalizedReliability[2]).to.equal(SCALE);
    expect(out.weights[2]).to.equal(out.normalizedReliability[2]);
    expect(out.weights[2]).to.equal(SCALE);
    // Other reviewers unaffected.
    expect(out.weights[0]).to.equal(SCALE);
    expect(out.weights[1]).to.equal(SCALE);
  });

  it("gives zero weight when both incoming and own audit work are absent", async function () {
    // R2 received no audit AND submitted no audit work.
    const input = baseInput({
      proposalScores: [8000, 8000, 8000],
      incomingScoresByTarget: [
        [8000],
        [8000],
        []
      ],
      auditorTargetIndexes: [
        [1],
        [0],
        [] // R2 did nothing
      ],
      auditorScores: [
        [8000],
        [8000],
        []
      ]
    });

    const out = await scoring.compute(input);

    expect(out.incomingCounts[2]).to.equal(0n);
    expect(out.rawReliability[2]).to.equal(0n);
    expect(out.normalizedReliability[2]).to.equal(0n);
    expect(out.weights[2]).to.equal(0n);
  });

  it("preserves min(quality, reliability) when incoming audits exist", async function () {
    // All reviewers received audits. R0 deviates from median when auditing R1 → reliability < quality.
    const input = baseInput({
      proposalScores: [8000, 6000, 7000],
      incomingScoresByTarget: [
        [8000, 8000], // median 8000
        [6000, 6000], // median 6000
        [7000, 7000]  // median 7000
      ],
      auditorTargetIndexes: [
        [1, 2],
        [0, 2],
        [0, 1]
      ],
      auditorScores: [
        [4000, 7000], // R0 way off on target 1 → low reliability
        [8000, 7000],
        [8000, 6000]
      ]
    });

    const out = await scoring.compute(input);

    for (let i = 0; i < 3; i++) {
      expect(out.incomingCounts[i]).to.be.greaterThan(0n);
      const expected =
        out.normalizedQuality[i] < out.normalizedReliability[i]
          ? out.normalizedQuality[i]
          : out.normalizedReliability[i];
      const passesThreshold = expected >= BigInt(input.contributionThreshold);
      expect(out.contributions[i]).to.equal(expected);
      expect(out.weights[i]).to.equal(passesThreshold ? expected : 0n);
    }
    // Sanity: R0's reliability is degraded versus R1/R2.
    expect(out.normalizedReliability[0]).to.be.lessThan(out.normalizedReliability[1]);
    expect(out.normalizedReliability[0]).to.be.lessThan(out.normalizedReliability[2]);
  });
});
