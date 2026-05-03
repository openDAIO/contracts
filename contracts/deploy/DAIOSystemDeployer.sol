// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDAIOCoreDeployerTarget {
    struct RequestConfig {
        uint16 reviewElectionDifficulty;
        uint16 auditElectionDifficulty;
        uint16 reviewCommitQuorum;
        uint16 reviewRevealQuorum;
        uint16 auditCommitQuorum;
        uint16 auditRevealQuorum;
        uint16 auditTargetLimit;
        uint16 minIncomingAudit;
        uint16 auditCoverageQuorum;
        uint16 contributionThreshold;
        uint16 reviewEpochSize;
        uint16 auditEpochSize;
        uint16 finalityFactor;
        uint16 maxRetries;
        uint16 minorityThreshold;
        uint16 semanticStrikeThreshold;
        uint16 protocolFaultSlashBps;
        uint16 missedRevealSlashBps;
        uint16 semanticSlashBps;
        uint32 cooldownBlocks;
        uint32 reviewCommitTimeout;
        uint32 reviewRevealTimeout;
        uint32 auditCommitTimeout;
        uint32 auditRevealTimeout;
    }

    function initialize(
        address treasury,
        address commitReveal,
        address priorityQueue,
        address vrfCoordinator,
        uint256 maxActiveRequests
    ) external;

    function setModules(
        address stakeVault,
        address reviewerRegistry,
        address assignmentManager,
        address consensusScoring,
        address settlement,
        address reputationLedger
    ) external;

    function setRoundLedger(address roundLedger) external;
    function setTierConfig(uint8 tier, RequestConfig calldata config) external;
    function setPaymentRouter(address paymentRouter) external;
    function transferOwnership(address newOwner) external;
}

interface IOwnableDeployerTarget {
    function transferOwnership(address newOwner) external;
}

interface IStakeVaultDeployerTarget {
    function setCoreOrSettlement(address core) external;
    function setAuthorized(address account, bool allowed) external;
    function transferOwnership(address newOwner) external;
}

interface IReviewerRegistryDeployerTarget {
    function setCore(address core) external;
    function setReputationGate(address reputationLedger, uint256 minSamples, uint256 minContribution, uint256 minCompliance) external;
    function setIdentityModules(address ensVerifier, address erc8004Adapter) external;
    function transferOwnership(address newOwner) external;
}

interface IReputationLedgerDeployerTarget {
    function setCore(address core) external;
    function setERC8004Adapter(address adapter) external;
    function transferOwnership(address newOwner) external;
}

interface ICoreLinkedDeployerTarget {
    function setCore(address core) external;
    function transferOwnership(address newOwner) external;
}

interface IERC8004AdapterDeployerTarget {
    function setWriter(address writer) external;
    function transferOwnership(address newOwner) external;
}

interface IAcceptedTokenRegistryDeployerTarget {
    function setAcceptedToken(address token, bool accepted, bool requiresSwap) external;
    function transferOwnership(address newOwner) external;
}

interface IUniswapV4SwapAdapterDeployerTarget {
    function setPaymentRouter(address paymentRouter) external;
    function setAutoConvertHook(address hook) external;
    function transferOwnership(address newOwner) external;
}

interface IDAIOAutoConvertHookDeployerTarget {
    function setIntentWriter(address writer, bool allowed) external;
    function setAllowedRouter(address router, bool allowed) external;
}

