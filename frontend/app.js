// app.js
// All the wallet/contract logic for the B0x Guess dApp. No build step,
// no framework — just ethers.js (loaded from a CDN in index.html) and
// plain DOM calls, so it reads top to bottom like a normal script.

// Fallback bet size used only where no live contract data is available yet
// (the bet input's min/step attributes at page load, and the LINK-cost
// fallback before an amount is typed). The actual minimum bet shown in the
// UI and enforced in warnings is computed live as AmountWeOWE_PER_POSITION2 / 50,
// matching the contract's require() in getRandomNumber() — not this constant.
const MIN_BET_B0X = 0.01;

// Extra LINK approved on top of the quoted "Est. LINK cost (yours)" amount.
// requestPrice() is a live quote — on Base it includes a volatile L1
// data-fee component, so the price at the moment getRandomNumber() actually
// executes can be much higher than what was quoted a block or two earlier
// (observed: quoted ~0.000004 LINK, actual cost ~0.0007 LINK). Approving
// only the exact quoted amount risks the on-chain LINK.transferFrom()
// reverting for insufficient allowance. Approving extra LINK is harmless —
// it's just spending permission, not a transfer — so pad generously.
const LINK_APPROVAL_BUFFER = 0.002;

// requestPrice()'s live quote reads far lower than what a bet actually ends
// up costing in LINK once mined (observed: quoted 0.000004 LINK, real cost
// 0.0007 LINK — a ~175x gap from Base's volatile L1 data-fee component).
// Doubled again on top of that (350x) for extra headroom. This scales the
// *displayed* "Est. LINK cost" and "you need X LINK" figures so users see
// a realistic number, without changing the actual approval math above
// (which is already padded generously via the buffer).
const LINK_COST_DISPLAY_MULTIPLIER = 350n;

// "Buy LINK with ETH" targets a purchase of ~3x the current single-bet
// "Est. LINK cost (yours)" — within the 2x-5x range needed to cover a
// couple of bets — protected by a normal 5% slippage tolerance around
// that target.
//
// NOTE: an earlier version sized the ETH input for 5x while only
// floor-protecting the output at 2x. Wallets correctly read that gap as a
// ~60% slippage tolerance ((5x-2x)/5x) — technically safe (it can never
// deliver less than 2x) but alarming, and exactly the kind of wide
// tolerance that invites a sandwich attack. A tight tolerance around a
// single target is the standard, correct pattern.
const LINK_BUY_TARGET_MULTIPLIER = 3n;
const LINK_BUY_SLIPPAGE_TOLERANCE = 0.05; // 5%
const ETH_GAS_RESERVE = "0.0002"; // left unspent so the wallet can still pay gas for the swap itself

// How many recently-resolved bets to backfill into "Recent Activity" on
// connect/reload.
const ACTIVITY_HISTORY_BET_COUNT = 20;

// How many of your own bets "My Bets" fetches per page, via
// getUserBetIds() — requires the redeployed contract (see B0xGuess.sol).
const MY_BETS_PAGE_SIZE = 10;

const els = {
  connectBtn: document.getElementById("connect-btn"),
  networkBadge: document.getElementById("network-badge"),
  walletAddress: document.getElementById("wallet-address"),
  walletB0xBalance: document.getElementById("wallet-b0x-balance"),
  app: document.getElementById("app"),
  connectHint: document.getElementById("connect-hint"),

  statB0xBalance: document.getElementById("stat-b0x-balance"),
  statPrice: document.getElementById("stat-price"),
  statPool: document.getElementById("stat-pool"),
  statMinbet: document.getElementById("stat-minbet"),
  statFreebet: document.getElementById("stat-freebet"),
  statFreebetLabel: document.getElementById("stat-freebet-label"),

  guessInput: document.getElementById("guess-input"),
  guessNumberInput: document.getElementById("guess-number-input"),
  winChanceValue: document.getElementById("win-chance-value"),
  winChanceFraction: document.getElementById("win-chance-fraction"),
  betAmountInput: document.getElementById("bet-amount-input"),
  estPayout: document.getElementById("est-payout"),
  estMaxbet: document.getElementById("est-maxbet"),
  estLinkCost: document.getElementById("est-link-cost"),
  statLinkBalance: document.getElementById("stat-link-balance"),
  buyLinkSection: document.getElementById("buy-link-section"),
  buyLinkBtn: document.getElementById("buy-link-btn"),
  buyLinkStatus: document.getElementById("buy-link-status"),
  betWarning: document.getElementById("bet-warning"),
  placeBetBtn: document.getElementById("place-bet-btn"),
  betStatus: document.getElementById("bet-status"),

  stakeAmountInput: document.getElementById("stake-amount-input"),
  stakeMaxBtn: document.getElementById("stake-max-btn"),
  stakeBtn: document.getElementById("stake-btn"),
  stakeStatus: document.getElementById("stake-status"),
  statShares: document.getElementById("stat-shares"),
  statWithdrawable: document.getElementById("stat-withdrawable"),
  maxLossInput: document.getElementById("max-loss-input"),
  withdrawAllBtn: document.getElementById("withdraw-all-btn"),
  withdrawStatus: document.getElementById("withdraw-status"),

  activityFeed: document.getElementById("activity-feed"),

  myBetsList: document.getElementById("my-bets-list"),
  myBetsStatus: document.getElementById("my-bets-status"),
  myBetsLoadMoreBtn: document.getElementById("my-bets-load-more-btn"),

  blankAmountInput: document.getElementById("blank-amount-input"),
  getBlankBtn: document.getElementById("get-blank-btn"),
  blankStatus: document.getElementById("blank-status"),

  ownerPanel: document.getElementById("owner-panel"),
  checkpointReady: document.getElementById("checkpoint-ready"),
  checkpointBtn: document.getElementById("checkpoint-btn"),
  freeBetInput: document.getElementById("free-bet-input"),
  setFreeBetBtn: document.getElementById("set-free-bet-btn"),
  newOwnerInput: document.getElementById("new-owner-input"),
  transferOwnerBtn: document.getElementById("transfer-owner-btn"),
  ownerStatus: document.getElementById("owner-status"),

  contractLink: document.getElementById("contract-link"),
};

