// Savings Tracker — all app behaviour lives here.
// Reading order: 1) data  2) calculations  3) drawing the screen  4) reacting to taps.

const ACCOUNTS = ["TFSA", "RRSP", "FHSA", "Taxable", "Savings"];
const STORAGE_KEY = "savings-tracker-v1";

// ---------- 1. Data: load and save ----------

// Everything the app knows, in one object (shape documented in docs/2-design.md).
let data = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return { income: {}, deposits: [], lastAccount: "TFSA", starting: null, ...saved };
  } catch (e) { /* storage unavailable or corrupted: start fresh */ }
  return { settings: null, income: {}, deposits: [], lastAccount: "TFSA", starting: null };
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

const sum = (deposits) => deposits.reduce((total, d) => total + d.amount, 0);

// Percent, rounded to 6 decimals so binary rounding (1450 / 5000 * 100 = 28.999999999999996) can't cost a whole point
const percentOf = (part, whole) => Math.round(part / whole * 100 * 1e6) / 1e6;
const cents = (n) => Math.round(n * 100) / 100;

// A month's income: the one entered for that month, else the latest earlier month's, else the starting income.
function incomeFor(monthKey) {
  if (data.income[monthKey]) return { amount: data.income[monthKey], estimate: false };
  const earlier = Object.keys(data.income).filter((k) => k < monthKey).sort().pop();
  return { amount: earlier ? data.income[earlier] : data.settings.startingIncome, estimate: true };
}

// Amounts saved before using the app, per account. Only count for the year they were entered for.
function startingFor(year) {
  return data.starting && data.starting.year === year ? data.starting.amounts : {};
}

