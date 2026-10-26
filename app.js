// Savings Tracker — all app behaviour lives here.
// Reading order: 1) data  2) calculations  3) drawing the screen  4) reacting to taps  5) reports.

const ACCOUNTS = ["TFSA", "RRSP", "FHSA", "Taxable", "Savings"];
const STORAGE_KEY = "savings-tracker-v1";

// ---------- 1. Data: load and save ----------

// Everything the app knows, in one object (shape documented in docs/2-design.md).
let data = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return upgrade({ income: {}, deposits: [], lastAccount: "TFSA", goals: {}, starting: {}, ...saved });
  } catch (e) { /* storage unavailable or corrupted: start fresh */ }
  return { settings: null, goals: {}, income: {}, deposits: [], lastAccount: "TFSA", starting: {} };
}

// Older versions kept one set of goals and one year of starting balances.
// Move the values saved on this phone under the current year, so each year keeps its own from now on.
function upgrade(d) {
  const year = String(new Date().getFullYear());
  if (d.settings && d.settings.yearlyGoal !== undefined) {
    if (!d.goals[year]) d.goals[year] = { yearlyGoal: d.settings.yearlyGoal, rateGoal: d.settings.rateGoal };
    delete d.settings.yearlyGoal;
    delete d.settings.rateGoal;
  }
  if (d.starting === null) d.starting = {};
  if (d.starting.amounts) d.starting = { [d.starting.year]: d.starting.amounts };
  return d;
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { toast("Couldn't save on this device"); }
}

// ---------- 2. Calculations ----------

// Dates are kept as text like "2026-10-25" so they sort and compare simply.
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const monthKeyOf = (dateString) => dateString.slice(0, 7);   // "2026-10-25" → "2026-10"
const yearOf     = (dateString) => dateString.slice(0, 4);   // "2026-10-25" → "2026"
const thisYear   = () => yearOf(todayString());

const sum = (deposits) => deposits.reduce((total, d) => total + d.amount, 0);
const total = (numbers) => numbers.reduce((a, b) => a + b, 0);

// Percent, rounded to 6 decimals so binary rounding (1450 / 5000 * 100 = 28.999999999999996) can't cost a whole point
const percentOf = (part, whole) => Math.round(part / whole * 100 * 1e6) / 1e6;
const cents = (n) => Math.round(n * 100) / 100;

// A year's goals: its own, else the latest earlier year's (so a new year starts with last year's), else the earliest.
function goalsFor(year) {
  if (data.goals[year]) return data.goals[year];
  const years = Object.keys(data.goals).sort();
  return data.goals[years.filter((y) => y < year).pop() || years[0]];
}

// A month's income: the one entered for that month, else the latest earlier month's, else the starting income.
function incomeFor(monthKey) {
  if (data.income[monthKey]) return { amount: data.income[monthKey], estimate: false };
  const earlier = Object.keys(data.income).filter((k) => k < monthKey).sort().pop();
  return { amount: earlier ? data.income[earlier] : data.settings.startingIncome, estimate: true };
}

// Amounts saved before using the app, per account, for one year.
const startingFor = (year) => data.starting[year] || {};

const depositsIn = (year) => data.deposits.filter((d) => yearOf(d.date) === year);

// Everything about one year's totals. Used by the home screen and the Year summary.
function yearStats(year) {
  const goals = goalsFor(year);
  const deposits = depositsIn(year);
  const starting = startingFor(year);
  const startingTotal = total(Object.values(starting));
  const saved = startingTotal + sum(deposits);   // starting balances count toward the year
  return {
    year, goals, deposits, starting, startingTotal, saved,
    pct: percentOf(saved, goals.yearlyGoal),
    toGo: Math.max(0, cents(goals.yearlyGoal - saved)),
    byAccount: ACCOUNTS.map((a) => ({
      account: a,
      total: (starting[a] || 0) + sum(deposits.filter((d) => d.account === a)),
    })),
  };
}

// One entry per month Jan–Dec. Months outside "first logged month → this month (or Dec)" have no data.
// Starting balances have no monthly detail, so they're never part of these.
function monthlyRates(year) {
  const deposits = depositsIn(year);
  const first = deposits.map((d) => monthKeyOf(d.date)).sort()[0];
  const last = year === thisYear() ? monthKeyOf(todayString()) : `${year}-12`;

  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    if (!first || key < first || key > last) return { key, hasData: false };
    const monthDeposits = deposits.filter((d) => monthKeyOf(d.date) === key);
    const saved = sum(monthDeposits);
    const income = incomeFor(key);
    return { key, hasData: true, deposits: monthDeposits, saved, income: income.amount, estimate: income.estimate, rate: percentOf(saved, income.amount) };
  });
}

