const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

function deploymentFilePath() {
  const override = process.env.DAIO_DEPLOYMENT_FILE;
  if (override && override !== "") return override;
  return `deployments/${network.name}.json`;
}

async function main() {
  const file = deploymentFilePath();
  if (!fs.existsSync(file)) throw new Error(`deployment file not found: ${file}`);
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  const contracts = state.contracts || {};
  const required = [
    "DAIOCore",
    "StakeVault",
    "ReviewerRegistry",
    "AssignmentManager",
    "Settlement",
    "ReputationLedger"
  ];
  for (const name of required) {
    if (!contracts[name]) throw new Error(`${name} address missing in ${file}`);
  }

  const [signer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Signer:  ${signer.address}`);

  const core = await ethers.getContractAt("DAIOCore", contracts.DAIOCore, signer);
  const expectedOwner = state.deployer ? ethers.getAddress(state.deployer) : null;
  if (expectedOwner && expectedOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`signer ${signer.address} does not match recorded deployer/owner ${expectedOwner}`);
  }

  const previousScoring = contracts.ConsensusScoring || ethers.ZeroAddress;
  console.log(`Previous ConsensusScoring: ${previousScoring}`);

  const Factory = await ethers.getContractFactory("ConsensusScoring");
  const scoring = await Factory.deploy();
  await scoring.waitForDeployment();
  const newScoringAddress = ethers.getAddress(await scoring.getAddress());
  console.log(`Deployed new ConsensusScoring: ${newScoringAddress}`);

  const tx = await core.setModules(
    contracts.StakeVault,
    contracts.ReviewerRegistry,
    contracts.AssignmentManager,
    newScoringAddress,
    contracts.Settlement,
    contracts.ReputationLedger
  );
  console.log(`setModules tx: ${tx.hash}`);
  await tx.wait();
  console.log("setModules confirmed.");

  contracts.ConsensusScoring = newScoringAddress;
  if (previousScoring && previousScoring !== ethers.ZeroAddress) {
    const history = Array.isArray(state.previousConsensusScoring)
      ? state.previousConsensusScoring
      : [];
    if (!history.includes(previousScoring)) history.push(previousScoring);
    state.previousConsensusScoring = history;
  }
  state.contracts = contracts;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`Updated deployment file: ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