els.contractLink.href = `${BASE_NETWORK_PARAMS.blockExplorerUrls[0]}/address/${B0XGUESS_ADDRESS}`;

// Keep the spin-button step/floor in sync with MIN_BET_B0X so the arrows
// never let you decrement past a valid bet size (previously: step="any"
// fell back to whole-number arrow clicks, so clicking down from 1 landed
// straight on 0).
els.betAmountInput.min = String(MIN_BET_B0X);
els.betAmountInput.step = String(MIN_BET_B0X);

// --- Global state, filled in once the wallet connects ---
let provider, signer, userAddress;
let b0xGuessRead, b0xGuessWrite;
let stakedTokenRead, stakedTokenWrite;
let linkTokenRead, linkTokenWrite;
let swapRouterWrite, quoterRead;
let stakedDecimals = 18;
const LINK_DECIMALS = 18;

// "My Bets" pagination cursor — how many of the user's oldest bets are left
// unfetched. null until the first load; 0n once there's nothing older left.
let myBetsRemainingOffset = null;

// Raw wallet B0x balance (wei), refreshed alongside the formatted display
// text in refreshWalletInfo() — kept as a bigint so the Stake "Max" button
// can fill the input exactly, without reparsing a rounded display string.
let userB0xBalanceWei = 0n;

// --- Formatting helpers ---
function fmt(bigintValue, decimals, digits = 4) {
  return Number(ethers.formatUnits(bigintValue, decimals)).toFixed(digits);
}

function fmtUsd(rawPrice) {
  // getPriceOFB0xINUSD()'s doc comment claims a ~1e12 scale, but tracing
  // its actual mulDiv chain (ETHUSDC[1e12] combined with ETHB0x[1e18] via
  // two mulDiv(_, 1e10, _) calls) shows the real scale is 1e6. The 1e12
  // comment appears to be a stale copy from getETHUSDC_PricePrecise().
  return "$" + (Number(rawPrice) / 1e6).toFixed(10);
}

function shortAddr(addr) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function setStatus(el, message, kind) {
  el.textContent = message;
  el.className = "status" + (kind ? " " + kind : "");
}

// --- Connecting & network handling ---

async function ensureBaseNetwork() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID_HEX }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [BASE_NETWORK_PARAMS],
      });
    } else {
      throw switchError;
    }
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    alert("No wallet found. Please install MetaMask or another Base-compatible wallet.");
    return;
  }

  registerWalletEvents(); // safety net — see registerWalletEvents() for why this can't just run once at script load

  await window.ethereum.request({ method: "eth_requestAccounts" });
  await ensureBaseNetwork();

  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  userAddress = await signer.getAddress();

  b0xGuessRead = new ethers.Contract(B0XGUESS_ADDRESS, B0XGUESS_ABI, provider);
  b0xGuessWrite = b0xGuessRead.connect(signer);
  stakedTokenRead = new ethers.Contract(STAKED_TOKEN_ADDRESS, ERC20_ABI, provider);
  stakedTokenWrite = stakedTokenRead.connect(signer);
  linkTokenRead = new ethers.Contract(LINK_TOKEN_ADDRESS, ERC20_ABI, provider);
  linkTokenWrite = linkTokenRead.connect(signer);
  swapRouterWrite = new ethers.Contract(UNISWAP_SWAP_ROUTER02_ADDRESS, SWAP_ROUTER_ABI, signer);
  quoterRead = new ethers.Contract(UNISWAP_QUOTER_V2_ADDRESS, QUOTER_ABI, provider);

  try {
    stakedDecimals = await stakedTokenRead.decimals();
  } catch {
    stakedDecimals = 18;
  }

  els.walletAddress.textContent = shortAddr(userAddress);
  els.walletAddress.classList.remove("hidden");
  els.networkBadge.classList.remove("hidden");
  els.walletB0xBalance.classList.remove("hidden");
  els.connectBtn.textContent = "Connected";
  els.connectBtn.disabled = true;
  els.app.classList.remove("hidden");
  els.connectHint.classList.add("hidden");

  registerContractEvents();
  await loadActivityHistory();
  await loadMyBets(true);
  await refreshAll();
  setInterval(refreshAll, 20000);
}

// --- Reading on-chain state into the UI ---

async function refreshAll() {
  await Promise.all([refreshPoolInfo(), refreshWalletInfo(), refreshBetEstimate(), refreshOwnerPanel()]);
}