// Savings rate results for the months shown: overall rate = total saved ÷ total income, so bigger-income months count for more
function rateResults(year) {
  const goal = goalsFor(year).rateGoal;
  const months = monthlyRates(year).filter((m) => m.hasData);
  const income = total(months.map((m) => m.income));
  const byRate = [...months].sort((a, b) => b.rate - a.rate);
  return {
    goal, months, income,
    overall: months.length ? percentOf(total(months.map((m) => m.saved)), income) : 0,
    atGoal: months.filter((m) => m.rate >= goal).length,
    best: byRate[0],
    lowest: byRate[byRate.length - 1],
  };
}

// The home screen's current-year and current-month numbers
function stats() {
  const thisMonth = monthKeyOf(todayString());
  const year = yearStats(thisYear());
  const monthDeposits = data.deposits.filter((d) => monthKeyOf(d.date) === thisMonth);
  const monthSaved = sum(monthDeposits);
  const income = incomeFor(thisMonth);
  const rateTarget = income.amount * year.goals.rateGoal / 100;   // $ needed this month
  return {
    ...year, thisMonth,
    monthSaved,
    monthCount: monthDeposits.length,
    income,
    rate: percentOf(monthSaved, income.amount),
    rateToGo: Math.max(0, cents(rateTarget - monthSaved)),
  };
}

// ---------- 3. Drawing the screen ----------

const $ = (id) => document.getElementById(id);
const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const money = (n) => cad.format(n);
// Round down, so "65%" only shows once 65% is actually reached
const pct = (n) => `${Math.floor(n)}%`;
const monthName = (monthKey, opts = { month: "long" }) =>
  new Date(`${monthKey}-01T12:00:00`).toLocaleDateString("en-CA", opts);
const shortDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

function setBar(id, percent) {
  const bar = $(id);
  bar.style.width = `${Math.min(100, percent)}%`;
  bar.parentElement.classList.toggle("complete", percent >= 100);
}

const SCREENS = ["settings", "home", "reports", "summary", "rates"];
let currentScreen = null;
function showScreen(name) {
  SCREENS.forEach((s) => ($(`${s}-screen`).hidden = s !== name));
  if (name !== currentScreen) window.scrollTo(0, 0);   // only when switching screens, not on every redraw
  currentScreen = name;
}

// Redraw whichever screen is showing (after a delete or an income change)
function rerender() {
  if (currentScreen === "summary") renderSummary();
  else if (currentScreen === "rates") renderRates();
  else render();
}

// Shared by the home screen and the Year summary: the account list with bars
function accountRows(byAccount) {
  const max = Math.max(...byAccount.map((a) => a.total), 1);
  return byAccount.map((a) => `
    <li>
      <span>${a.account}</span>
      <div class="bar"><div style="width:${a.total / max * 100}%"></div></div>
      <span class="amount">${money(a.total)}</span>
    </li>`).join("");
}

function depositRow(d) {
  return `
    <div class="history-row">
      <span class="muted">${shortDate(d.date)}</span>
      <span class="tag">${d.account}</span>
      <span class="amount">${money(d.amount)}</span>
      <button class="delete" data-id="${d.id}" aria-label="Delete deposit">✕</button>
    </div>`;
}

const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);

function render() {
  if (!data.settings) return openSettings();
  const s = stats();
  showScreen("home");

  // Yearly card
  $("year-label").textContent = `${s.year}/${Number(s.year) + 1}`;   // e.g. "2026/2027"
  document.querySelectorAll(".year-label").forEach((el) => (el.textContent = s.year));
  $("year-saved").textContent = money(s.saved);
  $("year-of").textContent = `of ${money(s.goals.yearlyGoal)} · ${pct(s.pct)}`;
  setBar("year-bar", s.pct);
  $("year-togo").innerHTML = s.toGo === 0
    ? `<span class="done">🎉 Yearly goal reached!</span>`
    : `${money(s.toGo)} to go`;

  // Month card
  $("month-label").textContent = monthName(s.thisMonth);
  $("month-saved").textContent = money(s.monthSaved);
  $("month-count").textContent = `${s.monthCount} deposit${s.monthCount === 1 ? "" : "s"}`;

  // Savings rate card
  $("rate-now").textContent = pct(s.rate);
  $("rate-goal").textContent = `goal ${s.goals.rateGoal}%`;
  setBar("rate-bar", s.rate / s.goals.rateGoal * 100);
  $("rate-togo").innerHTML = s.rateToGo === 0
    ? `<span class="done">🎉 Goal hit</span>`
    : `${money(s.rateToGo)} to go`;
  $("edit-income").innerHTML =
    `Income <strong>${money(s.income.amount)}</strong>${s.income.estimate ? " (estimate)" : ""} ✎`;

  $("by-account").innerHTML = accountRows(s.byAccount);
  renderHistory(s);
}