contract DAIOSystemDeployer {
    uint16 internal constant SCALE = 10_000;
    address internal constant NATIVE_ETH = address(0);

    struct SystemConfig {
        address finalOwner;
        address treasury;
        address ensRegistry;
        address erc8004IdentityRegistry;
        address erc8004ReputationRegistry;
        address universalRouter;
        address poolManager;
        uint256 maxActiveRequests;
        bool deployLocalMocks;
        bool deployEnsVerifier;
        bool deployERC8004Adapter;
        bool deployAutoConvertHook;
        bool acceptEth;
    }

    struct LocalMockCode {
        bytes mockUniversalRouter;
        bytes mockPoolManager;
    }

    struct ModuleCode {
        bytes usdaio;
        bytes stakeVault;
        bytes reviewerRegistry;
        bytes assignmentManager;
        bytes consensusScoring;
        bytes settlement;
        bytes reputationLedger;
    }

    struct CoreCode {
        bytes commitReveal;
        bytes priorityQueue;
        bytes vrfVerifier;
        bytes vrfCoordinator;
        bytes core;
        bytes coreProxy;
        bytes roundLedger;
    }

    struct PaymentCode {
        bytes acceptedTokenRegistry;
        bytes swapAdapter;
        bytes paymentRouter;
        bytes ensVerifier;
        bytes erc8004Adapter;
        bytes autoConvertHook;
    }

    struct Deployment {
        address usdaio;
        address stakeVault;
        address reviewerRegistry;
        address assignmentManager;
        address consensusScoring;
        address settlement;
        address reputationLedger;
        address commitReveal;
        address priorityQueue;
        address vrfVerifier;
        address vrfCoordinator;
        address coreImplementation;
        address core;
        address roundLedger;
        address acceptedTokenRegistry;
        address swapAdapter;
        address paymentRouter;
        address ensVerifier;
        address erc8004Adapter;
        address autoConvertHook;
        address universalRouter;
        address poolManager;
    }

    event ContractDeployed(string name, address indexed deployed);
    event SystemDeployed(address indexed core, address indexed paymentRouter, address indexed usdaio);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error BadConfig();
    error EmptyInitCode();
    error DeployFailed();
    error NotOwner();

    address public owner;
    Deployment private deployment;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert BadConfig();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function currentDeployment() external view returns (Deployment memory) {
        return deployment;
    }

    function deployLocalMocks(LocalMockCode calldata code) external onlyOwner {
        deployment.universalRouter = _deploy("MockUniversalRouter", code.mockUniversalRouter);
        deployment.poolManager = _deploy("MockV4PoolManager", code.mockPoolManager);
    }

    function setExternalV4(address universalRouter, address poolManager) external onlyOwner {
        if (universalRouter == address(0) || poolManager == address(0)) revert BadConfig();
        deployment.universalRouter = universalRouter;
        deployment.poolManager = poolManager;
    }

    function deployModules(address finalOwner, ModuleCode calldata code) external onlyOwner {
        if (finalOwner == address(0)) finalOwner = msg.sender;
        Deployment storage deployed = deployment;
        deployed.usdaio = _deploy("USDAIO", abi.encodePacked(code.usdaio, abi.encode(finalOwner)));
        deployed.stakeVault = _deploy("StakeVault", abi.encodePacked(code.stakeVault, abi.encode(deployed.usdaio)));
        deployed.reviewerRegistry = _deploy("ReviewerRegistry", abi.encodePacked(code.reviewerRegistry, abi.encode(deployed.stakeVault)));
        deployed.assignmentManager = _deploy("AssignmentManager", code.assignmentManager);
        deployed.consensusScoring = _deploy("ConsensusScoring", code.consensusScoring);
        deployed.settlement = _deploy("Settlement", code.settlement);
        deployed.reputationLedger = _deploy("ReputationLedger", code.reputationLedger);
    }

    function deployCore(address treasury, uint256 maxActiveRequests, address proxyAdminOwner, CoreCode calldata code) external onlyOwner {
        Deployment storage deployed = deployment;
        if (treasury == address(0)) treasury = msg.sender;
        if (maxActiveRequests == 0) maxActiveRequests = 2;
        if (proxyAdminOwner == address(0)) proxyAdminOwner = msg.sender;
        if (deployed.stakeVault == address(0) || deployed.reputationLedger == address(0)) revert BadConfig();

        deployed.commitReveal = _deploy("DAIOCommitRevealManager", code.commitReveal);
        deployed.priorityQueue = _deploy("DAIOPriorityQueue", code.priorityQueue);
        deployed.vrfVerifier = _deploy("FRAINVRFVerifier", code.vrfVerifier);
        deployed.vrfCoordinator = _deploy("DAIOVRFCoordinator", abi.encodePacked(code.vrfCoordinator, abi.encode(deployed.vrfVerifier)));
        deployed.coreImplementation = _deploy("DAIOCoreImplementation", code.core);
        deployed.core = _deploy(
            "DAIOCore",
            abi.encodePacked(
                code.coreProxy,
                abi.encode(
                    deployed.coreImplementation,
                    proxyAdminOwner,
                    abi.encodeCall(
                        IDAIOCoreDeployerTarget.initialize,
                        (treasury, deployed.commitReveal, deployed.priorityQueue, deployed.vrfCoordinator, maxActiveRequests)
                    )
                )
            )
        );
        deployed.roundLedger = _deploy("DAIORoundLedger", code.roundLedger);
    }

    function deployPaymentAndIdentity(SystemConfig calldata config, PaymentCode calldata code) external onlyOwner {
        Deployment storage deployed = deployment;
        if (deployed.usdaio == address(0) || deployed.core == address(0)) revert BadConfig();
        if (deployed.universalRouter == address(0)) {
            if (config.universalRouter == address(0)) revert BadConfig();
            deployed.universalRouter = config.universalRouter;
        }
        if (deployed.poolManager == address(0)) {
            if (config.poolManager == address(0)) revert BadConfig();
            deployed.poolManager = config.poolManager;
        }

        deployed.acceptedTokenRegistry =
            _deploy("AcceptedTokenRegistry", abi.encodePacked(code.acceptedTokenRegistry, abi.encode(deployed.usdaio)));
        deployed.swapAdapter = _deploy("UniswapV4SwapAdapter", abi.encodePacked(code.swapAdapter, abi.encode(deployed.universalRouter)));
        deployed.paymentRouter = _deploy(
            "PaymentRouter",
            abi.encodePacked(
                code.paymentRouter,
                abi.encode(deployed.usdaio, deployed.core, deployed.acceptedTokenRegistry, deployed.swapAdapter)
            )
        );

        deployed.ensVerifier = address(0);
        if (config.deployEnsVerifier) {
            if (config.ensRegistry == address(0)) revert BadConfig();
            deployed.ensVerifier = _deploy("ENSVerifier", abi.encodePacked(code.ensVerifier, abi.encode(config.ensRegistry)));
        }

        deployed.erc8004Adapter = address(0);
        if (config.deployERC8004Adapter) {
            if (config.erc8004IdentityRegistry == address(0) || config.erc8004ReputationRegistry == address(0)) revert BadConfig();
            deployed.erc8004Adapter = _deploy(
                "ERC8004Adapter",
                abi.encodePacked(code.erc8004Adapter, abi.encode(config.erc8004IdentityRegistry, config.erc8004ReputationRegistry))
            );
        }

        deployed.autoConvertHook = address(0);
    }

    function deployAutoConvertHook(bytes calldata autoConvertHookCode, bytes32 salt) external onlyOwner {
        Deployment storage deployed = deployment;
        if (deployed.poolManager == address(0) || deployed.paymentRouter == address(0) || deployed.usdaio == address(0)) {
            revert BadConfig();
        }
        deployed.autoConvertHook = _deploy2(
            "DAIOAutoConvertHook",
            abi.encodePacked(autoConvertHookCode, abi.encode(deployed.poolManager, deployed.paymentRouter, deployed.usdaio, address(this))),
            salt
        );
    }

    function wireAndTransfer(SystemConfig calldata config) external onlyOwner {
        Deployment memory deployed = deployment;
        address finalOwner = config.finalOwner == address(0) ? msg.sender : config.finalOwner;
        if (deployed.paymentRouter == address(0)) revert BadConfig();

        _wireSystem(deployed, config.acceptEth);
        _transferOwnedContracts(deployed, finalOwner);

        emit SystemDeployed(deployed.core, deployed.paymentRouter, deployed.usdaio);
    }

    function _wireSystem(Deployment memory deployed, bool acceptEth) internal {
        IDAIOCoreDeployerTarget(deployed.core).setModules(
            deployed.stakeVault,
            deployed.reviewerRegistry,
            deployed.assignmentManager,
            deployed.consensusScoring,
            deployed.settlement,
            deployed.reputationLedger
        );
        IDAIOCoreDeployerTarget(deployed.core).setRoundLedger(deployed.roundLedger);
        IDAIOCoreDeployerTarget(deployed.core).setTierConfig(0, _tierConfig(8000, 3, 7000, 1000, 25, 25, 2, 1, 100, 10 minutes));
        IDAIOCoreDeployerTarget(deployed.core).setTierConfig(1, _tierConfig(10000, 4, 8000, 1500, 50, 50, 3, 1, 300, 30 minutes));
        IDAIOCoreDeployerTarget(deployed.core).setTierConfig(2, _tierConfig(10000, 5, 10000, 2000, 100, 100, 5, 2, 900, 1 hours));
        IDAIOCoreDeployerTarget(deployed.core).setPaymentRouter(deployed.paymentRouter);

        ICoreLinkedDeployerTarget(deployed.roundLedger).setCore(deployed.core);
        IStakeVaultDeployerTarget(deployed.stakeVault).setCoreOrSettlement(deployed.core);
        IStakeVaultDeployerTarget(deployed.stakeVault).setAuthorized(deployed.reviewerRegistry, true);
        IReviewerRegistryDeployerTarget(deployed.reviewerRegistry).setCore(deployed.core);
        IReviewerRegistryDeployerTarget(deployed.reviewerRegistry).setReputationGate(deployed.reputationLedger, 3, 3000, 7000);
        IReputationLedgerDeployerTarget(deployed.reputationLedger).setCore(deployed.core);
        ICoreLinkedDeployerTarget(deployed.commitReveal).setCore(deployed.core);
        ICoreLinkedDeployerTarget(deployed.priorityQueue).setCore(deployed.core);
        IUniswapV4SwapAdapterDeployerTarget(deployed.swapAdapter).setPaymentRouter(deployed.paymentRouter);

        if (deployed.ensVerifier != address(0) || deployed.erc8004Adapter != address(0)) {
            IReviewerRegistryDeployerTarget(deployed.reviewerRegistry).setIdentityModules(deployed.ensVerifier, deployed.erc8004Adapter);
        }

        if (deployed.erc8004Adapter != address(0)) {
            IERC8004AdapterDeployerTarget(deployed.erc8004Adapter).setWriter(deployed.reputationLedger);
            IReputationLedgerDeployerTarget(deployed.reputationLedger).setERC8004Adapter(deployed.erc8004Adapter);
        }

        if (acceptEth) {
            IAcceptedTokenRegistryDeployerTarget(deployed.acceptedTokenRegistry).setAcceptedToken(NATIVE_ETH, true, true);
        }

        if (deployed.autoConvertHook != address(0)) {
            IDAIOAutoConvertHookDeployerTarget(deployed.autoConvertHook).setIntentWriter(deployed.swapAdapter, true);
            IDAIOAutoConvertHookDeployerTarget(deployed.autoConvertHook).setAllowedRouter(deployed.universalRouter, true);
            IUniswapV4SwapAdapterDeployerTarget(deployed.swapAdapter).setAutoConvertHook(deployed.autoConvertHook);
        }
    }

    function _transferOwnedContracts(Deployment memory deployed, address finalOwner) internal {
        IStakeVaultDeployerTarget(deployed.stakeVault).transferOwnership(finalOwner);
        IReviewerRegistryDeployerTarget(deployed.reviewerRegistry).transferOwnership(finalOwner);
        IReputationLedgerDeployerTarget(deployed.reputationLedger).transferOwnership(finalOwner);
        ICoreLinkedDeployerTarget(deployed.commitReveal).transferOwnership(finalOwner);
        ICoreLinkedDeployerTarget(deployed.priorityQueue).transferOwnership(finalOwner);
        IDAIOCoreDeployerTarget(deployed.core).transferOwnership(finalOwner);
        ICoreLinkedDeployerTarget(deployed.roundLedger).transferOwnership(finalOwner);
        IAcceptedTokenRegistryDeployerTarget(deployed.acceptedTokenRegistry).transferOwnership(finalOwner);
        IUniswapV4SwapAdapterDeployerTarget(deployed.swapAdapter).transferOwnership(finalOwner);
        if (deployed.erc8004Adapter != address(0)) {
            IERC8004AdapterDeployerTarget(deployed.erc8004Adapter).transferOwnership(finalOwner);
        }
        if (deployed.autoConvertHook != address(0)) {
            IOwnableDeployerTarget(deployed.autoConvertHook).transferOwnership(finalOwner);
        }
    }

    function _tierConfig(
        uint16 reviewElectionDifficulty,
        uint16 reviewQuorum,
        uint16 auditCoverageQuorum,
        uint16 contributionThreshold,
        uint16 reviewEpochSize,
        uint16 auditEpochSize,
        uint16 finalityFactor,
        uint16 maxRetries,
        uint32 cooldownBlocks,
        uint32 timeout
    ) internal pure returns (IDAIOCoreDeployerTarget.RequestConfig memory config) {
        uint16 peerAuditCount = reviewQuorum - 1;
        config = IDAIOCoreDeployerTarget.RequestConfig({
            reviewElectionDifficulty: reviewElectionDifficulty,
            auditElectionDifficulty: 10000,
            reviewCommitQuorum: reviewQuorum,
            reviewRevealQuorum: reviewQuorum,
            auditCommitQuorum: reviewQuorum,
            auditRevealQuorum: reviewQuorum,
            auditTargetLimit: peerAuditCount,
            minIncomingAudit: peerAuditCount,
            auditCoverageQuorum: auditCoverageQuorum,
            contributionThreshold: contributionThreshold,
            reviewEpochSize: reviewEpochSize,
            auditEpochSize: auditEpochSize,
            finalityFactor: finalityFactor,
            maxRetries: maxRetries,
            minorityThreshold: 1500,
            semanticStrikeThreshold: 3,
            protocolFaultSlashBps: 500,
            missedRevealSlashBps: 100,
            semanticSlashBps: 200,
            cooldownBlocks: cooldownBlocks,
            reviewCommitTimeout: timeout,
            reviewRevealTimeout: timeout,
            auditCommitTimeout: timeout,
            auditRevealTimeout: timeout
        });
    }

    function _deploy(string memory name, bytes memory initCode) internal returns (address deployed) {
        if (initCode.length == 0) revert EmptyInitCode();
        assembly {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        if (deployed == address(0)) revert DeployFailed();
        emit ContractDeployed(name, deployed);
    }

    function _deploy2(string memory name, bytes memory initCode, bytes32 salt) internal returns (address deployed) {
        if (initCode.length == 0) revert EmptyInitCode();
        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        if (deployed == address(0)) revert DeployFailed();
        emit ContractDeployed(name, deployed);
    }
}