async function refreshPoolInfo() {
  const [price, poolRaw, unreleased, position, freeBet] = await Promise.all([
    b0xGuessRead.getPriceOFB0xINUSD(),
    stakedTokenRead.balanceOf(B0XGUESS_ADDRESS),
    b0xGuessRead.unreleased(),
    b0xGuessRead.AmountWeOWE_PER_POSITION2(),
    b0xGuessRead.FreeBetLink(),
  ]);

  const pool = poolRaw - unreleased;
  const minBet = position / 50n; // matches the contract's require(amt >= AmountWeOWE_PER_POSITION2 / 50)

  els.statPrice.textContent = fmtUsd(price);
  els.statPool.textContent = fmt(pool, stakedDecimals) + " B0x";
  els.statMinbet.textContent = fmt(minBet, stakedDecimals) + " B0x";
  els.statFreebet.textContent = fmt(freeBet, LINK_DECIMALS, 6) + " LINK";
  const subsidyThreshold = position * 20n;
  const subsidyThresholdDigits = Number(ethers.formatUnits(subsidyThreshold, stakedDecimals)) > 50 ? 0 : 4;
  els.statFreebetLabel.textContent = `LINK Subsidy if Over ${fmt(subsidyThreshold, stakedDecimals, subsidyThresholdDigits)} B0x Bet at once`;
}

async function refreshWalletInfo() {
  const [b0xBalance, shares, totalShares] = await Promise.all([
    stakedTokenRead.balanceOf(userAddress),
    b0xGuessRead.balanceOf(userAddress),
    b0xGuessRead.totalSupply(),
  ]);

  userB0xBalanceWei = b0xBalance;
  const b0xBalanceText = fmt(b0xBalance, stakedDecimals) + " B0x";
  els.walletB0xBalance.textContent = b0xBalanceText;
  els.statB0xBalance.textContent = b0xBalanceText;

  // "shares" is an internal accounting ratio, not a token amount —
  // totalSupply starts at the literal integer 1 (B0xGuess.sol:519), not
  // 1e18, so an early staker's raw share count can be a tiny integer that
  // rounds to "0.0000" under normal 18-decimal formatting even though it
  // correctly represents real value (see Withdrawable value below, which
  // reads out fine because uOut() works in ratios, not absolute scale).
  // Showing % of pool instead sidesteps the scale mismatch entirely.
  els.statShares.textContent =
    totalShares > 0n ? (Number((shares * 1000000n) / totalShares) / 10000).toFixed(4) + "%" : "0.0000%";

  // Fetched separately: currentForge() -> uOut() divides by the contract's
  // net staked bankroll (stakedToken balance minus unreleased), which is
  // still 0 until someone calls stakeFor() for the first time — that
  // division reverts, so isolate it instead of letting it blank out the
  // balance/shares stats above too.
  try {
    const withdrawable = await b0xGuessRead.currentForge(userAddress);
    els.statWithdrawable.textContent = fmt(withdrawable, stakedDecimals) + " B0x";
  } catch {
    els.statWithdrawable.textContent = fmt(0n, stakedDecimals) + " B0x";
  }
}

async function refreshOwnerPanel() {
  const owner = await b0xGuessRead.owner();
  if (owner.toLowerCase() !== userAddress.toLowerCase()) {
    els.ownerPanel.classList.add("hidden");
    return;
  }
  els.ownerPanel.classList.remove("hidden");
  const ready = await b0xGuessRead.shouldWeCall_SetAmountWeOwePerPosition();
  els.checkpointReady.textContent = ready ? "Yes" : "No";
}

// --- Bet estimation (updates live as the user types) ---

// Win chance is a pure function of the guess (roll is 0-99, you win if it
// lands below your guess) — no chain call needed, so it updates instantly
// rather than waiting on the debounced RPC-backed estimate below.
function updateWinChance() {
  const guess = Number(els.guessNumberInput.value);
  els.winChanceValue.textContent = `${guess}%`;
  els.winChanceFraction.textContent = `${guess} out of 100`;
}

let estimateTimer = null;
function scheduleEstimate() {
  updateWinChance();
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(refreshBetEstimate, 300);
}