function stats() {
  const today = todayString();
  const thisYear = yearOf(today);
  const thisMonth = monthKeyOf(today);

  const yearDeposits = data.deposits.filter((d) => yearOf(d.date) === thisYear);
  const monthDeposits = data.deposits.filter((d) => monthKeyOf(d.date) === thisMonth);

  // Starting balances count toward the year, but not toward the month or savings rate
  const starting = startingFor(thisYear);
  const startingTotal = Object.values(starting).reduce((a, b) => a + b, 0);
  const yearSaved = startingTotal + sum(yearDeposits);
  const monthSaved = sum(monthDeposits);
  const income = incomeFor(thisMonth);
  const rateTarget = income.amount * data.settings.rateGoal / 100;   // $ needed this month

  return {
    today, thisYear, thisMonth,
    yearSaved,
    yearPct: percentOf(yearSaved, data.settings.yearlyGoal),
    yearToGo: Math.max(0, cents(data.settings.yearlyGoal - yearSaved)),
    monthSaved,
    monthCount: monthDeposits.length,
    income,
    rate: percentOf(monthSaved, income.amount),
    rateToGo: Math.max(0, cents(rateTarget - monthSaved)),
    byAccount: ACCOUNTS.map((a) => ({
      account: a,
      total: (starting[a] || 0) + sum(yearDeposits.filter((d) => d.account === a)),
    })),
    starting,
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

function setBar(id, percent) {
  const bar = $(id);
  bar.style.width = `${Math.min(100, percent)}%`;
  bar.parentElement.classList.toggle("complete", percent >= 100);
}

let currentScreen = null;
function showScreen(name) {
  $("settings-screen").hidden = name !== "settings";
  $("home-screen").hidden = name !== "home";
  $("reports-screen").hidden = name !== "reports";
  if (name !== currentScreen) window.scrollTo(0, 0);   // only when switching screens, not on every redraw
  currentScreen = name;
}

function render() {
  if (!data.settings) return openSettings();
  const s = stats();
  showScreen("home");

  // Yearly card
  $("year-label").textContent = `${s.thisYear}/${Number(s.thisYear) + 1}`;   // e.g. "2026/2027"
  document.querySelectorAll(".year-label").forEach((el) => (el.textContent = s.thisYear));
  $("year-saved").textContent = money(s.yearSaved);
  $("year-of").textContent = `of ${money(data.settings.yearlyGoal)} · ${pct(s.yearPct)}`;
  setBar("year-bar", s.yearPct);
  $("year-togo").innerHTML = s.yearToGo === 0
    ? `<span class="done">🎉 Yearly goal reached!</span>`
    : `${money(s.yearToGo)} to go`;

  // Month card
  $("month-label").textContent = monthName(s.thisMonth);
  $("month-saved").textContent = money(s.monthSaved);
  $("month-count").textContent = `${s.monthCount} deposit${s.monthCount === 1 ? "" : "s"}`;

  // Savings rate card
  $("rate-now").textContent = pct(s.rate);
  $("rate-goal").textContent = `goal ${data.settings.rateGoal}%`;
  setBar("rate-bar", s.rate / data.settings.rateGoal * 100);
  $("rate-togo").innerHTML = s.rateToGo === 0
    ? `<span class="done">🎉 Goal hit</span>`
    : `${money(s.rateToGo)} to go`;
  $("edit-income").innerHTML =
    `Income <strong>${money(s.income.amount)}</strong>${s.income.estimate ? " (estimate)" : ""} ✎`;

  // By account
  const maxAccount = Math.max(...s.byAccount.map((a) => a.total), 1);
  $("by-account").innerHTML = s.byAccount.map((a) => `
    <li>
      <span>${a.account}</span>
      <div class="bar"><div style="width:${a.total / maxAccount * 100}%"></div></div>
      <span class="amount">${money(a.total)}</span>
    </li>`).join("");

  renderHistory(s);
}

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
    ? `<div class="month-head">Before using the app (${s.thisYear})</div>${startingRows}`
    : "";

  if (data.deposits.length === 0) {
    $("history").innerHTML = `<p class="empty">No deposits yet. Log your first one above.</p>${startingGroup}`;
    return;
  }
  // Newest first, then grouped under a heading per month
  const sorted = [...data.deposits].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  let html = "";
  let currentMonth = null;
  for (const d of sorted) {
    const m = monthKeyOf(d.date);
    if (m !== currentMonth) {
      currentMonth = m;
      html += `<div class="month-head">${monthName(m, { month: "long", year: "numeric" })}</div>`;
    }
    const day = new Date(`${d.date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    html += `
      <div class="history-row">
        <span class="muted">${day}</span>
        <span class="tag">${d.account}</span>
        <span class="amount">${money(d.amount)}</span>
        <button class="delete" data-id="${d.id}" aria-label="Delete deposit">✕</button>
      </div>`;
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

function openSettings() {
  const form = $("settings-form");
  if (data.settings) {
    form.yearlyGoal.value = data.settings.yearlyGoal;
    form.rateGoal.value = data.settings.rateGoal;
    form.startingIncome.value = data.settings.startingIncome;
  } else {
    form.rateGoal.value = 65;   // the default from the requirements
  }
  const starting = startingFor(yearOf(todayString()));
  ACCOUNTS.forEach((a) => (form[`starting-${a}`].value = starting[a] || ""));
  $("settings-cancel").hidden = !data.settings;   // nothing to go back to on first run
  showScreen("settings");
}

$("open-settings").addEventListener("click", openSettings);
$("settings-cancel").addEventListener("click", render);

$("settings-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  data.settings = {
    yearlyGoal: Number(form.yearlyGoal.value),
    rateGoal: Number(form.rateGoal.value),
    startingIncome: Number(form.startingIncome.value),
  };
  const amounts = {};
  ACCOUNTS.forEach((a) => {
    const value = Number(form[`starting-${a}`].value);
    if (value > 0) amounts[a] = Math.round(value * 100) / 100;
  });
  data.starting = { year: yearOf(todayString()), amounts };
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
    amount: Math.round(Number($("deposit-amount").value) * 100) / 100,
    account,
    date: $("deposit-date").value,
  });
  data.lastAccount = account;
  save();
  resetDepositForm();
  render();

  // Celebrate when this deposit crossed a goal
  const after = stats();
  if (before.yearToGo > 0 && after.yearToGo === 0) toast("🎉 Yearly goal reached!");
  else if (before.rateToGo > 0 && after.rateToGo === 0) toast(`🎉 ${data.settings.rateGoal}% savings rate hit!`);
  else toast(`Added to ${account}`);
});

$("history").addEventListener("click", (e) => {
  const button = e.target.closest(".delete");
  if (!button) return;
  const deposit = data.deposits.find((d) => d.id === button.dataset.id);
  if (!confirm(`Delete ${money(deposit.amount)} to ${deposit.account}?`)) return;
  data.deposits = data.deposits.filter((d) => d !== deposit);
  save();
  render();
});

$("edit-income").addEventListener("click", () => {
  const month = monthKeyOf(todayString());
  $("income-title").textContent = `${monthName(month)} take-home income`;
  $("income-amount").value = incomeFor(month).amount;
  $("income-dialog").returnValue = "";   // so closing with Esc doesn't count as "save"
  $("income-dialog").showModal();
});

$("income-dialog").addEventListener("close", () => {
  if ($("income-dialog").returnValue !== "save") return;
  data.income[monthKeyOf(todayString())] = Number($("income-amount").value);
  save();
  render();
  toast("Income saved");
});

// ---------- Reports ----------

let reportYear = null;      // the year the chart is showing, e.g. "2026"
let selectedMonth = null;   // the month whose details are shown, e.g. "2026-10"

// Years that can be shown: any year with a deposit, plus the current year.
function reportYears() {
  const years = new Set(data.deposits.map((d) => yearOf(d.date)));
  years.add(yearOf(todayString()));
  return [...years].sort();
}

// One entry per month Jan–Dec. Months outside "first logged month → this month (or Dec)" have no data.
function monthlyRates(year) {
  const yearDeposits = data.deposits.filter((d) => yearOf(d.date) === year);
  const first = yearDeposits.map((d) => monthKeyOf(d.date)).sort()[0];
  const thisMonth = monthKeyOf(todayString());
  const last = year === yearOf(todayString()) ? thisMonth : `${year}-12`;

  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    if (!first || key < first || key > last) return { key, hasData: false };
    const saved = sum(yearDeposits.filter((d) => monthKeyOf(d.date) === key));
    const income = incomeFor(key);
    return { key, hasData: true, saved, income: income.amount, estimate: income.estimate, rate: percentOf(saved, income.amount) };
  });
}

function renderReports() {
  const goal = data.settings.rateGoal;
  const months = monthlyRates(reportYear);
  const shown = months.filter((m) => m.hasData);
  if (!shown.some((m) => m.key === selectedMonth)) selectedMonth = shown.length ? shown[shown.length - 1].key : null;

  $("report-year").textContent = reportYear;
  const years = reportYears();
  $("prev-year").disabled = reportYear === years[0];
  $("next-year").disabled = reportYear === years[years.length - 1];

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

  // Overall rate = total saved ÷ total income, so bigger-income months count for more
  const atGoal = shown.filter((m) => m.rate >= goal).length;
  const overall = percentOf(sum(shown.map((m) => ({ amount: m.saved }))), sum(shown.map((m) => ({ amount: m.income }))));
  $("report-summary").innerHTML = `
    <div>Months at goal: <strong>${atGoal} of ${shown.length}</strong></div>
    <div>Overall rate: <strong class="${overall >= goal ? "done" : ""}">${pct(overall)}</strong></div>`;

  const sel = months.find((m) => m.key === selectedMonth);
  $("report-detail").textContent =
    `${monthName(sel.key, { month: "long", year: "numeric" })}: ${money(sel.saved)} saved of ` +
    `${money(sel.income)} income${sel.estimate ? " (est.)" : ""}, ${pct(sel.rate)}`;
}

$("open-reports").addEventListener("click", () => {
  reportYear = yearOf(todayString());
  selectedMonth = null;
  renderReports();
  showScreen("reports");
});
$("close-reports").addEventListener("click", render);

$("prev-year").addEventListener("click", () => {
  const years = reportYears();
  reportYear = years[years.indexOf(reportYear) - 1];
  renderReports();
});
$("next-year").addEventListener("click", () => {
  const years = reportYears();
  reportYear = years[years.indexOf(reportYear) + 1];
  renderReports();
});

$("rate-chart").addEventListener("click", (e) => {
  const col = e.target.closest(".chart-col[data-month]");
  if (!col) return;
  selectedMonth = col.dataset.month;
  renderReports();
});

// ---------- Start ----------
buildPills();
buildStartingFields();
resetDepositForm();
render();
