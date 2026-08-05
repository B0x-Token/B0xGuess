// config.js
// Everything specific to this deployment lives here: network info,
// contract addresses, and the two ABIs. Human-readable ABI strings
// (supported by ethers.js) are used instead of raw JSON so the list
// of functions/events is easy to scan.

const BASE_CHAIN_ID_HEX = "0x2105"; // 8453 in decimal — Base mainnet
const BASE_NETWORK_PARAMS = {
  chainId: BASE_CHAIN_ID_HEX,
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  // Listed in fallback order for wallets adding Base for the first time via
  // this dapp (wallet_addEthereumChain). Doesn't affect wallets that already
  // have Base configured — that RPC choice lives in the wallet's own settings.
  rpcUrls: ["https://mainnet.base.org", "https://base.llamarpc.com", "https://1rpc.io/base"],
  blockExplorerUrls: ["https://basescan.org"],
};

// --- RPC used for all contract reads / event polling ---
// Deliberately separate from the wallet's own RPC (used only to sign and
// send transactions, via BrowserProvider/window.ethereum) — the wallet's
// request budget shouldn't have to absorb the read-heavy polling this dapp
// does (bet estimates, activity feed, block-range log queries). User-editable
// at the bottom of the page; persisted in localStorage.
const DEFAULT_RPC_URL = "https://gateway.tenderly.co/public/base";
const RPC_URL_STORAGE_KEY = "b0xguess_rpc_url";

function getRpcUrl() {
  return localStorage.getItem(RPC_URL_STORAGE_KEY) || DEFAULT_RPC_URL;
}

// --- Multicall3 — deployed at this same address on nearly every EVM chain
// (Base included) via a deterministic deployer. Used to batch almost every
// read in app.js into one eth_call instead of one per field. ---
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
];

// --- Deployed addresses (Base mainnet) ---
const B0XGUESS_ADDRESS = "0x050F31Ed5096075a087cF79b354134C574807e37";
const STAKED_TOKEN_ADDRESS = "0x6B19E31C1813cD00b0d47d798601414b79A3e8AD"; // B0x
const LINK_TOKEN_ADDRESS = "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196"; // hardcoded in B0xGuess.sol's constructor

// --- B0xGuess.sol ABI (only the parts the UI actually calls) ---
const B0XGUESS_ABI = [
  // reading state
  "function owner() view returns (address)",
  "function stakedToken() view returns (address)",
  "function balanceOf(address account) view returns (uint256)",
  "function currentForge(address forWhom) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function unreleased() view returns (uint256)",
  "function betid() view returns (uint256)",
  "function betidIN() view returns (uint256)",
  "function betAmt(uint256) view returns (uint256)",
  "function betOdds(uint256) view returns (uint256)",
  "function betResults(uint256) view returns (uint256)",
  "function betee(uint256) view returns (address)",
  "function winnings(uint256) view returns (uint256)",
  "function getUserBetCount(address user) view returns (uint256)",
  "function getUserBetIds(address user, uint256 offset, uint256 limit) view returns (uint256[] ids)",
  "function AmountWeOWE_PER_POSITION2() view returns (uint256)",
  "function FreeBetLink() view returns (uint256)",
  "function REBATE_MIN_BET() view returns (uint256)",
  "function requestPrice() view returns (uint256)",
  "function getPriceOFB0xINUSD() view returns (uint256)",
  "function queryRequiredB0xAmount() view returns (uint256)",
  "function MaxINForGuess(uint256 guess) view returns (uint256)",
  "function estOUTPUT(uint256 betAmount, uint256 odds) view returns (uint256)",
  "function withEstimator(uint256 amountOut) view returns (uint256)",
  "function uOut(uint256 amount) view returns (uint256)",
  "function penalty() view returns (uint256)",
  "function shouldWeCall_SetAmountWeOwePerPosition() view returns (bool)",

  // sending transactions
  "function getRandomNumber(uint256 guess, uint256 amt) returns (uint256 requestId)",
  "function getBlank() returns (uint256 requestId)",
  "function stake(uint256 amount)",
  "function withdraw(uint256 amount, uint256 maxLoss)",
  "function perfectWithdraw(uint256 maxLoss)",
  "function setAmountWeOwePerPosition()",
  "function setFreeBetLink(uint256 guess, uint256 amt) returns (uint256 requestId)",
  "function transferOwnership(address newOwner)",

  // events
  "event GuessNote(uint256 UsersGuess, uint256 amount, address indexed user, uint256 betID)",
  "event ShowAnswer(uint256 UsersGuess, uint256 Result, uint256 amountWagered, uint256 betID, address indexed AddressOfGuesser, uint256 AmountWon, uint256 chainlinkRandom)",
];

// --- Minimal ERC-20 ABI, used for both B0x and LINK ---
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// --- Uniswap v3 on Base — used only by the "Buy LINK" convenience swap ---
// Addresses verified against BaseScan's "Uniswap V3: Swap Router02" /
// "Uniswap V3: QuoterV2" / "Wrapped Ether" labels, and the pool itself
// verified on-chain: factory.getPool(WETH, LINK, 3000) returns the exact
// LINK/WETH 0.3% pool address this was built against
// (0x224a5D3f2155f2F85Af70B6D72AEa61a15273ff4).
const UNISWAP_SWAP_ROUTER02_ADDRESS = "0x2626664c2603336E57B271c5C0b26F421741e481";
const UNISWAP_QUOTER_V2_ADDRESS = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const LINK_WETH_POOL_FEE = 3000; // 0.3%

// Signatures confirmed against SwapRouter02's verified source on BaseScan.
// Note: SwapRouter02 (unlike the original SwapRouter) has no `deadline`
// field on its single-hop swap params.
const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
];

// Signature confirmed against QuoterV2's verified source on BaseScan.
// Not a view function (it simulates the swap), so it must be called with
// .staticCall(...) rather than invoked directly.
const QUOTER_ABI = [
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];