async function refreshBetEstimate() {
  if (!b0xGuessRead) return;

  const guess = Number(els.guessNumberInput.value);

  const amountStr = els.betAmountInput.value;
  els.buyLinkSection.classList.remove("hidden");

  // Neither of these depends on the bet amount, so they're always kept
  // current — no need to type an amount first just to see your LINK
  // balance or how big a bet the bankroll can cover at this guess.
  const [maxBet, userLinkBal] = await Promise.all([
    b0xGuessRead.MaxINForGuess(guess),
    linkTokenRead.balanceOf(userAddress),
  ]);
  els.estMaxbet.textContent = fmt(maxBet, stakedDecimals) + " B0x";
  els.statLinkBalance.textContent = fmt(userLinkBal, LINK_DECIMALS, 6) + " LINK";

  if (!amountStr || Number(amountStr) <= 0) {
    els.estPayout.textContent = "—";

    // No bet amount yet — show the LINK cost, and check B0x/LINK sufficiency,
    // as if betting 1 B0x, so these stats/warnings don't just go blank.
    const fallbackAmtWei = ethers.parseUnits("1", stakedDecimals);
    const [positionSize, quoted, freeBetLink, contractLinkBal] = await Promise.all([
      b0xGuessRead.AmountWeOWE_PER_POSITION2(),
      b0xGuessRead.requestPrice(),
      b0xGuessRead.FreeBetLink(),
      linkTokenRead.balanceOf(B0XGUESS_ADDRESS),
    ]);
    const fallbackLinkPortion = estimateUserLinkPortion(fallbackAmtWei, positionSize, quoted, freeBetLink, contractLinkBal);
    const fallbackLinkCost = fallbackLinkPortion * LINK_COST_DISPLAY_MULTIPLIER;
    els.estLinkCost.textContent = fmt(fallbackLinkCost, LINK_DECIMALS, 6) + " LINK";
    els.buyLinkSection.classList.toggle("hidden", userLinkBal >= fallbackLinkCost * LINK_BUY_TARGET_MULTIPLIER);

    const warnings = [];
    const notEnoughB0x = fallbackAmtWei > userB0xBalanceWei;
    if (notEnoughB0x) {
      warnings.push(
        `You don't have enough B0x for this bet. <a href="https://bzerox.org/?swap" target="_blank" rel="noopener noreferrer">Buy B0x with 0xBTC or ETH on Base</a>.`
      );
    }
    const fallbackNeedsLink = userLinkBal < fallbackLinkCost;
    els.buyLinkBtn.classList.toggle("needs-link", fallbackNeedsLink && !notEnoughB0x);
    if (fallbackNeedsLink) {
      warnings.push(
        `You need ~${fmt(fallbackLinkCost, LINK_DECIMALS, 6)} LINK in your wallet to place this bet (you have ${fmt(userLinkBal, LINK_DECIMALS, 6)}).`
      );
    }

    els.placeBetBtn.disabled = warnings.length > 0;
    els.betWarning.classList.toggle("hidden", warnings.length === 0);
    if (warnings.length) {
      els.betWarning.innerHTML = warnings.join(" ");
    }
    return;
  }

  let amtWei;
  try {
    amtWei = ethers.parseUnits(amountStr, stakedDecimals);
  } catch {
    return;
  }

  const [payout, positionSize, quoted, freeBetLink, contractLinkBal] = await Promise.all([
    b0xGuessRead.estOUTPUT(amtWei, guess),
    b0xGuessRead.AmountWeOWE_PER_POSITION2(),
    b0xGuessRead.requestPrice(),
    b0xGuessRead.FreeBetLink(),
    linkTokenRead.balanceOf(B0XGUESS_ADDRESS),
  ]);

  els.estPayout.textContent = fmt(payout, stakedDecimals) + " B0x";

  const userLinkPortion = estimateUserLinkPortion(amtWei, positionSize, quoted, freeBetLink, contractLinkBal);
  const displayLinkCost = userLinkPortion * LINK_COST_DISPLAY_MULTIPLIER;
  els.estLinkCost.textContent = fmt(displayLinkCost, LINK_DECIMALS, 6) + " LINK";

  // Buying LINK targets ~3x the current cost (LINK_BUY_TARGET_MULTIPLIER) — if
  // the wallet already holds that much or more, there's nothing to buy yet.
  const buyTargetAmount = displayLinkCost * LINK_BUY_TARGET_MULTIPLIER;
  els.buyLinkSection.classList.toggle("hidden", userLinkBal >= buyTargetAmount);

  const minBet = positionSize / 50n; // matches the contract's require(amt >= AmountWeOWE_PER_POSITION2 / 50)
  const warnings = [];
  if (amtWei >= payout) warnings.push("This bet loses money at these settings — lower the amount or the guess.");
  if (amtWei < minBet) warnings.push(`Below the minimum bet (${fmt(minBet, stakedDecimals)} B0x).`);
  const cantAffordBet = amtWei > maxBet || amtWei > userB0xBalanceWei;
  if (amtWei > maxBet) {
    warnings.push("Bankroll too low for this bet — lower the amount.");
  } else if (amtWei > userB0xBalanceWei) {
    warnings.push(
      `You don't have enough B0x for this bet. <a href="https://bzerox.org/?swap" target="_blank" rel="noopener noreferrer">Buy B0x with 0xBTC or ETH on Base</a>.`
    );
  }
  if (guess < 1 || guess > 97) warnings.push("Guess must be between 1 and 97.");
  const needsLink = userLinkBal < displayLinkCost;
  els.buyLinkBtn.classList.toggle("needs-link", needsLink && !cantAffordBet); // buying LINK doesn't help if the bet itself can't be afforded
  if (needsLink) {
    warnings.push(
      `You need ~${fmt(displayLinkCost, LINK_DECIMALS, 6)} LINK in your wallet to place this bet (you have ${fmt(userLinkBal, LINK_DECIMALS, 6)}).`
    );
  }

  // Applied in one shot at the end (not reset up front before the awaits
  // above) so an unchanged result doesn't blank the box out mid-refresh.
  els.placeBetBtn.disabled = warnings.length > 0;
  els.betWarning.classList.toggle("hidden", warnings.length === 0);
  if (warnings.length) {
    els.betWarning.innerHTML = warnings.join(" ");
  }
}

// Mirrors the subsidy math in B0xGuess.getRandomNumber() so the UI can
// show how much LINK the *user* will actually be charged.
function estimateUserLinkPortion(amtWei, positionSize, quoted, freeBetLink, contractLinkBal) {
  let subsidy = 0n;
  if (amtWei >= positionSize * 20n) {
    subsidy = freeBetLink < quoted ? freeBetLink : quoted;
    if (subsidy > contractLinkBal) subsidy = contractLinkBal;
  }
  const userPortion = quoted - subsidy;
  return userPortion > 0n ? userPortion : 0n;
}

// --- Approvals ---