// Home History: the current year only. Earlier years are in their Year summary.
function renderHistory(s) {
  // Starting balances appear at the bottom as their own group, so the yearly total always adds up
  const startingRows = ACCOUNTS.filter((a) => s.starting[a]).map((a) => `
      <div class="history-row">
        <span class="muted"></span>
        <span class="tag">${a}</span>
        <span class="amount">${money(s.starting[a])}</span>
        <span></span>
      </div>`).join("");
  const startingGroup = startingRows
    ? `<div class="month-head">Before using the app (${s.year})</div>${startingRows}`
    : "";

  if (s.deposits.length === 0) {
    $("history").innerHTML = `<p class="empty">No deposits yet this year. Log your first one above.</p>${startingGroup}`;
    return;
  }
  let html = "";
  let currentMonth = null;
  for (const d of [...s.deposits].sort(newestFirst)) {
    const m = monthKeyOf(d.date);
    if (m !== currentMonth) {
      currentMonth = m;
      html += `<div class="month-head">${monthName(m, { month: "long", year: "numeric" })}</div>`;
    }
    html += depositRow(d);
  }
  $("history").innerHTML = html + startingGroup;
}

// Account pills are built once from the ACCOUNTS list.
function buildPills() {
  $("account-pills").innerHTML = ACCOUNTS.map((a) => `
    <input type="radio" name="account" id="acct-${a}" value="${a}">
    <label for="acct-${a}">${a}</label>`).join("");
}

// One starting-balance box per account, built once like the pills.
function buildStartingFields() {
  $("starting-fields").innerHTML = ACCOUNTS.map((a) => `
    <label class="starting-row">${a}
      <div class="money-input"><span>$</span>
        <input name="starting-${a}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0">
      </div>
    </label>`).join("");
}

function resetDepositForm() {
  $("deposit-form").reset();
  $("deposit-date").value = todayString();
  $(`acct-${data.lastAccount}`).checked = true;   // remember the last account picked
}

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

// ---------- 4. Reacting to taps ----------

// Settings edits the current year's goals and starting balances; other years keep theirs.
function openSettings() {
  const form = $("settings-form");
  const year = thisYear();
  document.querySelectorAll(".settings-year").forEach((el) => (el.textContent = year));
  if (data.settings) {
    const goals = goalsFor(year);
    form.yearlyGoal.value = goals.yearlyGoal;
    form.rateGoal.value = goals.rateGoal;
    form.startingIncome.value = data.settings.startingIncome;
  } else {
    form.rateGoal.value = 65;   // the default from the requirements
  }
  const starting = startingFor(year);
  ACCOUNTS.forEach((a) => (form[`starting-${a}`].value = starting[a] || ""));
  $("settings-cancel").hidden = !data.settings;   // nothing to go back to on first run
  showScreen("settings");
}

$("open-settings").addEventListener("click", openSettings);
$("settings-cancel").addEventListener("click", render);

$("settings-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const year = thisYear();
  data.settings = { startingIncome: Number(form.startingIncome.value) };
  data.goals[year] = { yearlyGoal: Number(form.yearlyGoal.value), rateGoal: Number(form.rateGoal.value) };
  const amounts = {};
  ACCOUNTS.forEach((a) => {
    const value = Number(form[`starting-${a}`].value);
    if (value > 0) amounts[a] = cents(value);
  });
  data.starting[year] = amounts;
  save();
  render();
  toast("Settings saved");
});

$("deposit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const before = stats();
  const account = e.target.account.value;
  data.deposits.push({
    id: Date.now().toString(36),
    amount: cents(Number($("deposit-amount").value)),
    account,
    date: $("deposit-date").value,
  });
  data.lastAccount = account;
  save();
  resetDepositForm();
  render();

  // Celebrate when this deposit crossed a goal
  const after = stats();
  if (before.toGo > 0 && after.toGo === 0) toast("🎉 Yearly goal reached!");
  else if (before.rateToGo > 0 && after.rateToGo === 0) toast(`🎉 ${after.goals.rateGoal}% savings rate hit!`);
  else toast(`Added to ${account}`);
});

