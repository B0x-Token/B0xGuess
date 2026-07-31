// SPDX-License-Identifier: MIT
/// MUST CHANGE BEFORE LAUNCH

//
 //   uint256 private constant AmountWeOWE_PER_POSITION_Constant = (50 * 10 ** 18); //50 tokens of B0x 
 
 //making it 0.5* 10 ** 18;  so 0.5 / 50 = 0.01 B0x min and 2.5 B0x sponsered






// Forge Guess - Contract
//
// Migrated: VRF v1 direct funding (Polygon mainnet) -> VRF v2.5 direct funding (Base Sepolia)
// End users continue to pay for each VRF request in LINK, same as the original design.
//
// WHAT CHANGED FROM THE ORIGINAL:
// 1. Base contract: VRFConsumerBase -> VRFV2PlusWrapperConsumerBase
// 2. Callback: fulfillRandomness(bytes32, uint256) -> fulfillRandomWords(uint256, uint256[])
// 3. Request call: requestRandomness(keyHash, fee) -> requestRandomness(callbackGasLimit,
//    requestConfirmations, numWords, extraArgs), which returns (uint256 requestId, uint256 reqPrice)
// 4. "fee" is no longer a fixed constant. VRF v2.5 prices requests dynamically based on gas price,
//    callbackGasLimit, and the LINK premium. requestPrice() computes this live via the wrapper.
// 5. extraArgs now carries nativePayment:false to select LINK billing (vs native ETH billing).
// 6. requestId type changed from bytes32 to uint256 (this contract never stored requestId in a
//    mapping, so no downstream logic needed to change for that).
// 7. stakedToken is now passed into the constructor instead of hardcoded, since the old Polygon
//    token address has no meaning on Base Sepolia.
//
// THIS IS UNAUDITED, EXAMPLE-GRADE CODE. Test thoroughly on Base Sepolia before considering
// mainnet, and get a real audit before handling real user funds.

pragma solidity ^0.8.19;


interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}



interface IUniswapV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

// ============================================================
// Vendored, hand-written reimplementation of Chainlink's
// VRF v2.5 direct-funding interfaces + base contract.
// NOT the official audited package. Prefer `npm install
// @chainlink/contracts` if at all possible, especially for
// a contract handling real mainnet funds.
// ============================================================

interface LinkTokenInterface {
    function allowance(address owner, address spender) external view returns (uint256 remaining);
    function approve(address spender, uint256 value) external returns (bool success);
    function balanceOf(address owner) external view returns (uint256 balance);
    function decimals() external view returns (uint8 decimalPlaces);
    function name() external view returns (string memory tokenName);
    function symbol() external view returns (string memory tokenSymbol);
    function totalSupply() external view returns (uint256 totalTokensIssued);
    function transfer(address to, uint256 value) external returns (bool success);
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool success);
    function transferFrom(address from, address to, uint256 value) external returns (bool success);
}

interface IVRFV2PlusWrapper {
    function lastRequestId() external view returns (uint256);

    function calculateRequestPrice(uint32 _callbackGasLimit, uint32 _numWords) external view returns (uint256);

    function calculateRequestPriceNative(uint32 _callbackGasLimit, uint32 _numWords) external view returns (uint256);

    function requestRandomWordsInNative(
        uint32 _callbackGasLimit,
        uint16 _requestConfirmations,
        uint32 _numWords,
        bytes calldata extraArgs
    ) external payable returns (uint256 requestId);

    function link() external view returns (address);
}

library VRFV2PlusClient {
    bytes4 public constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    function _argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}