// Approves once, for a very large amount, rather than the exact amount
// needed. Exact-amount approvals get fully consumed by the contract's own
// transferFrom on every bet/stake, so the allowance is back to ~0 right
// after — meaning the check below would technically pass but almost never
// actually skip anything. Approving MaxUint256 the first time means every
// later call here just confirms the allowance is still huge and returns
// immediately, with no repeat wallet prompts.
async function ensureAllowance(tokenRead, tokenWrite, owner, spender, neededWei, statusEl, tokenLabel) {
  const current = await tokenRead.allowance(owner, spender);
  if (current >= neededWei) return;
  setStatus(statusEl, `Approving ${tokenLabel} (one-time)...`);
  const tx = await tokenWrite.approve(spender, ethers.MaxUint256);
  await tx.wait();
}

// --- Placing a bet ---

async function placeBet() {
  els.placeBetBtn.disabled = true;
  try {
    const guess = Number(els.guessNumberInput.value);
    const amtWei = ethers.parseUnits(els.betAmountInput.value, stakedDecimals);

    await ensureAllowance(stakedTokenRead, stakedTokenWrite, userAddress, B0XGUESS_ADDRESS, amtWei, els.betStatus, "B0x");

    const [positionSize, quoted, freeBetLink, contractLinkBal] = await Promise.all([
      b0xGuessRead.AmountWeOWE_PER_POSITION2(),
      b0xGuessRead.requestPrice(),
      b0xGuessRead.FreeBetLink(),
      linkTokenRead.balanceOf(B0XGUESS_ADDRESS),
    ]);
    const userPortion = estimateUserLinkPortion(amtWei, positionSize, quoted, freeBetLink, contractLinkBal);
    const bufferWei = ethers.parseUnits(String(LINK_APPROVAL_BUFFER), LINK_DECIMALS);
    const buffered = userPortion + bufferWei; // see LINK_APPROVAL_BUFFER comment — quoted price can drift a lot by execution time

    if (userPortion > 0n) {
      const displayLinkCost = userPortion * LINK_COST_DISPLAY_MULTIPLIER; // see LINK_COST_DISPLAY_MULTIPLIER comment
      const userLinkBal = await linkTokenRead.balanceOf(userAddress);
      if (userLinkBal < displayLinkCost) {
        throw new Error(
          `This bet needs roughly ${fmt(displayLinkCost, LINK_DECIMALS, 6)} LINK in your wallet, but you only have ` +
            `${fmt(userLinkBal, LINK_DECIMALS, 6)}. Add LINK to your wallet and try again.`
        );
      }
    }
    // Always top up the allowance, even for quotes that look fully subsidized —
    // if the real on-chain price ends up higher than the quote, a zero
    // allowance here is exactly what causes the LINK transferFrom to revert.
    await ensureAllowance(linkTokenRead, linkTokenWrite, userAddress, B0XGUESS_ADDRESS, buffered, els.betStatus, "LINK");

    setStatus(els.betStatus, "Placing bet...");
    const tx = await b0xGuessWrite.getRandomNumber(guess, amtWei);
    await tx.wait();

    setStatus(els.betStatus, "Bet placed! Waiting on Chainlink VRF for the result (usually 10-30 seconds)...");
    await refreshAll();
    await loadMyBets(true);
  } catch (err) {
    const raw = err.shortMessage || err.message || String(err);
    if (raw.includes("Min bet AmountWeOWE_PER_POSITION2/50 B0x")) {
      try {
        const positionSize = await b0xGuessRead.AmountWeOWE_PER_POSITION2();
        setStatus(els.betStatus, `Min bet ${fmt(positionSize / 50n, stakedDecimals)} B0x`, "error");
      } catch {
        setStatus(els.betStatus, raw, "error");
      }
    } else {
      setStatus(els.betStatus, raw, "error");
    }
  } finally {
    els.placeBetBtn.disabled = false;
  }
}

// --- Buying LINK with ETH (Uniswap v3) ---

// Same subsidy-aware LINK estimate the bet panel shows, but usable
// standalone — e.g. before the user has typed a bet amount, in which case
// it falls back to MIN_BET_B0X as the basis.
async function getSingleBetLinkCost() {
  const guess = Number(els.guessNumberInput.value) || 50;
  const amountStr = els.betAmountInput.value;
  const amtWei =
    amountStr && Number(amountStr) > 0
      ? ethers.parseUnits(amountStr, stakedDecimals)
      : ethers.parseUnits(String(MIN_BET_B0X), stakedDecimals);

  const [positionSize, quoted, freeBetLink, contractLinkBal] = await Promise.all([
    b0xGuessRead.AmountWeOWE_PER_POSITION2(),
    b0xGuessRead.requestPrice(),
    b0xGuessRead.FreeBetLink(),
    linkTokenRead.balanceOf(B0XGUESS_ADDRESS),
  ]);
  const userLinkPortion = estimateUserLinkPortion(amtWei, positionSize, quoted, freeBetLink, contractLinkBal);
  return userLinkPortion * LINK_COST_DISPLAY_MULTIPLIER;
}

