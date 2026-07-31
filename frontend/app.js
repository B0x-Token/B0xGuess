// app.js
// All the wallet/contract logic for the B0x Guess dApp. No build step,
// no framework — just ethers.js (loaded from a CDN in index.html) and
// plain DOM calls, so it reads top to bottom like a normal script.

// Minimum bet shown in the UI and used for the pre-flight warning below
// the bet input. NOTE: this is a frontend-only floor — the contract's
// real minimum is enforced on-chain as AmountWeOWE_PER_POSITION2() / 10
// (currently 5.0000 B0x). Lowering this to 0.01 does not lower that
// on-chain minimum, so bets under the real contract minimum will still
// revert until AmountWeOWE_PER_POSITION2 is brought down to match.
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

const els = {
  connectBtn: document.getElementById("connect-btn"),
  networkBadge: document.getElementById("network-badge"),
  walletAddress: document.getElementById("wallet-address"),
  app: document.getElementById("app"),
  connectHint: document.getElementById("connect-hint"),

  statPrice: document.getElementById("stat-price"),
  statPool: document.getElementById("stat-pool"),
  statPosition: document.getElementById("stat-position"),
  statMinbet: document.getElementById("stat-minbet"),
  statVrfPrice: document.getElementById("stat-vrfprice"),
  statFreebet: document.getElementById("stat-freebet"),

  guessInput: document.getElementById("guess-input"),
  guessNumberInput: document.getElementById("guess-number-input"),
  betAmountInput: document.getElementById("bet-amount-input"),
  estPayout: document.getElementById("est-payout"),
  estMaxbet: document.getElementById("est-maxbet"),
  estLinkCost: document.getElementById("est-link-cost"),
  statLinkBalance: document.getElementById("stat-link-balance"),
  betWarning: document.getElementById("bet-warning"),
  placeBetBtn: document.getElementById("place-bet-btn"),
  betStatus: document.getElementById("bet-status"),

  stakeAmountInput: document.getElementById("stake-amount-input"),
  stakeBtn: document.getElementById("stake-btn"),
  stakeStatus: document.getElementById("stake-status"),
  statShares: document.getElementById("stat-shares"),
  statWithdrawable: document.getElementById("stat-withdrawable"),
  statProfit: document.getElementById("stat-profit"),
  maxLossInput: document.getElementById("max-loss-input"),
  withdrawAllBtn: document.getElementById("withdraw-all-btn"),
  withdrawStatus: document.getElementById("withdraw-status"),

  activityFeed: document.getElementById("activity-feed"),

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
};

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
let stakedDecimals = 18;
const LINK_DECIMALS = 18;

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

  try {
    stakedDecimals = await stakedTokenRead.decimals();
  } catch {
    stakedDecimals = 18;
  }

  els.walletAddress.textContent = shortAddr(userAddress);
  els.walletAddress.classList.remove("hidden");
  els.networkBadge.classList.remove("hidden");
  els.connectBtn.textContent = "Connected";
  els.connectBtn.disabled = true;
  els.app.classList.remove("hidden");
  els.connectHint.classList.add("hidden");

  registerContractEvents();
  await refreshAll();
  setInterval(refreshAll, 20000);
}

// --- Reading on-chain state into the UI ---

async function refreshAll() {
  await Promise.all([refreshPoolInfo(), refreshWalletInfo(), refreshBetEstimate(), refreshOwnerPanel()]);
}

async function refreshPoolInfo() {
  const [price, poolRaw, unreleased, position, vrfPrice, freeBet] = await Promise.all([
    b0xGuessRead.getPriceOFB0xINUSD(),
    stakedTokenRead.balanceOf(B0XGUESS_ADDRESS),
    b0xGuessRead.unreleased(),
    b0xGuessRead.AmountWeOWE_PER_POSITION2(),
    b0xGuessRead.requestPrice(),
    b0xGuessRead.FreeBetLink(),
  ]);

  const pool = poolRaw - unreleased;
  const minBet = ethers.parseUnits(String(MIN_BET_B0X), stakedDecimals);

  els.statPrice.textContent = fmtUsd(price);
  els.statPool.textContent = fmt(pool, stakedDecimals) + " B0x";
  els.statPosition.textContent = fmt(position, stakedDecimals) + " B0x";
  els.statMinbet.textContent = fmt(minBet, stakedDecimals) + " B0x";
  els.statVrfPrice.textContent = fmt(vrfPrice, LINK_DECIMALS, 6) + " LINK";
  els.statFreebet.textContent = fmt(freeBet, LINK_DECIMALS, 6) + " LINK";
}