// Delete buttons live on the home screen and in the Year summary
document.addEventListener("click", (e) => {
  const button = e.target.closest(".delete");
  if (!button) return;
  const deposit = data.deposits.find((d) => d.id === button.dataset.id);
  if (!confirm(`Delete ${money(deposit.amount)} to ${deposit.account}?`)) return;
  data.deposits = data.deposits.filter((d) => d !== deposit);
  save();
  rerender();
});

// The income box edits any month: this month from the home screen, past months from the Year summary
let incomeMonth = null;
function openIncome(monthKey) {
  incomeMonth = monthKey;
  $("income-title").textContent = `${monthName(monthKey, { month: "long", year: "numeric" })} take-home income`;
  $("income-amount").value = incomeFor(monthKey).amount;
  $("income-dialog").showModal();
}

$("edit-income").addEventListener("click", () => openIncome(monthKeyOf(todayString())));

// Save on the Save button's submit, which happens right away as part of the tap.
// Cancel and Esc close the box without submitting, so nothing is saved.
$("income-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  data.income[incomeMonth] = Number($("income-amount").value);
  save();
  rerender();
  toast("Income saved");
});

// ---------- 5. Reports ----------

let reportYear = null;      // the year the report is showing, e.g. "2026"
let selectedMonth = null;   // the chart's month whose details are shown, e.g. "2026-10"
const openMonths = new Set();   // Year summary months the user has expanded

// Years that can be shown: any year with a deposit or starting balances, plus the current year.
function reportYears() {
  const years = new Set(data.deposits.map((d) => yearOf(d.date)));
  Object.keys(data.starting).forEach((y) => Object.keys(data.starting[y]).length && years.add(y));
  years.add(thisYear());
  return [...years].sort();
}

// Both reports have a ‹ year › switcher; they share reportYear.
function updateYearSwitch(prefix) {
  const years = reportYears();
  $(`${prefix}-year`).textContent = reportYear;
  $(`${prefix}-prev`).disabled = reportYear === years[0];
  $(`${prefix}-next`).disabled = reportYear === years[years.length - 1];
}
function stepYear(step) {
  const years = reportYears();
  reportYear = years[years.indexOf(reportYear) + step];
  rerender();
}
["summary", "rates"].forEach((prefix) => {
  $(`${prefix}-prev`).addEventListener("click", () => stepYear(-1));
  $(`${prefix}-next`).addEventListener("click", () => stepYear(1));
});

$("open-reports").addEventListener("click", () => {
  reportYear = thisYear();
  showScreen("reports");
});
$("close-reports").addEventListener("click", render);
document.querySelectorAll(".to-reports").forEach((b) => b.addEventListener("click", () => showScreen("reports")));
$("open-summary").addEventListener("click", () => { renderSummary(); showScreen("summary"); });
$("open-rates").addEventListener("click", () => { selectedMonth = null; renderRates(); showScreen("rates"); });

// --- Year summary ---

function renderSummary() {
  updateYearSwitch("summary");
  const y = yearStats(reportYear);
  const r = rateResults(reportYear);

  // Total saved vs that year's goal, like the home screen's yearly card
  $("summary-saved").textContent = money(y.saved);
  $("summary-of").textContent = `of ${money(y.goals.yearlyGoal)} · ${pct(y.pct)}`;
  setBar("summary-bar", y.pct);
  $("summary-togo").innerHTML = y.toGo === 0
    ? `<span class="done">🎉 Yearly goal reached!</span>`
    : `${money(y.toGo)} to go`;
  $("summary-starting").textContent = y.startingTotal > 0 ? `${money(y.startingTotal)} from before using the app` : "";

  // Savings rate results
  if (r.months.length === 0) {
    $("summary-rate").innerHTML = `<p class="empty">No months logged in the app for ${reportYear}.</p>`;
  } else {
    const extremes = r.months.length >= 2
      ? `<div class="small">Best: <strong>${monthName(r.best.key)}, ${pct(r.best.rate)}</strong> · ` +
        `Lowest: <strong>${monthName(r.lowest.key)}, ${pct(r.lowest.rate)}</strong></div>`
      : "";
    $("summary-rate").innerHTML = `
      <div class="medium ${r.overall >= r.goal ? "done" : ""}">${pct(r.overall)}</div>
      <div class="muted">goal ${r.goal}% · income ${money(r.income)}</div>
      <div class="bar"><div id="summary-rate-bar"></div></div>
      <div>Months at goal: <strong>${r.atGoal} of ${r.months.length}</strong></div>
      ${extremes}`;
    setBar("summary-rate-bar", r.overall / r.goal * 100);
  }

  $("summary-accounts").innerHTML = accountRows(y.byAccount);

  // Deposits by month, newest first, collapsed unless the user opened them
  const months = [...r.months].reverse();
  $("summary-deposits").innerHTML = months.length === 0
    ? `<p class="empty">No deposits logged in the app for ${reportYear}.</p>`
    : months.map((m) => `
      <details data-month="${m.key}"${openMonths.has(m.key) ? " open" : ""}>
        <summary>
          <span>${monthName(m.key)}</span>
          <span class="amount">${money(m.saved)}</span>
          <span class="muted small">${pct(m.rate)}</span>
        </summary>
        <button class="income-line" data-income="${m.key}">
          Income <strong>${money(m.income)}</strong>${m.estimate ? " (estimate)" : ""} ✎
        </button>
        ${m.deposits.length ? [...m.deposits].sort(newestFirst).map(depositRow).join("") : `<p class="empty small">No deposits this month.</p>`}
      </details>`).join("");
}