async function buyLink() {
  els.buyLinkBtn.disabled = true;
  try {
    const singleBetCost = await getSingleBetLinkCost();
    if (singleBetCost === 0n) {
      throw new Error("This bet is fully LINK-subsidized right now — no need to buy any.");
    }

    const targetOutput = singleBetCost * LINK_BUY_TARGET_MULTIPLIER;

    setStatus(els.buyLinkStatus, "Getting a quote from Uniswap...");
    const [amountIn] = await quoterRead.quoteExactOutputSingle.staticCall([
      WETH_ADDRESS,
      LINK_TOKEN_ADDRESS,
      targetOutput,
      LINK_WETH_POOL_FEE,
      0n,
    ]);

    // Standard tight slippage tolerance around the target, not a wide
    // floor-to-ceiling band — see LINK_BUY_TARGET_MULTIPLIER comment.
    const slippageBps = BigInt(Math.round(LINK_BUY_SLIPPAGE_TOLERANCE * 10000));
    const amountOutMinimum = (targetOutput * (10000n - slippageBps)) / 10000n;

    const ethBalance = await provider.getBalance(userAddress);
    const gasReserveWei = ethers.parseEther(ETH_GAS_RESERVE);
    if (ethBalance < amountIn + gasReserveWei) {
      throw new Error(
        `This swap needs about ${ethers.formatEther(amountIn)} ETH (plus gas), but your wallet only has ` +
          `${ethers.formatEther(ethBalance)} ETH.`
      );
    }

    setStatus(
      els.buyLinkStatus,
      `Swapping ~${ethers.formatEther(amountIn)} ETH for ~${fmt(targetOutput, LINK_DECIMALS, 6)} LINK...`
    );
    const tx = await swapRouterWrite.exactInputSingle(
      [WETH_ADDRESS, LINK_TOKEN_ADDRESS, LINK_WETH_POOL_FEE, userAddress, amountIn, amountOutMinimum, 0n],
      { value: amountIn }
    );
    await tx.wait();

    setStatus(els.buyLinkStatus, "Bought LINK successfully.", "success");
    await refreshAll();
  } catch (err) {
    setStatus(els.buyLinkStatus, err.shortMessage || err.message || String(err), "error");
  } finally {
    els.buyLinkBtn.disabled = false;
  }
}

// --- Staking ---

async function stake() {
  els.stakeBtn.disabled = true;
  try {
    const amtWei = ethers.parseUnits(els.stakeAmountInput.value, stakedDecimals);
    await ensureAllowance(stakedTokenRead, stakedTokenWrite, userAddress, B0XGUESS_ADDRESS, amtWei, els.stakeStatus, "B0x");

    setStatus(els.stakeStatus, "Staking...");
    const tx = await b0xGuessWrite.stakeFor(userAddress, amtWei);
    await tx.wait();

    setStatus(els.stakeStatus, "Staked successfully.", "success");
    els.stakeAmountInput.value = "";
    await refreshAll();
  } catch (err) {
    setStatus(els.stakeStatus, err.shortMessage || err.message || String(err), "error");
  } finally {
    els.stakeBtn.disabled = false;
  }
}

async function withdrawAll() {
  els.withdrawAllBtn.disabled = true;
  try {
    let maxLossWei;
    if (els.maxLossInput.value) {
      maxLossWei = ethers.parseUnits(els.maxLossInput.value, stakedDecimals);
    } else {
      maxLossWei = await b0xGuessRead.penalty(); // current pending payouts — passing this always succeeds right now
    }

    setStatus(els.withdrawStatus, "Withdrawing...");
    const tx = await b0xGuessWrite.perfectWithdraw(maxLossWei);
    await tx.wait();

    setStatus(els.withdrawStatus, "Withdrawn successfully.", "success");
    await refreshAll();
  } catch (err) {
    setStatus(els.withdrawStatus, err.shortMessage || err.message || String(err), "error");
  } finally {
    els.withdrawAllBtn.disabled = false;
  }
}

// --- Advanced: manual VRF top-up ---

async function getBlank() {
  els.getBlankBtn.disabled = true;
  try {
    const extraLINK = BigInt(els.blankAmountInput.value || "1");
    const unitPrice = await b0xGuessRead.requestPrice();
    const bufferWei = ethers.parseUnits(String(LINK_APPROVAL_BUFFER), LINK_DECIMALS);
    const totalNeeded = unitPrice * extraLINK + bufferWei; // see LINK_APPROVAL_BUFFER comment

    await ensureAllowance(linkTokenRead, linkTokenWrite, userAddress, B0XGUESS_ADDRESS, totalNeeded, els.blankStatus, "LINK");

    setStatus(els.blankStatus, "Requesting extra randomness...");
    const tx = await b0xGuessWrite.getBlank(extraLINK);
    await tx.wait();

    setStatus(els.blankStatus, "Requested.", "success");
  } catch (err) {
    setStatus(els.blankStatus, err.shortMessage || err.message || String(err), "error");
  } finally {
    els.getBlankBtn.disabled = false;
  }
}

// --- Owner controls ---

async function runCheckpoint() {
  els.checkpointBtn.disabled = true;
  try {
    setStatus(els.ownerStatus, "Running checkpoint...");
    const tx = await b0xGuessWrite.setAmountWeOwePerPosition();
    await tx.wait();
    setStatus(els.ownerStatus, "Checkpoint updated.", "success");
    await refreshAll();
  } catch (err) {
    setStatus(els.ownerStatus, err.shortMessage || err.message || String(err), "error");
  } finally {
    els.checkpointBtn.disabled = false;
  }
}

async function setFreeBet() {
  els.setFreeBetBtn.disabled = true;
  try {
    const amtWei = ethers.parseUnits(els.freeBetInput.value, LINK_DECIMALS);
    setStatus(els.ownerStatus, "Updating rebate...");
    const tx = await b0xGuessWrite.setFreeBetLink(amtWei);
    await tx.wait();
    setStatus(els.ownerStatus, "Rebate updated.", "success");
    els.freeBetInput.value = "";
    await refreshAll();
  } catch (err) {
    setStatus(els.ownerStatus, err.shortMessage || err.message || String(err), "error");
  } finally {
    els.setFreeBetBtn.disabled = false;
  }
}

