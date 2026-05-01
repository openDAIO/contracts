// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IDAIOCorePayment {
    function baseRequestFee() external view returns (uint256);
    function stakeVault() external view returns (address);
    function getRequestLifecycle(uint256 requestId)
        external
        view
        returns (
            address requester,
            uint8 status,
            uint256 feePaid,
            uint256 priorityFee,
            uint256 retryCount,
            uint256 committeeEpoch,
            uint256 auditEpoch,
            uint256 activePriority,
            bool lowConfidence
        );

    function createRequestFor(
        address requester,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) external returns (uint256);
}

interface IAcceptedTokenRegistry {
    function acceptedTokens(address token) external view returns (bool);
    function requiresSwap(address token) external view returns (bool);
}

interface IUniswapV4SwapAdapter {
    function swapExactOutput(
        address inputToken,
        address outputToken,
        uint256 amountInMax,
        uint256 amountOut,
        address payer,
        address recipient,
        bytes calldata routerCalldata,
        bytes32 intentHash
    ) external returns (uint256 amountInUsed);

    function swapExactOutputETH(
        address outputToken,
        uint256 amountOut,
        address recipient,
        bytes calldata routerCalldata,
        bytes32 intentHash
    ) external payable returns (uint256 amountInUsed);
}

contract PaymentRouter {
    uint8 internal constant STATUS_QUEUED = 1;
    uint8 internal constant STATUS_AUDIT_REVEAL = 5;
    uint8 internal constant STATUS_FINALIZED = 6;
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant REQUEST_TYPEHASH = keccak256(
        "RequestIntent(address requester,bytes32 proposalURIHash,bytes32 proposalHash,bytes32 rubricHash,uint256 domainMask,uint8 tier,uint256 priorityFee,uint256 nonce,uint256 deadline)"
    );
    bytes32 internal constant NAME_HASH = keccak256("DAIOPaymentRouter");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    uint256 internal constant SECP256K1N_DIV_2 = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    IERC20Minimal public immutable usdaio;
    IDAIOCorePayment public immutable core;
    IAcceptedTokenRegistry public immutable acceptedTokenRegistry;
    IUniswapV4SwapAdapter public immutable swapAdapter;
    mapping(address requester => uint256 requestId) public latestRequestByRequester;
    mapping(address requester => uint256 nonce) public nonces;

    event RequestPaid(address indexed requester, uint256 indexed requestId, address indexed paymentToken, uint256 amountPaid);

    constructor(address usdaio_, address core_, address acceptedTokenRegistry_, address swapAdapter_) {
        require(usdaio_ != address(0) && core_ != address(0), "PaymentRouter: bad core");
        require(acceptedTokenRegistry_ != address(0) && swapAdapter_ != address(0), "PaymentRouter: bad adapter");
        usdaio = IERC20Minimal(usdaio_);
        core = IDAIOCorePayment(core_);
        acceptedTokenRegistry = IAcceptedTokenRegistry(acceptedTokenRegistry_);
        swapAdapter = IUniswapV4SwapAdapter(swapAdapter_);
    }

    receive() external payable {}

    function createRequestWithUSDAIO(
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) external returns (uint256 requestId) {
        requestId = _createRequestWithUSDAIOFrom(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
    }

    function createRequestWithUSDAIOBySig(
        address requester,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 requestId) {
        require(requester != address(0), "PaymentRouter: bad requester");
        require(block.timestamp <= deadline, "PaymentRouter: expired");

        uint256 nonce = nonces[requester]++;
        bytes32 structHash = keccak256(
            abi.encode(
                REQUEST_TYPEHASH,
                requester,
                keccak256(bytes(proposalURI)),
                proposalHash,
                rubricHash,
                domainMask,
                tier,
                priorityFee,
                nonce,
                deadline
            )
        );
        require(_recover(_hashTypedData(structHash), signature) == requester, "PaymentRouter: bad signature");
        requestId = _createRequestWithUSDAIOFrom(requester, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _createRequestWithUSDAIOFrom(
        address requester,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) internal returns (uint256 requestId) {
        uint256 requiredUsdaio = core.baseRequestFee() + priorityFee;
        require(usdaio.transferFrom(requester, address(this), requiredUsdaio), "PaymentRouter: pull USDAIO failed");
        require(usdaio.approve(core.stakeVault(), requiredUsdaio), "PaymentRouter: approve failed");
        requestId = core.createRequestFor(requester, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
        latestRequestByRequester[requester] = requestId;
        emit RequestPaid(requester, requestId, address(usdaio), requiredUsdaio);
    }

    function createRequestWithERC20(
        address inputToken,
        uint256 amountInMax,
        bytes calldata routerCalldata,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) external returns (uint256 requestId) {
        require(acceptedTokenRegistry.acceptedTokens(inputToken), "PaymentRouter: token not accepted");
        require(acceptedTokenRegistry.requiresSwap(inputToken), "PaymentRouter: USDAIO path required");

        uint256 inputBalanceBefore = IERC20Minimal(inputToken).balanceOf(address(this));
        require(IERC20Minimal(inputToken).transferFrom(msg.sender, address(this), amountInMax), "PaymentRouter: pull input failed");
        require(IERC20Minimal(inputToken).approve(address(swapAdapter), amountInMax), "PaymentRouter: approve input failed");

        uint256 requiredUsdaio = core.baseRequestFee() + priorityFee;
        bytes32 intentHash =
            keccak256(abi.encode(msg.sender, inputToken, requiredUsdaio, proposalHash, rubricHash, domainMask, tier, priorityFee, block.chainid));
        swapAdapter.swapExactOutput(inputToken, address(usdaio), amountInMax, requiredUsdaio, address(this), address(this), routerCalldata, intentHash);
        require(usdaio.approve(core.stakeVault(), requiredUsdaio), "PaymentRouter: approve failed");
        requestId = core.createRequestFor(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
        latestRequestByRequester[msg.sender] = requestId;
        uint256 leftoverInput = IERC20Minimal(inputToken).balanceOf(address(this)) - inputBalanceBefore;
        if (leftoverInput > 0) {
            require(IERC20Minimal(inputToken).transfer(msg.sender, leftoverInput), "PaymentRouter: refund input failed");
        }
        emit RequestPaid(msg.sender, requestId, inputToken, amountInMax);
    }

    function createRequestWithETH(
        bytes calldata routerCalldata,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) external payable returns (uint256 requestId) {
        require(acceptedTokenRegistry.acceptedTokens(address(0)), "PaymentRouter: ETH not accepted");
        uint256 ethBalanceBefore = address(this).balance - msg.value;
        uint256 requiredUsdaio = core.baseRequestFee() + priorityFee;
        bytes32 intentHash =
            keccak256(abi.encode(msg.sender, address(0), requiredUsdaio, proposalHash, rubricHash, domainMask, tier, priorityFee, block.chainid));
        swapAdapter.swapExactOutputETH{value: msg.value}(address(usdaio), requiredUsdaio, address(this), routerCalldata, intentHash);
        require(usdaio.approve(core.stakeVault(), requiredUsdaio), "PaymentRouter: approve failed");
        requestId = core.createRequestFor(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
        latestRequestByRequester[msg.sender] = requestId;
        uint256 leftoverEth = address(this).balance - ethBalanceBefore;
        if (leftoverEth > 0) {
            (bool ok,) = msg.sender.call{value: leftoverEth}("");
            require(ok, "PaymentRouter: refund ETH failed");
        }
        emit RequestPaid(msg.sender, requestId, address(0), msg.value);
    }

    function latestRequestState(address requester)
        external
        view
        returns (uint256 requestId, uint8 status, bool processing, bool completed)
    {
        requestId = latestRequestByRequester[requester];
        if (requestId == 0) return (0, 0, false, false);

        (, status,,,,,,,) = core.getRequestLifecycle(requestId);
        processing = status >= STATUS_QUEUED && status <= STATUS_AUDIT_REVEAL;
        completed = status >= STATUS_FINALIZED;
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        require(signature.length == 65, "PaymentRouter: bad signature");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "PaymentRouter: bad signature");
        require(uint256(s) <= SECP256K1N_DIV_2, "PaymentRouter: bad signature");
        signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "PaymentRouter: bad signature");
    }
}
