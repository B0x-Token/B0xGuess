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
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

// --- Deployed addresses (Base mainnet) ---
const B0XGUESS_ADDRESS = "0xE55B36c9Be6Fca80D78c36907F15Fd03b33a42C0";
const STAKED_TOKEN_ADDRESS = "0x6B19E31C1813cD00b0d47d798601414b79A3e8AD"; // B0x
const LINK_TOKEN_ADDRESS = "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196"; // hardcoded in B0xGuess.sol's constructor

// --- B0xGuess.sol ABI (only the parts the UI actually calls) ---
const B0XGUESS_ABI = [
  // reading state
  "function owner() view returns (address)",
  "function stakedToken() view returns (address)",
  "function balanceOf(address account) view returns (uint256)",
  "function currentForge(address forWhom) view returns (uint256)",
  "function Profit(address user) view returns (int256)",
  "function totalSupply() view returns (uint256)",
  "function unreleased() view returns (uint256)",
  "function betid() view returns (uint256)",
  "function betidIN() view returns (uint256)",
  "function betee(uint256) view returns (address)",
  "function winnings(uint256) view returns (uint256)",
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
  "function getBlank(uint256 extraLINK) returns (uint256 requestId)",
  "function stakeFor(address forWhom, uint256 amount)",
  "function withdraw(uint256 amount, uint256 maxLoss)",
  "function perfectWithdraw(uint256 maxLoss)",
  "function setAmountWeOwePerPosition()",
  "function setFreeBetLink(uint256 newAmount)",
  "function transferOwnership(address newOwner)",

  // events
  "event GuessNote(uint256 UsersGuess, uint256 amount, address indexed user, uint256 betID)",
  "event ShowAnswer(uint256 UsersGuess, uint256 Result, uint256 amountWagered, uint256 betID, address indexed AddressOfGuesser, uint256 AmountWon, uint256 chainlinkRandom)",
  "event Staked(address indexed user, uint256 amount)",
  "event Withdrawn(address indexed user, uint256 amount)",
];

// --- Minimal ERC-20 ABI, used for both B0x and LINK ---
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