async function transferOwner() {
  els.transferOwnerBtn.disabled = true;
  try {
    const newOwner = els.newOwnerInput.value.trim();
    setStatus(els.ownerStatus, "Transferring ownership...");
    const tx = await b0xGuessWrite.transferOwnership(newOwner);
    await tx.wait();
    setStatus(els.ownerStatus, "Ownership transferred.", "success");
    els.newOwnerInput.value = "";
    await refreshAll();
  } catch (err) {
    setStatus(els.ownerStatus, err.shortMessage || err.message || String(err), "error");
  } finally {
    els.transferOwnerBtn.disabled = false;
  }
}

// --- Live activity feed ---

function addActivity(text, kind) {
  const li = document.createElement("li");
  li.textContent = text;
  if (kind) li.className = kind;
  els.activityFeed.prepend(li);
  while (els.activityFeed.children.length > 30) {
    els.activityFeed.removeChild(els.activityFeed.lastChild);
  }
}

// Shared by the live listener below and the history backfill, so both
// produce the exact same feed-line text.
function describeShowAnswer(usersGuess, result, amountWagered, guesser, amountWon) {
  const won = result < usersGuess;
  return {
    text:
      `${shortAddr(guesser)} bet ${fmt(amountWagered, stakedDecimals)} B0x below ${usersGuess}, result ${result} — ` +
      (won ? `won ${fmt(amountWon, stakedDecimals)} B0x` : "lost"),
    kind: won ? "win" : "lose",
  };
}

function describeStaked(user, amount) {
  return { text: `${shortAddr(user)} staked ${fmt(amount, stakedDecimals)} B0x` };
}

function describeWithdrawn(user, amount) {
  return { text: `${shortAddr(user)} withdrew ${fmt(amount, stakedDecimals)} shares` };
}

function registerContractEvents() {
  b0xGuessRead.on("ShowAnswer", (usersGuess, result, amountWagered, betID, guesser, amountWon) => {
    const { text, kind } = describeShowAnswer(usersGuess, result, amountWagered, guesser, amountWon);
    addActivity(text, kind);

    if (guesser.toLowerCase() === userAddress.toLowerCase()) {
      const won = result < usersGuess;
      setStatus(
        els.betStatus,
        won
          ? `You won! Rolled ${result}, payout ${fmt(amountWon, stakedDecimals)} B0x.`
          : `You lost. Rolled ${result} (needed below ${usersGuess}).`,
        won ? "success" : "error"
      );
      refreshWalletInfo();
      loadMyBets(true);
    }
  });

  b0xGuessRead.on("Staked", (user, amount) => {
    addActivity(describeStaked(user, amount).text);
  });

  b0xGuessRead.on("Withdrawn", (user, amount) => {
    addActivity(describeWithdrawn(user, amount).text);
  });
}

// Backfills the feed with recently-resolved bets so it isn't empty after
// every page reload — the live listeners above only catch events from
// this point on. Reads the contract's own per-bet mappings (betAmt,
// betOdds, betee, betResults, winnings) indexed by bet ID, rather than
// querying ShowAnswer event logs — plain view calls, so there's no
// eth_getLogs block-range cap to worry about, and it reuses exactly the
// same data the contract itself relies on for the FIFO betid/betidIN
// queue. (Staked/Withdrawn have no equivalent per-index mapping to read,
// so — unlike bets — they're only shown live going forward, not backfilled.)
async function loadActivityHistory() {
  try {
    const resolvedThrough = await b0xGuessRead.betid(); // bets [0, resolvedThrough) are settled
    const startId = resolvedThrough > BigInt(ACTIVITY_HISTORY_BET_COUNT)
      ? resolvedThrough - BigInt(ACTIVITY_HISTORY_BET_COUNT)
      : 0n;

    const ids = [];
    for (let id = startId; id < resolvedThrough; id++) ids.push(id);

    const bets = await Promise.all(
      ids.map((id) =>
        Promise.all([
          b0xGuessRead.betAmt(id),
          b0xGuessRead.betOdds(id),
          b0xGuessRead.betee(id),
          b0xGuessRead.betResults(id),
          b0xGuessRead.winnings(id),
        ])
      )
    );

    for (const [amount, guess, guesser, result, amountWon] of bets) {
      const { text, kind } = describeShowAnswer(guess, result, amount, guesser, amountWon);
      addActivity(text, kind);
    }
  } catch (err) {
    // Backfill is a nice-to-have — an RPC hiccup shouldn't break the rest of the page.
    console.warn("Could not load activity history:", err);
  }
}

// --- My Bets (uses getUserBetCount/getUserBetIds — see B0xGuess.sol) ---

function buildMyBetLi(bet) {
  const li = document.createElement("li");
  const displayId = bet.id + 1n;
  if (bet.pending) {
    li.textContent = `#${displayId} — bet ${fmt(bet.amount, stakedDecimals)} B0x below ${bet.guess} — pending VRF result`;
  } else {
    const won = bet.result < bet.guess;
    li.textContent =
      `#${displayId} — bet ${fmt(bet.amount, stakedDecimals)} B0x below ${bet.guess}, result ${bet.result} — ` +
      (won ? `won ${fmt(bet.amountWon, stakedDecimals)} B0x` : "lost");
    li.className = won ? "win" : "lose";
  }
  return li;
}