abstract contract VRFV2PlusWrapperConsumerBase {
    LinkTokenInterface internal immutable i_link;
    IVRFV2PlusWrapper public immutable i_vrfV2PlusWrapper;

    constructor(address _vrfV2PlusWrapper) {
        i_vrfV2PlusWrapper = IVRFV2PlusWrapper(_vrfV2PlusWrapper);
        i_link = LinkTokenInterface(i_vrfV2PlusWrapper.link());
    }

    function requestRandomnessPayInNative(
        uint32 _callbackGasLimit,
        uint16 _requestConfirmations,
        uint32 _numWords,
        bytes memory extraArgs
    ) internal returns (uint256 requestId, uint256 requestPrice) {
        requestPrice = i_vrfV2PlusWrapper.calculateRequestPriceNative(_callbackGasLimit, _numWords);
        requestId = i_vrfV2PlusWrapper.requestRandomWordsInNative{value: requestPrice}(
            _callbackGasLimit,
            _requestConfirmations,
            _numWords,
            extraArgs
        );
    }

    function requestRandomness(
        uint32 _callbackGasLimit,
        uint16 _requestConfirmations,
        uint32 _numWords,
        bytes memory extraArgs
    ) internal returns (uint256 requestId, uint256 requestPrice) {
        requestPrice = i_vrfV2PlusWrapper.calculateRequestPrice(_callbackGasLimit, _numWords);
        i_link.transferAndCall(
            address(i_vrfV2PlusWrapper),
            requestPrice,
            abi.encode(_callbackGasLimit, _requestConfirmations, _numWords, extraArgs)
        );
        requestId = i_vrfV2PlusWrapper.lastRequestId();
    }

    function fulfillRandomWords(uint256 _requestId, uint256[] memory _randomWords) internal virtual;

    function rawFulfillRandomWords(uint256 _requestId, uint256[] memory _randomWords) external {
        require(msg.sender == address(i_vrfV2PlusWrapper), "only VRF V2 Plus wrapper can fulfill");
        fulfillRandomWords(_requestId, _randomWords);
    }
}




/// @title MulDiv
/// @notice Full precision multiplication-division: computes floor(a * b / denominator)
///         without intermediate overflow, and reverts if the result doesn't fit in 256 bits
///         or if denominator is zero.
library MulDiv {
    /// @dev Calculates floor(x * y / denominator) with full precision.
    ///      Based on the well-known 512-bit mulDiv technique (Uniswap / OpenZeppelin style).
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            // 512-bit multiply [prod1 prod0] = x * y.
            // Compute the product mod 2**256 and mod 2**256 - 1
            // then use the Chinese Remainder Theorem to reconstruct
            // the 512 bit result. The result is stored in two 256
            // variables such that product = prod1 * 2**256 + prod0.
            uint256 prod0; // Least significant 256 bits of the product
            uint256 prod1; // Most significant 256 bits of the product
            assembly {
                let mm := mulmod(x, y, not(0))
                prod0 := mul(x, y)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }

            // Handle non-overflow cases, 256 by 256 division.
            if (prod1 == 0) {
                require(denominator > 0, "MulDiv: division by zero");
                assembly {
                    result := div(prod0, denominator)
                }
                return result;
            }

            // Make sure the result is less than 2**256.
            // Also prevents denominator == 0.
            require(denominator > prod1, "MulDiv: overflow / division by zero");

            ///////////////////////////////////////////////
            // 512 by 256 division.
            ///////////////////////////////////////////////

            // Make division exact by subtracting the remainder from [prod1 prod0].
            uint256 remainder;
            assembly {
                // Compute remainder using mulmod.
                remainder := mulmod(x, y, denominator)

                // Subtract 256 bit number from 512 bit number.
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            // Factor powers of two out of denominator and compute largest
            // power of two divisor of denominator. Always >= 1.
            uint256 twos = denominator & (~denominator + 1);
            assembly {
                // Divide denominator by twos.
                denominator := div(denominator, twos)

                // Divide [prod1 prod0] by twos.
                prod0 := div(prod0, twos)

                // Flip twos such that it is 2**256 / twos.
                // If twos is zero, then it becomes one.
                twos := add(div(sub(0, twos), twos), 1)
            }

            // Shift in bits from prod1 into prod0.
            prod0 |= prod1 * twos;

            // Invert denominator mod 2**256. Since denominator is now odd,
            // it has an inverse modulo 2**256 such that denominator * inv ≡ 1 mod 2**256.
            // Compute the inverse by starting with a seed that is correct for
            // four bits. That is, denominator * inv ≡ 1 mod 2**4.
            uint256 inverse = (3 * denominator) ^ 2;

            // Use the Newton-Raphson iteration to improve the precision.
            // Thanks to Hensel's lifting lemma, this also works in modular
            // arithmetic, doubling the correct bits in each step.
            inverse *= 2 - denominator * inverse; // inverse mod 2**8
            inverse *= 2 - denominator * inverse; // inverse mod 2**16
            inverse *= 2 - denominator * inverse; // inverse mod 2**32
            inverse *= 2 - denominator * inverse; // inverse mod 2**64
            inverse *= 2 - denominator * inverse; // inverse mod 2**128
            inverse *= 2 - denominator * inverse; // inverse mod 2**256

            // Because the division is now exact, we can divide by multiplying
            // with the modular inverse of denominator, and get the final result.
            result = prod0 * inverse;
            return result;
        }
    }

    /// @dev Same as {mulDiv}, but rounds the result up instead of down (ceiling division).
    function mulDivRoundingUp(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        result = mulDiv(x, y, denominator);
        unchecked {
            if (mulmod(x, y, denominator) > 0) {
                require(result < type(uint256).max, "MulDiv: overflow on rounding up");
                result += 1;
            }
        }
    }
}










interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract B0xGuess is VRFV2PlusWrapperConsumerBase {

    // ---------------------------------------------------------------------
    // VRF v2.5 direct-funding config for Base Sepolia.
    // DOUBLE-CHECK these three values against docs.chain.link (VRF v2.5 ->
    // Supported Networks -> Base Sepolia) before deploying. If any address
    // or the key hash has an extra/missing hex digit, the file simply won't
    // compile, which is your safety net here.
    // ---------------------------------------------------------------------
    bytes32 internal keyHash;
    uint32 public callbackGasLimit = 150000;   // tune to actual gas used by fulfillRandomWords
    uint16 public requestConfirmations = 3;    // network min 0 / max 200
    uint32 public numWords = 1;


    uint256 public FreeBetLink = 0.01 * 10**18; // starting rebate amount in LINK (18 decimals)
    uint256 public constant FREE_BET_LINK_FLOOR = 0.1 * 10**18; // hard minimum the setter will allow
    uint256 public constant REBATE_MIN_BET = 50 * 10**18; // min Forge bet size to qualify for rebate

    // ── Modifiers ──────────────────────────────────────────────


//MUST CHANGE BACK TO 50 * 10 ** 18 for launch
    uint256 private constant AmountWeOWE_PER_POSITION_Constant = (0.50 * 10 ** 18); //50 tokens of B0x
    uint256 public AmountWeOWE_PER_POSITION2 = (50 * 10 ** 18); //100 tokens of B0x
    address public owner = 0x23400DC0cC44fb8F295fD4C73bB19528066b59f3;
    
    modifier onlyOwner() {
        if (msg.sender != owner) require(false, "Not owner of vault");
        _;
    }
    
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");
        owner = newOwner;
    }



    LinkTokenInterface internal immutable LINK;

    // ---------------------------------------------------------------------
    // Guess storage (unchanged from original)
    // ---------------------------------------------------------------------
    uint256 public betid = 0;
    uint256 public betidIN = 0;
    mapping(uint256 => uint256) public betResults;
    mapping(uint256 => uint256) public blockNumForBetID;
    mapping(uint256 => uint256) public betAmt;
    mapping(uint256 => uint256) public betOdds;
    mapping(uint256 => uint256) public randomNumber;
    mapping(uint256 => address) public betee;
    mapping(uint256 => uint256) public winnings;
    mapping(address => int) public profitz;
    mapping(address => int) public profitzGuess;

    uint256 public unreleased = 0;
    uint256 public totalSupply = 1;

    mapping(address => uint256) private _balances;

    IERC20 public stakedToken;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event GuessNote(uint256 UsersGuess, uint256 amount, address indexed user, uint256 betID);
    event ShowAnswer(
        uint256 UsersGuess,
        uint256 Result,
        uint256 amountWagered,
        uint256 betID,
        address indexed AddressOfGuesser,
        uint256 AmountWon,
        uint256 chainlinkRandom
    );

    string constant _transferErrorMessage = "staked token transfer failed";

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }



    
    // ── Internal bookkeeping ───────────────────────────────────

    /// @notice StateView periphery contract for reading Uniswap v4 pool state
    /// @dev Deployed address is Base-specific — confirm this matches the actual
    ///      StateView deployment for your target chain before relying on it
    IStateView private immutable stateView = IStateView(0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71);


    /// @notice PoolId for the B0x/ETH Uniswap v4 pool
    /// @dev Computed off-chain as keccak256(abi.encode(PoolKey)); cannot be reversed
    ///      back into currency0/currency1/fee/tickSpacing/hooks on-chain
    bytes32 private constant POOL_ID = 0x6d7608e5974f1aa1bc8ac9b33ae7fdd41a55b24f53007a7f5ed41ee5b15fb194;


    /// @notice USDC/ETH pool address on Base for price reference
    /// @dev Used for sqrtPriceX96 calculations, Uniswap V3 pool on Base mainnet.
    ///      token0 = WETH, token1 = USDC for this specific pool.
    address private constant POOL_ADDRESS = 0xd0b53D9277642d899DF5C87A3966A349A798F224;


    /// @notice Retrieves the current ETH price in USD with high precision
    /// @dev Uses Uniswap V3 slot0() on the ETH/USDC pool. Result scale is
    ///      empirically 1e12 relative to a real USD value (verified on-chain:
    ///      raw output 1924830398032519 corresponded to $1,924.83, i.e. raw/1e12 = USD).
    /// @return price ETH price in USD, scaled by ~1e12 (divide return value by 1e12 to get USD)
    function getETHUSDC_PricePrecise() public view returns (uint256 price) {

         //Fix return for now until mainnet then remove!
        IUniswapV3Pool pool = IUniswapV3Pool(POOL_ADDRESS);
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
        
        // Calculate price = (sqrtPriceX96)^2 * 10^22 / 2^192
        // Using mulDiv to handle large numbers safely
        
        if (sqrtPriceX96 <= type(uint128).max) {
            // Safe to square without overflow
            uint256 priceX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            return (priceX192 * 1e24) >> 192;
        } else {
            // Use FullMath.mulDiv for large numbers
            // You'll need to import @uniswap/v3-core/contracts/libraries/FullMath.sol
            uint256 priceX128 = MulDiv.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
            return MulDiv.mulDiv(priceX128, 1e24, 1 << 128);
        }
    }
    

    /// @notice Retrieves the raw B0x/ETH price ratio from the Uniswap v4 pool
    /// @dev Reads pool state via StateView.getSlot0() since v4 pools have no
    ///      individually deployed contract to call slot0() on directly.
    ///      Both B0x and ETH are assumed to have 18 decimals, so no decimal-gap
    ///      correction is applied (unlike getETHPricePrecise(), which needs a
    ///      1e12 correction for WETH's 18 vs USDC's 6 decimals). Output is
    ///      scaled directly by 1e18.
    /// @return price Raw price of currency0 in terms of currency1 for the B0x/ETH
    ///      pool, scaled by 1e18. Whether this represents "B0x per ETH" or
    ///      "ETH per B0x" depends on which token is currency0 vs currency1 —
    ///      verify via the pool's Initialize event before relying on the
    ///      division direction used downstream in getPriceOFB0xINUSD().
    function getETHB0x_PricePrecise() public view returns (uint256 price) {
        // v4 slot0 only exposes sqrtPriceX96, tick, protocolFee, lpFee — no observation index/cardinality fields
      
        (uint160 sqrtPriceX96, , , ) = stateView.getSlot0(POOL_ID);


        // Always route through mulDiv — avoids overflow regardless of how large
        // sqrtPriceX96 is, unlike the raw-multiply fast path which can overflow
        // once sqrtPriceX96 approaches 2^128.
        uint256 priceX128 = MulDiv.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
        //return MulDiv.mulDiv(priceX128, 1e24, 1 << 128);
        return MulDiv.mulDiv(priceX128, 1e18, 1 << 128); // 1e18, NOT 1e24
    }

    
    /// @notice Computes the current B0x price in USD by combining ETH/USDC and B0x/ETH pool data
    /// @dev Formula: ETH_USD * 1e18 / B0xEth_raw. This is only correct if
    ///      getETHB0x_PricePrecise() returns "B0x per 1 ETH" (i.e. currency0 = ETH,
    ///      currency1 = B0x in that pool). If the pool's token ordering is reversed,
    ///      this division should be a multiplication instead — UNVERIFIED, confirm
    ///      against the pool's actual currency0/currency1 before relying on this in production.
    /// @return PriceOf1B0x Price of 1 B0x token in USD, scaled by ~1e12 (same scale as getETHUSDC_PricePrecise())
    function getPriceOFB0xINUSD() public view returns (uint PriceOf1B0x) {
     
    	return MulDiv.mulDiv(getETHUSDC_PricePrecise(),1e10, MulDiv.mulDiv(getETHB0x_PricePrecise(),1e10,1e12));
    
    }
        
        
    /// @notice Value most recently confirmed as pending, awaiting checkpoint confirmations for fee adjustment.
    uint256 public pendingFeeAmount;

    /// @notice Timestamp at which the current checkpoint sequence was first started for fee adjustment.
    uint256 public pendingFeeTimestamp;

    /// @notice Timestamp of the most recently passed checkpoint for fee adjustment.
    uint256 public lastFeeCheckpointTimestamp;

    /// @notice Number of consecutive checkpoints passed for the current pendingFeeAmount (0, 1, or 2)
    uint256 private checkpointsPassed;

    /// @notice Number of confirmations required before a value commits
    uint256 private constant REQUIRED_CHECKPOINTS = 4;

    /// @notice Minimum time between each checkpoint confirmation
    uint256 private constant CHECKPOINT_DELAY = 46 hours;
    
    /// @notice Checks whether calling setAmountWeOwePerPosition() right now would
    ///         actually change state, or would just waste gas on a no-op / revert
    /// @dev Mirrors the exact branching logic of setAmountWeOwePerPosition():
    ///      - If the freshly computed amount matches the already-committed value,
    ///        this is only actionable if there's a stale in-progress sequence to
    ///        clear (checkpointsPassed != 0); otherwise there's nothing to do.
    ///      - If no sequence is active, or the computed amount differs from what's
    ///        currently pending, a call is always actionable (starts/restarts the
    ///        sequence regardless of timing).
    ///      - If the same value is still pending, a call is only actionable once
    ///        CHECKPOINT_DELAY has elapsed since the last checkpoint.
    ///      NOTE: this computes queryRequiredB0xAmount(), which reads live pool
    ///      state — free when called off-chain via eth_call, but a real gas cost
    ///      if invoked on-chain by another contract.
    /// @return actionable True if calling setAmountWeOwePerPosition() now would
    ///      change contract state; false if it would currently no-op
    function shouldWeCall_SetAmountWeOwePerPosition() public view returns (bool actionable) {
        uint256 reqAmt = queryRequiredB0xAmount();

        // Price at committed value — only actionable if there's a stale
        // sequence to clear; otherwise nothing would happen
        if (reqAmt == AmountWeOWE_PER_POSITION2) {
            if (checkpointsPassed != 0) {
                return true;
            } else {
                return false;
            }
        }

        // No sequence active, or price changed mid-sequence — always actionable
        if (checkpointsPassed == 0 || pendingFeeAmount != reqAmt) {
            return true;
        }

        // Same value still pending — actionable only once the delay has passed
        if (block.timestamp >= lastFeeCheckpointTimestamp + CHECKPOINT_DELAY) {
            return true;
        } else {
            return false;
        }
    }
    
    

    /// @notice Three-checkpoint, time-gated update to AmountWeOWE_PER_POSITION2
    /// @dev A newly computed amount must be confirmed 4 separate times, each
    ///      confirmation spaced at least 46 hours apart, all while the freshly
    ///      computed amount stays the same, before it commits. Any call where
    ///      the computed amount changes, or matches the already-committed value,
    ///      resets the checkpoint sequence entirely — a manipulated price must
    ///      be sustained across the full multi-checkpoint window (>= 96 hours
    ///      minimum, since 4 checkpoints require 3 full delays between them) with
    ///      no reversion at any checkpoint, or the whole sequence restarts from zero.
    function setAmountWeOwePerPosition() external {
        uint256 reqAmt = queryRequiredB0xAmount();

        // No change needed — clear any in-progress checkpoint sequence so stale
        // progress can't be reused later to shortcut the confirmation process
        if (reqAmt == AmountWeOWE_PER_POSITION2) {
            if (checkpointsPassed != 0) {
                pendingFeeAmount = 0;
                pendingFeeTimestamp = 0;
                lastFeeCheckpointTimestamp = 0;
                checkpointsPassed = 0;
                return;
            }else{
                require(false, "Check Points have not passed, must run this when queryRequiredB0xAmount() changes from AmountWeOWE_PER_POSITION2");
                return;
            }
        }


        // No sequence in progress, or the value changed mid-sequence — start fresh
        if (checkpointsPassed == 0 || pendingFeeAmount != reqAmt) {
            pendingFeeAmount = reqAmt;
            pendingFeeTimestamp = block.timestamp;
            lastFeeCheckpointTimestamp = block.timestamp;
            checkpointsPassed = 1;
            return;
        }



	// Same value still pending — must wait the full delay to advance
	require(block.timestamp >= lastFeeCheckpointTimestamp + CHECKPOINT_DELAY, "Not enough time has passed between checkpoints, takes >46h since last checkpoint.");
	    
    
        // Same value still pending — check if enough time has passed since the
        // last checkpoint to advance to the next one
        if (block.timestamp >= lastFeeCheckpointTimestamp + CHECKPOINT_DELAY) {
            checkpointsPassed += 1;
            lastFeeCheckpointTimestamp = block.timestamp;

            if (checkpointsPassed >= REQUIRED_CHECKPOINTS) {
                AmountWeOWE_PER_POSITION2 = reqAmt;
                pendingFeeAmount = 0;
                pendingFeeTimestamp = 0;
                lastFeeCheckpointTimestamp = 0;
                checkpointsPassed = 0;
            }
        }else{
	    require(false, "Not enough time has passed between checkpoints, takes >46h since last checkpoint.");
	}
        
    }
    
    
    /// @notice Computes the current required B0x amount using a step schedule.
    /// @dev Steps: price <= 4000 -> 50, > 4000 -> 33.33, > 8000 -> 22.22,
    ///      > 16000 -> 14.81, > 32000 -> 9.88, etc. Each doubling of price
    ///      reduces the required amount by 1/3 (÷1.5), in discrete steps.
    ///      Capped at 20 halvings max, regardless of how high price goes.
    ///      Never returns less than 0.0000001 token (0.0000001e18).
    function queryRequiredB0xAmount() public view returns (uint256 requiredAmount) {
        uint256 currentPrice = getPriceOFB0xINUSD();
        uint256 amount = AmountWeOWE_PER_POSITION_Constant;
        uint256 threshold = 2000;
        uint256 MIN_AMOUNT = 0.0000001 * 10 ** 18; // 0.0000001 token minimum floor
	uint256 EVEN_MIN_AMOUNT = 0.2 * 10 ** 18;
        for (uint256 i = 0; i < 50; i++) {
            if (currentPrice <= threshold) {
                break;
            }
            
            
            amount = amount / 2; // divide by 2, integer-safe
            
            
            threshold = threshold * 2;
            if (amount <= MIN_AMOUNT) {
                return MIN_AMOUNT;
            }
        }

        return amount < MIN_AMOUNT ? MIN_AMOUNT : amount;
    }
    
    


    constructor(address _stakedToken)
        VRFV2PlusWrapperConsumerBase(0xb0407dbe851f8318bd31404A49e658143C982F23) // VRF Wrapper (Base Mainnet)
    {
        LINK = LinkTokenInterface(0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196); // LINK token (Base Mainnet)
        keyHash = 0xdc2f87677b01473c763cb0aee938ed3341512f6057324a584e5944e786144d70; // 30 gwei lane
        stakedToken = IERC20(_stakedToken);
    }

    /**
     * @notice Live LINK cost of one VRF request at the current settings/gas price.
     * Replaces the old fixed `fee` constant.
     */
    function requestPrice() public view returns (uint256) {
        return i_vrfV2PlusWrapper.calculateRequestPrice(callbackGasLimit, numWords);
    }



    // --- setter, owner-gated ---
    function setFreeBetLink(uint256 newAmount) external onlyOwner {
        require(newAmount >= FREE_BET_LINK_FLOOR, "FreeBetLink cannot go below floor");
        FreeBetLink = newAmount;
    }


    /**
     * Requests randomness, paid for in LINK by the caller.
     * extraLINK keeps its original meaning: extra "units" of the current
     * request price pulled from the user to top up the contract's LINK buffer.
     */
     
     function getRandomNumber(uint256 guess, uint256 amt) public returns (uint256 requestId) {
	    uint256 esT = estOUTPUT(amt, guess);
	    require(amt < esT, "You will loose money everytime at these settings");
	    require(amt >= AmountWeOWE_PER_POSITION2/10, "Min bet AmountWeOWE_PER_POSITION2/10 B0x");
	    require(MaxINForGuess(guess) >= amt, "Bankroll too low for this bet, Please lower bet");
	    require(guess < 98 && guess > 0, "Must guess between 1-98");
	    require(stakedToken.transferFrom(msg.sender, address(this), amt), "Transfer must work");

	    // Pull a quote, request, then refund whatever we didn't actually spend.
	    uint256 quoted = requestPrice();
	    
	    

	    uint256 subsidy = 0;
	    if (amt >= AmountWeOWE_PER_POSITION2*20) {
	        subsidy = FreeBetLink > quoted ? quoted : FreeBetLink;
	        uint256 contractBal = LINK.balanceOf(address(this));
	        if (subsidy > contractBal) {
		    subsidy = contractBal; // never try to pay out more than we hold
	        }
            }

            uint256 userPortion = quoted - subsidy;
            if (userPortion > 0) {
	        require(LINK.transferFrom(msg.sender, address(this), userPortion), "LINK transfer failed");
            }





	    betOdds[betidIN] = guess;
	    betAmt[betidIN] = amt;
	    betee[betidIN] = msg.sender;
	    winnings[betidIN] = esT;
	    profitzGuess[msg.sender] -= int(amt);
	    blockNumForBetID[betidIN] = block.number;
	    emit GuessNote(guess, amt, msg.sender, betidIN);
	    betidIN++;
	    unreleased += amt;

	    bytes memory extraArgs = VRFV2PlusClient._argsToBytes(
		VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
	    );

	    uint256 actualPrice;
	    (requestId, actualPrice) = requestRandomness(callbackGasLimit, requestConfirmations, numWords, extraArgs);

	    if (quoted > actualPrice) {
	        uint256 refund = quoted - actualPrice;
	        if (amt >= REBATE_MIN_BET) {
		    refund += FreeBetLink;
	        }
	        LINK.transfer(msg.sender, refund);
	    }
    }



    function lastBlockFilled() public view returns (uint256) {
        if (betid == betidIN) {
            return block.number;
        }
        return blockNumForBetID[betid];
    }

    function MaxINForGuess(uint256 guess) public view returns (uint256) {
        uint256 ret = ((IERC20(address(stakedToken)).balanceOf(address(this)) - unreleased) * guess) / (50 * 21);
        return ret;
    }

    function penalty() public view returns (uint num) {
        uint tot = 0;
        for (uint x = betid; x < betidIN; x++) {
            tot += winnings[x];
        }
        return tot;
    }

    // Incase of Chainlink failure -- pay for an extra "blank" VRF request
    function getBlank(uint256 extraLINK) public returns (uint256 requestId) {
        uint256 unitPrice = requestPrice();
        require(LINK.transferFrom(msg.sender, address(this), unitPrice * extraLINK), "LINK transfer failed");

        bytes memory extraArgs = VRFV2PlusClient._argsToBytes(
            VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
        );
        (requestId, ) = requestRandomness(callbackGasLimit, requestConfirmations, numWords, extraArgs);
    }

    /**
     * VRF v2.5 callback. Replaces fulfillRandomness(bytes32, uint256).
     * requestId is unused here because bets are processed as a FIFO queue
     * (betid/betidIN), same as the original contract.
     */
    function fulfillRandomWords(uint256 /* requestId */, uint256[] memory randomWords) internal override {
        if (betid >= betidIN) {
            return;
        }

        uint256 randomness = randomWords[0];

        randomNumber[betid] = randomness;
        betResults[betid] = randomness % 100;
        address Guesser = betee[betid];
        uint256 odds = betOdds[betid];
        uint256 betAmount = betAmt[betid];
        uint256 esT = winnings[betid];
        if (randomness % 100 < odds) {
            profitzGuess[Guesser] += int(esT);
            stakedToken.transfer(Guesser, esT);
        } else {
            stakedToken.transfer(Guesser, 1);
            profitzGuess[Guesser] += int(1);
            winnings[betid] = 1;
        }
        unreleased -= betAmount;
        emit ShowAnswer(odds, randomness % 100, betAmount, betid, Guesser, winnings[betid], randomness);
        betid++;
    }

    // Stake and become the house
    function stakeFor(address forWhom, uint256 amount) public virtual {
        IERC20 st = stakedToken;
        require(amount > 0, "Cannot stake 0");

        unchecked {
            uint toAdd = (amount * totalSupply) / (IERC20(address(stakedToken)).balanceOf(address(this)) - unreleased);
            _balances[forWhom] += toAdd;
            totalSupply += toAdd;
            profitz[forWhom] -= int(amount);
        }

        require(st.transferFrom(msg.sender, address(this), amount), _transferErrorMessage);

        emit Staked(forWhom, amount);
    }

    function maxGuessPerInput(uint guess, uint amt) public view returns (uint) {
        uint x = 0;

        for (x = 0; x < 90; x++) {
            if (MaxINForGuess(98 - x) < amt) {
                amt = MaxINForGuess(99 - x);
            }
            if (estOUTPUT(amt, 99 - x) > amt) {
                break;
            }
        }
        return 99 - x;
    }

    // Output amount of payout based on odds and bet
    function estOUTPUT(uint256 betAmount, uint256 odds) public view returns (uint256) {
        uint256 ratioz = (IERC20(address(stakedToken)).balanceOf(address(this)) - unreleased) * 50 / (betAmount * odds);
        uint256 estOutput = 0;
        if (ratioz < 30) {
            estOutput = (100 * 90 * betAmount) / (odds * 100);
        } else if (ratioz < 50) {
            estOutput = (100 * 93 * betAmount) / (odds * 100);
        } else if (ratioz < 100) {
            estOutput = (100 * 96 * betAmount) / (odds * 100);
        } else if (ratioz < 200) {
            estOutput = (100 * 98 * betAmount) / (odds * 100);
        } else if (ratioz < 400) {
            estOutput = (100 * 99 * betAmount) / (odds * 100);
        } else if (ratioz < 1000) {
            estOutput = (100 * 995 * betAmount) / (odds * 1000);
        } else {
            estOutput = (100 * 99 * betAmount) / (odds * 100);
        }

        return estOutput;
    }

    // Withdrawal estimator
    function withEstimator(uint256 amountOut) public view returns (uint256) {
        uint256 v = (975 * uOut(amountOut) / 1000);
        return v;
    }

    // Withdrawal estimator
    function currentForge(address forWhom) public view returns (uint256) {
        uint256 v = (975 * uOut(balanceOf(forWhom)) / 1000);
        return v;
    }

    // Prevents you from withdrawing if large bets are in play
    function perfectWithdraw(uint maxLoss) public {
        withdraw(balanceOf(msg.sender), maxLoss);
    }

    function uOut(uint amount) public view returns (uint256 tot) {
        uint256 stakeMinusUnreleased = (IERC20(address(stakedToken)).balanceOf(address(this)) - unreleased);
        uint256 amt = amount * stakeMinusUnreleased / totalSupply;
        tot = amt - (amt * penalty()) / stakeMinusUnreleased;
        return tot;
    }

    // 2.5% fee on withdrawals back to holders
    function withdraw(uint256 amount, uint256 maxLoss) public virtual {
        if (maxLoss < penalty()) {
            return;
        }

        require(amount <= _balances[msg.sender], "withdraw: balance is lower");

        uint OutEst = uOut(amount);

        unchecked {
            _balances[msg.sender] -= amount;
            totalSupply = totalSupply - amount;
            profitz[msg.sender] += int(OutEst * 975 / 1000);
        }

        require(stakedToken.transfer(address(this), (OutEst * 25 / 1000)));
        require(stakedToken.transfer(msg.sender, ((OutEst * 975) / 1000)));

        emit Withdrawn(msg.sender, amount);
    }

    function Profit(address user) public view returns (int) {
        uint256 withdrawable = withEstimator(balanceOf(user));
        int profit = profitz[user] + int(withdrawable);
        return profit;
    }

    function blockNumber() public view returns (uint) {
        return block.number;
    }
}