// Remember which months are expanded, so a delete or income change doesn't collapse them
$("summary-deposits").addEventListener("toggle", (e) => {
  const month = e.target.dataset.month;
  if (e.target.open) openMonths.add(month); else openMonths.delete(month);
}, true);
$("summary-deposits").addEventListener("click", (e) => {
  const button = e.target.closest("[data-income]");
  if (button) openIncome(button.dataset.income);
});

// --- Savings rate by month ---

function renderRates() {
  updateYearSwitch("rates");
  const goal = goalsFor(reportYear).rateGoal;   // that year's own goal
  const months = monthlyRates(reportYear);
  const shown = months.filter((m) => m.hasData);
  if (!shown.some((m) => m.key === selectedMonth)) selectedMonth = shown.length ? shown[shown.length - 1].key : null;

  const chart = $("rate-chart");
  chart.style.setProperty("--goal", Math.min(goal, 100) / 100);
  chart.innerHTML = `<div class="goal-line"></div>` + months.map((m) => {
    const letter = monthName(m.key, { month: "narrow" });
    if (!m.hasData) {
      return `<button class="chart-col" disabled aria-label="${monthName(m.key)}: no data">
        <div class="chart-plot"></div><span class="chart-month">${letter}</span><span class="chart-value">·</span></button>`;
    }
    return `<button class="chart-col${m.key === selectedMonth ? " selected" : ""}" data-month="${m.key}"
        aria-label="${monthName(m.key)}: ${pct(m.rate)}">
      <div class="chart-plot"><div class="chart-bar${m.rate >= goal ? " hit" : ""}" style="height:${Math.min(m.rate, 100)}%"></div></div>
      <span class="chart-month">${letter}</span><span class="chart-value">${Math.floor(m.rate)}</span></button>`;
  }).join("");

  $("chart-legend").innerHTML = `
    <span><i class="dash"></i>${goal}% goal</span>
    <span><i style="background:var(--good)"></i>Goal hit</span>
    <span><i style="background:var(--bar-miss)"></i>Below goal</span>`;

  if (shown.length === 0) {
    $("report-summary").innerHTML = `<p class="empty">No deposits logged in ${reportYear} yet.</p>`;
    $("report-detail").textContent = "";
    return;
  }

  const r = rateResults(reportYear);
  $("report-summary").innerHTML = `
    <div>Months at goal: <strong>${r.atGoal} of ${r.months.length}</strong></div>
    <div>Overall rate: <strong class="${r.overall >= goal ? "done" : ""}">${pct(r.overall)}</strong></div>`;

  const sel = months.find((m) => m.key === selectedMonth);
  $("report-detail").textContent =
    `${monthName(sel.key, { month: "long", year: "numeric" })}: ${money(sel.saved)} saved of ` +
    `${money(sel.income)} income${sel.estimate ? " (est.)" : ""}, ${pct(sel.rate)}`;
}

$("rate-chart").addEventListener("click", (e) => {
  const col = e.target.closest(".chart-col[data-month]");
  if (!col) return;
  selectedMonth = col.dataset.month;
  renderRates();
});

// ---------- Start ----------
buildPills();
buildStartingFields();
resetDepositForm();
if (data.settings) save();   // store any upgrade() changes straight away
render();