async function refreshWalletInfo() {
  const [shares, withdrawable, profit] = await Promise.all([
    b0xGuessRead.balanceOf(userAddress),
    b0xGuessRead.currentForge(userAddress),
    b0xGuessRead.Profit(userAddress),
  ]);

  els.statShares.textContent = fmt(shares, stakedDecimals);
  els.statWithdrawable.textContent = fmt(withdrawable, stakedDecimals) + " B0x";
  els.statProfit.textContent = fmt(profit, stakedDecimals) + " B0x";
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

let estimateTimer = null;
function scheduleEstimate() {
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(refreshBetEstimate, 300);
}

async function refreshBetEstimate() {
  if (!b0xGuessRead) return;

  const guess = Number(els.guessNumberInput.value);

  const amountStr = els.betAmountInput.value;
  els.betWarning.classList.add("hidden");
  els.placeBetBtn.disabled = false;

  if (!amountStr || Number(amountStr) <= 0) {
    els.estPayout.textContent = "—";
    els.estMaxbet.textContent = "—";
    els.estLinkCost.textContent = "—";
    els.statLinkBalance.textContent = "—";
    return;
  }

  let amtWei;
  try {
    amtWei = ethers.parseUnits(amountStr, stakedDecimals);
  } catch {
    return;
  }

  const [payout, maxBet, positionSize, quoted, freeBetLink, contractLinkBal, userLinkBal] = await Promise.all([
    b0xGuessRead.estOUTPUT(amtWei, guess),
    b0xGuessRead.MaxINForGuess(guess),
    b0xGuessRead.AmountWeOWE_PER_POSITION2(),
    b0xGuessRead.requestPrice(),
    b0xGuessRead.FreeBetLink(),
    linkTokenRead.balanceOf(B0XGUESS_ADDRESS),
    linkTokenRead.balanceOf(userAddress),
  ]);

  els.estPayout.textContent = fmt(payout, stakedDecimals) + " B0x";
  els.estMaxbet.textContent = fmt(maxBet, stakedDecimals) + " B0x";
  els.statLinkBalance.textContent = fmt(userLinkBal, LINK_DECIMALS, 6) + " LINK";

  const userLinkPortion = estimateUserLinkPortion(amtWei, positionSize, quoted, freeBetLink, contractLinkBal);
  els.estLinkCost.textContent = fmt(userLinkPortion, LINK_DECIMALS, 6) + " LINK";

  const minBet = ethers.parseUnits(String(MIN_BET_B0X), stakedDecimals);
  const warnings = [];
  if (amtWei >= payout) warnings.push("This bet loses money at these settings — lower the amount or the guess.");
  if (amtWei < minBet) warnings.push(`Below the minimum bet (${fmt(minBet, stakedDecimals)} B0x).`);
  if (amtWei > maxBet) warnings.push("Bankroll too low for this bet — lower the amount.");
  if (guess < 1 || guess > 97) warnings.push("Guess must be between 1 and 97.");
  if (userLinkBal < userLinkPortion) {
    warnings.push(
      `You need ${fmt(userLinkPortion, LINK_DECIMALS, 6)} LINK in your wallet to place this bet (you have ${fmt(userLinkBal, LINK_DECIMALS, 6)}).`
    );
  }

  if (warnings.length) {
    els.betWarning.textContent = warnings.join(" ");
    els.betWarning.classList.remove("hidden");
    els.placeBetBtn.disabled = true;
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

async function ensureAllowance(tokenRead, tokenWrite, owner, spender, neededWei, statusEl, tokenLabel) {
  const current = await tokenRead.allowance(owner, spender);
  if (current >= neededWei) return;
  setStatus(statusEl, `Approving ${tokenLabel}...`);
  const tx = await tokenWrite.approve(spender, neededWei);
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
      const userLinkBal = await linkTokenRead.balanceOf(userAddress);
      if (userLinkBal < userPortion) {
        throw new Error(
          `This bet needs at least ${fmt(userPortion, LINK_DECIMALS, 6)} LINK in your wallet, but you only have ` +
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

    setStatus(els.betStatus, "Bet placed! Waiting on Chainlink VRF for the result (usually 3-5 minutes)...");
    await refreshAll();
  } catch (err) {
    setStatus(els.betStatus, err.shortMessage || err.message || String(err), "error");
  } finally {
    els.placeBetBtn.disabled = false;
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

function registerContractEvents() {
  b0xGuessRead.on("GuessNote", (usersGuess, amount, user, betID) => {
    addActivity(`${shortAddr(user)} bet ${fmt(amount, stakedDecimals)} B0x, guessing below ${usersGuess}`);
  });

  b0xGuessRead.on("ShowAnswer", (usersGuess, result, amountWagered, betID, guesser, amountWon) => {
    const won = result < usersGuess;
    addActivity(
      `${shortAddr(guesser)} guessed below ${usersGuess}, rolled ${result} — ${won ? "won" : "lost"} ${fmt(amountWon, stakedDecimals)} B0x`,
      won ? "win" : "lose"
    );

    if (guesser.toLowerCase() === userAddress.toLowerCase()) {
      setStatus(
        els.betStatus,
        won
          ? `You won! Rolled ${result}, payout ${fmt(amountWon, stakedDecimals)} B0x.`
          : `You lost. Rolled ${result} (needed below ${usersGuess}).`,
        won ? "success" : "error"
      );
      refreshWalletInfo();
    }
  });

  b0xGuessRead.on("Staked", (user, amount) => {
    addActivity(`${shortAddr(user)} staked ${fmt(amount, stakedDecimals)} B0x`);
  });

  b0xGuessRead.on("Withdrawn", (user, amount) => {
    addActivity(`${shortAddr(user)} withdrew ${fmt(amount, stakedDecimals)} shares`);
  });
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

els.betAmountInput.addEventListener("input", scheduleEstimate);
els.placeBetBtn.addEventListener("click", placeBet);
els.stakeBtn.addEventListener("click", stake);
els.withdrawAllBtn.addEventListener("click", withdrawAll);
els.getBlankBtn.addEventListener("click", getBlank);
els.checkpointBtn.addEventListener("click", runCheckpoint);
els.setFreeBetBtn.addEventListener("click", setFreeBet);
els.transferOwnerBtn.addEventListener("click", transferOwner);

if (window.ethereum) {
  window.ethereum.on("accountsChanged", () => window.location.reload());
  window.ethereum.on("chainChanged", () => window.location.reload());
}
