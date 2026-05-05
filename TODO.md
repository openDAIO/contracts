# TODO

## Fix ETH -> USDAIO auto-convert path

Status: needs contract redeploy for the permanent fix.

### Current error

The ETH payment path can revert even after the ETH/USDAIO v4 pool has enough liquidity.

Observed failing path:

```text
PaymentRouter.createRequestWithETH
  -> UniswapV4SwapAdapter.swapExactOutputETH
  -> UniversalRouter v4 swap
  -> DAIOAutoConvertHook.afterSwap
```

Failure 1: original calldata used `SWEEP(ETH, SwapAdapter, 0)`.

```text
Panic(0x11): arithmetic underflow/overflow
UniswapV4SwapAdapter.sol:137
amountInUsed = msg.value - refund;
```

Reason: UniversalRouter may sweep more ETH to the `SwapAdapter` than the current `msg.value` refund, because the UniversalRouter can already hold ETH. Then `refund > msg.value`, so `msg.value - refund` underflows.

Failure 2: changing only ETH `SWEEP` to `PaymentRouter` is not enough.

```text
UniswapV4SwapAdapter: insufficient output
```

Reason: the old v4 action used `TAKE_ALL(USDAIO, minAmount)`, and `TAKE_ALL` sends USDAIO to the UniversalRouter `msgSender()`, which is the `SwapAdapter`. But `PaymentRouter` calls `swapExactOutputETH(..., recipient = address(this), ...)`, so the adapter checks the USDAIO balance of `PaymentRouter`. Since USDAIO went to `SwapAdapter`, the output check fails.

### Temporary workaround

No admin action is needed for the temporary path. Build the UniversalRouter calldata differently before calling `PaymentRouter.createRequestWithETH`.

Use v4 actions:

```text
SWAP_EXACT_OUT_SINGLE -> SETTLE -> TAKE
```

Important calldata details:

```text
TAKE(
  currency = USDAIO,
  recipient = PaymentRouter,
  amount = OPEN_DELTA
)

SWEEP(
  token = ETH,
  recipient = PaymentRouter,
  amountMin = 0
)
```

This sends the exact USDAIO output to `PaymentRouter`, where `SwapAdapter` expects it, and sends leftover ETH to `PaymentRouter`, where `createRequestWithETH` can refund the caller through its existing leftover ETH refund logic.

Validation already performed:

- Fork at Sepolia block `10794330`: `PaymentRouter.createRequestWithETH` succeeded for `ETH -> 100 USDAIO`.
- Latest Sepolia `eth_call` at block `10794423`: same calldata shape returned success.
- At the tested liquidity, `100 USDAIO` exact-output required about `0.0018470266 ETH`; using `0.00187 ETH` was enough.

### Permanent fix

Redeploy is needed because the deployed `PaymentRouter` stores `swapAdapter` as an immutable constructor argument.

Recommended permanent path:

1. Patch `UniswapV4SwapAdapter.swapExactOutputETH` so refund accounting cannot underflow when `refund > msg.value`.
2. Consider validating or standardizing ETH router calldata so USDAIO output and ETH sweep recipients are compatible with `PaymentRouter`.
3. Redeploy a fixed `UniswapV4SwapAdapter`.
4. Redeploy `PaymentRouter` pointing at the fixed adapter, or change the design to make the adapter address updatable in future deployments.
5. Rewire deployed contracts:
   - `DAIOCore.setPaymentRouter(newPaymentRouter)`
   - `swapAdapter.setPaymentRouter(newPaymentRouter)`
   - `swapAdapter.setAutoConvertHook(existingHook)`
   - `DAIOAutoConvertHook.setPaymentRouter(newPaymentRouter)`
   - `DAIOAutoConvertHook.setIntentWriter(newSwapAdapter, true)`
   - keep the existing hook and PoolKey if preserving the current ETH/USDAIO pool liquidity
6. Re-run fork tests and a latest-block `eth_call` for `ETH -> 100 USDAIO`.

Do not redeploy only the hook for this issue. The hook address is part of the Uniswap v4 PoolKey, so a new hook would create a different pool and would not use the existing liquidity. Also, the observed failure is in the adapter/refund path, not in hook validation.