// Fetches one page of the connected wallet's bets, newest first, paging
// backwards through older bets on each subsequent call (reset=true starts
// over from the most recent bet — used on connect and after placing a bet).
async function loadMyBets(reset) {
  if (reset) {
    els.myBetsList.innerHTML = "";
    myBetsRemainingOffset = null;
  }

  try {
    if (myBetsRemainingOffset === null) {
      myBetsRemainingOffset = await b0xGuessRead.getUserBetCount(userAddress);
      if (myBetsRemainingOffset === 0n) {
        setStatus(els.myBetsStatus, "No bets yet.");
        els.myBetsLoadMoreBtn.classList.add("hidden");
        return;
      }
      setStatus(els.myBetsStatus, "");
    }

    const limit = BigInt(MY_BETS_PAGE_SIZE);
    const offset = myBetsRemainingOffset > limit ? myBetsRemainingOffset - limit : 0n;
    const count = myBetsRemainingOffset - offset;

    const [ids, resolvedThrough] = await Promise.all([
      b0xGuessRead.getUserBetIds(userAddress, offset, count),
      b0xGuessRead.betid(),
    ]);

    const bets = await Promise.all(
      [...ids].reverse().map(async (id) => {
        const [amount, guess, result, amountWon] = await Promise.all([
          b0xGuessRead.betAmt(id),
          b0xGuessRead.betOdds(id),
          b0xGuessRead.betResults(id),
          b0xGuessRead.winnings(id),
        ]);
        return { id, amount, guess, result, amountWon, pending: id >= resolvedThrough };
      })
    );

    for (const bet of bets) {
      els.myBetsList.appendChild(buildMyBetLi(bet));
    }

    myBetsRemainingOffset = offset;
    els.myBetsLoadMoreBtn.classList.toggle("hidden", myBetsRemainingOffset === 0n);
  } catch (err) {
    // Most likely cause: the connected contract predates getUserBetCount/
    // getUserBetIds and needs redeploying — see B0xGuess.sol.
    setStatus(els.myBetsStatus, err.shortMessage || err.message || String(err), "error");
  }
}

// --- Wire up the page ---

els.connectBtn.addEventListener("click", connectWallet);

// Slider and number box stay in sync — drag for speed, type for exactness.
els.guessInput.addEventListener("input", () => {
  els.guessNumberInput.value = els.guessInput.value;
  scheduleEstimate();
});
els.guessNumberInput.addEventListener("input", () => {
  if (els.guessNumberInput.value !== "") {
    els.guessInput.value = els.guessNumberInput.value; // range input clamps to [1,97] itself
  }
  scheduleEstimate();
});
els.guessNumberInput.addEventListener("blur", () => {
  let v = Number(els.guessNumberInput.value);
  if (Number.isNaN(v)) v = Number(els.guessInput.value);
  v = Math.min(97, Math.max(1, Math.round(v)));
  els.guessNumberInput.value = v;
  els.guessInput.value = v;
  scheduleEstimate();
});
updateWinChance();

els.betAmountInput.addEventListener("input", scheduleEstimate);
els.placeBetBtn.addEventListener("click", placeBet);
els.buyLinkBtn.addEventListener("click", buyLink);
els.myBetsLoadMoreBtn.addEventListener("click", () => loadMyBets(false));
els.stakeBtn.addEventListener("click", stake);
els.stakeMaxBtn.addEventListener("click", () => {
  els.stakeAmountInput.value = ethers.formatUnits(userB0xBalanceWei, stakedDecimals);
});
els.withdrawAllBtn.addEventListener("click", withdrawAll);
els.getBlankBtn.addEventListener("click", getBlank);
els.checkpointBtn.addEventListener("click", runCheckpoint);
els.setFreeBetBtn.addEventListener("click", setFreeBet);
els.transferOwnerBtn.addEventListener("click", transferOwner);

let walletEventsRegistered = false;

// Switching accounts/networks in the wallet (Rabby, MetaMask, ...) reloads
// the page rather than trying to patch every piece of state in place —
// simplest way to guarantee balances, contract instances, and event
// listeners all end up consistent with the new account/chain.
function registerWalletEvents() {
  if (walletEventsRegistered || !window.ethereum) return;
  walletEventsRegistered = true;
  window.ethereum.on("accountsChanged", () => window.location.reload());
  window.ethereum.on("chainChanged", () => window.location.reload());
}

// window.ethereum may not exist yet at this exact point — some wallets (and
// especially having more than one extension installed, e.g. Rabby +
// MetaMask, racing to inject) finish injecting a moment after the page's own
// scripts start running. A one-shot `if (window.ethereum)` check right here
// can miss it and silently never attach the listeners above for the rest of
// the page's life. Poll briefly instead of assuming it's already there.
function whenEthereumReady(callback, attemptsLeft = 20) {
  if (window.ethereum) {
    callback();
    return;
  }
  if (attemptsLeft <= 0) return;
  setTimeout(() => whenEthereumReady(callback, attemptsLeft - 1), 100);
}

whenEthereumReady(() => {
  registerWalletEvents();

  // Auto-reconnect on load if this site is already authorized, so the reload
  // above lands back in the connected view instead of dropping the user to
  // "Connect Wallet" every time they switch accounts.
  window.ethereum.request({ method: "eth_accounts" }).then((accounts) => {
    if (accounts.length > 0) connectWallet();
  }).catch((err) => console.warn("Auto-reconnect check failed:", err));
});
