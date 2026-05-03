require("@nomicfoundation/hardhat-toolbox");

const optimizerRuns = Number(process.env.OPTIMIZER_RUNS || "0");
const mochaTimeout = Number(process.env.MOCHA_TIMEOUT || "40000");
const enableHardhatFork = process.env.ENABLE_HARDHAT_FORK === "true";
const hardhatForkUrl = process.env.HARDHAT_FORK_URL || process.env.SEPOLIA_RPC_URL || "";
const hardhatForkBlock = process.env.HARDHAT_FORK_BLOCK ? Number(process.env.HARDHAT_FORK_BLOCK) : undefined;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          evmVersion: "shanghai",
          metadata: {
            bytecodeHash: "none"
          },
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: optimizerRuns
          }
        }
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ]
  },
  networks: {
    hardhat: {
      chainId: 31337,
      ...(enableHardhatFork
        ? {
            forking: {
              url: hardhatForkUrl,
              ...(hardhatForkBlock ? { blockNumber: hardhatForkBlock } : {})
            }
          }
        : {})
    },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  mocha: {
    timeout: mochaTimeout
  }
};
