// app.js — Consolidado y limpiado
// Conserva toda la lógica: almacenamiento, transacciones, presupuestos vinculados, modales, export, interés, reportes, toasts.

(function () {
  // ---------- Helpers ----------
  const $ = id => document.getElementById(id);
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
  const money = (n, currency = 'COP') => Number(n || 0).toLocaleString('es-CO', {
    style: 'currency', currency, maximumFractionDigits: 2
  });
  const nowISO = () => new Date().toISOString();
  const uid = () => (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('id-' + Date.now() + '-' + Math.floor(Math.random() * 10000));

  // ---------- Toast ----------
  function showToast(message, type = 'info', duration = 5000) {
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</div><div class="toast-message">${message}</div>`;
    container.appendChild(toast);
    setTimeout(() => {
      if (!toast.parentNode) return;
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => { if (toast.parentNode) container.removeChild(toast); }, 300);
    }, duration);
  }

  // ---------- Storage ----------
  const STORAGE_KEY = 'banklar_finances_v2';
  function saveState(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); return true; }
    catch (e) { showToast('Error al guardar datos', 'error'); console.error(e); return false; }
  }
  function loadState() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { console.error('Error loading state', e); return null; }
  }

  function exportData(format = 'json') {
    const s = loadState();
    if (!s) { showToast('No hay datos para exportar', 'error'); return; }
    let data, mimeType, filename;
    if (format === 'json') {
      data = JSON.stringify(s, null, 2); mimeType = 'application/json';
      filename = `banklar-backup-${new Date().toISOString().split('T')[0]}.json`;
    } else {
      // csv
      const headers = ['Fecha', 'Tipo', 'Monto', 'Cuenta', 'Categoría/Origen', 'Descripción'];
      const rows = (s.transactions || []).map(tx => [
        tx.date.split('T')[0],
        tx.type === 'income' ? 'Ingreso' : 'Gasto',
        tx.amount,
        tx.account === 'nu' ? 'Caja Nu' : 'Nequi',
        tx.type === 'income' ? (tx.source || 'Ingreso') : (tx.category || 'Gasto'),
        tx.description || ''
      ]);
      data = [headers, ...rows].map(row => row.map(f => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n');
      mimeType = 'text/csv';
      filename = `banklar-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    }
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast(`Datos exportados como ${format.toUpperCase()}`, 'success');
  }

  // ---------- Model / State ----------
  let state = loadState() || {
    user: null,
    transactions: [],
    budgets: {},
    settings: { nuEA: 8.5, lowThreshold: 20000, currency: 'COP' },
    meta: { lastInterestApplied: null, lastUpdated: nowISO() }
  };

  const DEFAULT_CATEGORIES = ['Transporte', 'Skincare', 'Salud', 'Entretenimiento', 'Comida', 'Otros'];

  // ---------- Cached elements ----------
  const el = {
    greeting: $('greeting'),
    balanceNu: $('balance-nu'),
    balanceNequi: $('balance-nequi'),
    balanceTotal: $('balance-total'),
    balanceStatus: $('balance-status'),
    nuInterestInfo: $('nu-interest-info'),
    txForm: $('tx-form'),
    txType: $('tx-type'),
    incomeSourceRow: $('income-source-row'),
    expenseCategoryRow: $('expense-category-row'),
    incomeSource: $('income-source'),
    expenseCategory: $('expense-category'),
    txAmount: $('tx-amount'),
    txAccount: $('tx-account'),
    depositToNu: $('deposit-to-nu'),
    nuSplitRow: $('nu-split-row'),
    nuSplitAmount: $('nu-split-amount'),
    lastTxList: $('last-tx-list'),
    btnViewAll: $('btn-view-all'),
    btnViewAll2: $('btn-view-all-2'),
    alerts: $('alerts'),
    totalIncomes: $('total-incomes'),
    totalExpenses: $('total-expenses'),
    suggestedSavings: $('suggested-savings'),
    projectedInterest: $('projected-interest'),
    pieCanvas: $('expenses-pie'),
    budgetsList: $('budgets-list'),
    btnSettings: $('btn-settings'),
    modalOverlay: $('modal-overlay'),
    setupModal: $('setup-modal'),
    viewAllModal: $('view-all-modal'),
    settingsModal: $('settings-modal'),
    budgetsModal: $('budgets-modal'),
    refreshBalances: $('refresh-balances'),
    btnExpensesReport: $('btn-expenses-report'),
    expensesReportModal: $('expenses-report-modal')
  };

  // ---------- Categories ----------
  function getCategories() {
    const fromTx = (state.transactions || []).filter(t => t.type === 'expense' && t.category).map(t => String(t.category).trim());
    const fromBudgets = Object.keys(state.budgets || {});
    const all = [...DEFAULT_CATEGORIES, ...fromTx, ...fromBudgets];
    const seen = new Set(); const res = [];
    all.forEach(c => { if (c && !seen.has(c)) { seen.add(c); res.push(c); } });
    return res;
  }

  function populateCategorySelects() {
    const cats = getCategories();
    const expSel = $('expense-category');
    if (expSel) {
      const prev = expSel.value;
      expSel.innerHTML = '';
      cats.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.textContent = c; expSel.appendChild(opt); });
      if (cats.includes(prev)) expSel.value = prev;
    }
    const budgetSel = $('new-budget-name');
    if (budgetSel) {
      const prev = budgetSel.value;
      budgetSel.innerHTML = '<option value="" disabled selected>Seleccionar categoría</option>';
      cats.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.textContent = c; budgetSel.appendChild(opt); });
      if (cats.includes(prev)) budgetSel.value = prev;
    }
  }

  // ---------- Transactions / totals ----------
  function calcTotals() {
    let incomes = 0, expenses = 0;
    (state.transactions || []).forEach(t => { if (t.type === 'income') incomes += Number(t.amount); else expenses += Number(t.amount); });
    return { incomes, expenses };
  }

  function calcExpensesByCategory() {
    const map = {};
    (state.transactions || []).forEach(t => {
      if (t.type === 'expense') {
        const c = t.category || 'Otros'; map[c] = (map[c] || 0) + Number(t.amount);
      }
    });
    return map;
  }

  function addTransaction(tx) {
    state.transactions.push(tx);
    if (saveState(state)) showToast('Transacción registrada correctamente', 'success');
    populateCategorySelects(); renderAll();
  }

  function removeTransactionById(id) {
    const idx = state.transactions.findIndex(t => t.id === id);
    if (idx >= 0) {
      state.transactions.splice(idx, 1);
      if (saveState(state)) showToast('Transacción eliminada', 'success');
      populateCategorySelects(); renderAll();
    }
  }

  // ---------- Balances ----------
  function computeBalances() {
    let nu = state.user ? Number(state.user.nu || 0) : 0;
    let nequi = state.user ? Number(state.user.nequi || 0) : 0;
    const txs = (state.transactions || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    txs.forEach(tx => {
      if (tx.type === 'income') {
        if (tx.nuAllocated && tx.nuAllocated > 0) {
          nu += Number(tx.nuAllocated);
          const rest = Number(tx.amount) - Number(tx.nuAllocated);
          if (rest > 0) nequi += rest;
        } else { if (tx.account === 'nu') nu += Number(tx.amount); else nequi += Number(tx.amount); }
      } else {
        if (tx.account === 'nu') nu -= Number(tx.amount); else nequi -= Number(tx.amount);
      }
    });
    return { nu, nequi, total: nu + nequi };
  }

  // ---------- Rendering ----------
  function renderAll() {
    if (!state.user) { showSetup(); populateCategorySelects(); return; }
    hideAllModals();
    if (el.greeting) el.greeting.textContent = `Hola, ${state.user.name}`;
    const balances = computeBalances(), currency = state.settings.currency || 'COP';
    if (el.balanceNu) el.balanceNu.textContent = money(balances.nu, currency);
    if (el.balanceNequi) el.balanceNequi.textContent = money(balances.nequi, currency);
    if (el.balanceTotal) el.balanceTotal.textContent = money(balances.total, currency);
    if (el.nuInterestInfo) el.nuInterestInfo.textContent = `EA: ${Number(state.settings.nuEA).toFixed(2)}%`;
    const low = Number(state.settings.lowThreshold || 0);
    if (el.balanceStatus) {
      el.balanceStatus.textContent = balances.total < low ? 'Saldo bajo' : 'Estable';
      el.balanceStatus.style.color = balances.total < low ? '#ef4444' : '#10b981';
    }

    // last transactions
    if (el.lastTxList) {
      el.lastTxList.innerHTML = '';
      const sorted = (state.transactions || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
      const last3 = sorted.slice(0, 3);
      if (last3.length === 0) {
        const li = document.createElement('li'); li.className = 'tx-item'; li.innerHTML = '<div class="meta">No hay transacciones recientes</div>'; el.lastTxList.appendChild(li);
      } else {
        last3.forEach(tx => {
          const li = document.createElement('li'); li.className = 'tx-item';
          li.innerHTML = `
            <div>
              <div><strong>${tx.type === 'income' ? '+' : '-'} ${money(tx.amount, currency)}</strong> <span class="meta">| ${tx.account.toUpperCase()} | ${tx.date.slice(0,10)}</span></div>
              <div class="meta">${tx.type === 'income' ? (tx.source || 'Ingreso') : (tx.category || 'Gasto')}</div>
            </div>
            <div class="actions">
              <button class="btn-ghost" data-id="${tx.id}" data-action="view">Ver</button>
              <button class="delete" data-id="${tx.id}" data-action="del">Eliminar</button>
            </div>`;
          el.lastTxList.appendChild(li);
        });
      }
    }

    const totals = calcTotals();
    if (el.totalIncomes) el.totalIncomes.textContent = money(totals.incomes, currency);
    if (el.totalExpenses) el.totalExpenses.textContent = money(totals.expenses, currency);
    const rec = suggestSavings(totals); if (el.suggestedSavings) el.suggestedSavings.textContent = rec.text;
    const projected = (balances.nu * (Number(state.settings.nuEA) / 100)); if (el.projectedInterest) el.projectedInterest.textContent = money(projected, currency);

    renderAlerts(balances, totals);
    renderBudgets(balances, totals);
    renderExpensesPie();
    populateCategorySelects();

    state.meta.lastUpdated = nowISO(); saveState(state);
  }

  function renderAlerts(balances, totals) {
    if (!el.alerts) return;
    el.alerts.innerHTML = '';
    if (balances.total < Number(state.settings.lowThreshold || 0)) {
      const d = document.createElement('div'); d.className = 'alert danger'; d.textContent = `Alerta: tu saldo total es bajo (${money(balances.total, state.settings.currency)}). Revisa tu presupuesto.`; el.alerts.appendChild(d);
    } else {
      const d = document.createElement('div'); d.className = 'alert good'; d.textContent = `Saldo OK. Total disponible ${money(balances.total, state.settings.currency)}.`; el.alerts.appendChild(d);
    }
    if (totals.expenses > totals.incomes) {
      const d = document.createElement('div'); d.className = 'alert danger'; d.textContent = `Estás gastando más de lo que ingresas (Gastos ${money(totals.expenses, state.settings.currency)} > Ingresos ${money(totals.incomes, state.settings.currency)}).`; el.alerts.appendChild(d);
    } else {
      const ratio = totals.incomes > 0 ? (totals.expenses / totals.incomes) : 0;
      if (ratio > 0.8) { const d = document.createElement('div'); d.className = 'alert info'; d.textContent = `Atención: tus gastos están en ${Math.round(ratio * 100)}% de tus ingresos.`; el.alerts.appendChild(d); }
    }

    const spentByCat = calcExpensesByCategory();
    Object.keys(state.budgets).forEach(cat => {
      const spent = spentByCat[cat] || 0, budget = state.budgets[cat] || 0;
      if (budget > 0 && spent > budget) {
        const d = document.createElement('div'); d.className = 'alert danger'; d.textContent = `Has excedido el presupuesto en ${cat}: gastado ${money(spent, state.settings.currency)} / presupuesto ${money(budget, state.settings.currency)}.`; el.alerts.appendChild(d);
      }
    });
  }

  function renderBudgets() {
    if (!el.budgetsList) return;
    el.budgetsList.innerHTML = '';
    const spentByCat = calcExpensesByCategory();
    const keys = Object.keys(state.budgets);
    if (keys.length === 0) { el.budgetsList.innerHTML = '<div class="meta">No hay presupuestos. Crea uno desde "Editar / Crear presupuestos".</div>'; return; }
    keys.forEach(cat => {
      const budget = Number(state.budgets[cat] || 0), spent = Number(spentByCat[cat] || 0);
      const percent = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
      const div = document.createElement('div');
      div.innerHTML = `<div style="display:flex;justify-content:space-between"><div>${cat}</div><div class="meta">${money(spent, state.settings.currency)} / ${money(budget, state.settings.currency)}</div></div><div class="progress"><i style="width:${percent}%;"></i></div>`;
      el.budgetsList.appendChild(div);
    });
  }

  // ---------- Pie chart ----------
  function renderExpensesPie() {
    if (!el.pieCanvas) return;
    const canvas = el.pieCanvas, ctx = canvas.getContext('2d'), rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(220, Math.floor(rect.width)); canvas.height = 160; ctx.clearRect(0, 0, canvas.width, canvas.height);
    const data = calcExpensesByCategory(); const entries = Object.entries(data).filter(e => e[1] > 0);
    if (entries.length === 0) {
      ctx.fillStyle = 'rgba(15,9,55,0.04)'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#6b7280'; ctx.font = '12px Inter'; ctx.textAlign = 'center'; ctx.fillText('Sin gastos registrados', canvas.width / 2, 80); return;
    }
    const total = entries.reduce((s, e) => s + e[1], 0); let start = -Math.PI / 2;
    const colors = ['#7c3aed', '#a78bfa', '#c084fc', '#f472b6', '#d946ef', '#c026d3', '#8b5cf6'];
    entries.forEach((e, i) => {
      const slice = e[1] / total * (Math.PI * 2);
      ctx.beginPath(); ctx.moveTo(canvas.width * 0.33, 80); ctx.arc(canvas.width * 0.33, 80, 60, start, start + slice); ctx.closePath();
      ctx.fillStyle = colors[i % colors.length]; ctx.fill();
      start += slice;
    });
    ctx.font = '12px Inter'; ctx.textAlign = 'left'; let y = 12;
    entries.forEach((e, i) => {
      ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(canvas.width * 0.66, y, 10, 10); ctx.fillStyle = '#374151';
      const percent = Math.round((e[1] / total) * 100); ctx.fillText(`${e[0]} (${percent}%)`, canvas.width * 0.66 + 16, y + 10); y += 18;
    });
  }

  // ---------- Reports ----------
  function showExpensesReport() {
    showOverlay();
    const modal = $('expenses-report-modal'); if (!modal) return; modal.classList.remove('hidden');
    const container = $('expenses-report-container'); if (!container) return; container.innerHTML = '';
    const entries = Object.entries(calcExpensesByCategory()).filter(e => e[1] > 0); if (entries.length === 0) { container.innerHTML = '<div class="meta">No hay gastos registrados.</div>'; return; }
    entries.sort((a, b) => b[1] - a[1]); const total = entries.reduce((s, e) => s + e[1], 0);
    entries.forEach(([cat, amt]) => {
      const percent = total > 0 ? (amt / total) * 100 : 0; const div = document.createElement('div'); div.className = 'tx-row';
      div.innerHTML = `<div style="font-size:14px;color:var(--text)">${cat}</div><div style="font-weight:700">${Math.round(percent)}% &nbsp;&nbsp; ${money(amt, state.settings.currency)}</div>`;
      container.appendChild(div);
    });
    const footer = document.createElement('div'); footer.style.marginTop = '8px'; footer.className = 'meta'; footer.textContent = `Total gastado: ${money(total, state.settings.currency)}`; container.appendChild(footer);
  }

  // ---------- Interest ----------
  function daysBetween(a, b) { return Math.floor((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24)); }
  function computeAccruedInterest() {
    if (!state.meta.lastInterestApplied) return 0; const balances = computeBalances(); const days = daysBetween(state.meta.lastInterestApplied, nowISO()); if (days <= 0) return 0;
    const annualRate = Number(state.settings.nuEA || 0) / 100; return balances.nu * annualRate * (days / 365);
  }
  function applyInterestNow() {
    const interest = computeAccruedInterest(); if (interest <= 0) { showToast('No hay interés acumulado aún', 'info'); return; }
    if (!confirm(`Aplicar interés acumulado ${money(interest, state.settings.currency)} ahora?`)) return;
    const tx = { id: uid(), type: 'income', amount: Number(interest.toFixed(2)), date: nowISO(), account: 'nu', source: 'Interés EA', nuAllocated: Number(interest.toFixed(2)) };
    state.transactions.push(tx); state.meta.lastInterestApplied = nowISO(); if (saveState(state)) showToast(`Interés de ${money(interest, state.settings.currency)} aplicado a Caja Nu`, 'success'); populateCategorySelects(); renderAll();
  }

  // ---------- Recommendations ----------
  function suggestSavings(totals) {
    if (totals.incomes <= 0) return { text: 'Registra tus ingresos para recomendaciones.' };
    const recentSalary = state.transactions.find(t => t.type === 'income' && (String(t.source) === 'Salario' || String(t.source).toLowerCase() === 'novaklar'));
    const ratio = totals.incomes > 0 ? (totals.expenses / totals.incomes) : 0;
    if (ratio > 0.9) return { text: 'Muy alto gasto. Reduce gastos inmediatos (≥10%).' };
    if (recentSalary) {
      let recommendedPercent = 20; if (ratio < 0.4) recommendedPercent = 30; else if (ratio < 0.6) recommendedPercent = 25;
      const savingsAmount = totals.incomes * (recommendedPercent / 100);
      return { text: `${recommendedPercent}% de tus ingresos (${money(savingsAmount, state.settings.currency)}) como ahorro.` };
    }
    return { text: 'Considera ahorrar 15-20% de tus ingresos.' };
  }

  // ---------- Modals ----------
  function showOverlay() { if (el.modalOverlay) el.modalOverlay.classList.remove('hidden'); }
  function hideOverlay() { if (el.modalOverlay) el.modalOverlay.classList.add('hidden'); }
  function hideAllModals() {
    [el.setupModal, el.viewAllModal, el.settingsModal, el.budgetsModal, $('export-modal'), $('expenses-report-modal')].forEach(m => { if (m) m.classList.add('hidden'); });
    hideOverlay();
  }
  function showSetup() { showOverlay(); if (el.setupModal) el.setupModal.classList.remove('hidden'); if ($('user-nu')) $('user-nu').value = state.user ? state.user.nu : 0; if ($('user-nequi')) $('user-nequi').value = state.user ? state.user.nequi : 0; if ($('user-nu-ea')) $('user-nu-ea').value = state.settings.nuEA || 8.5; }
  function showViewAll() { showOverlay(); if (el.viewAllModal) el.viewAllModal.classList.remove('hidden'); const container = $('all-tx-container'); if (!container) return; container.innerHTML = ''; const typeFilter = $('tx-filter-type') ? $('tx-filter-type').value : 'all'; const accountFilter = $('tx-filter-account') ? $('tx-filter-account').value : 'all'; const searchFilter = $('tx-search') ? $('tx-search').value : ''; const filtered = filterTransactions(typeFilter, accountFilter, searchFilter).sort((a, b) => new Date(b.date) - new Date(a.date)); if (filtered.length === 0) { container.innerHTML = '<div class="meta">No hay transacciones que coincidan con los filtros.</div>'; return; } filtered.forEach(tx => { const div = document.createElement('div'); div.className = 'tx-row'; div.innerHTML = `<div><div><strong>${tx.type === 'income' ? '+' : '-'} ${money(tx.amount, state.settings.currency)}</strong> <span class="meta">| ${tx.account.toUpperCase()} | ${tx.date.slice(0,10)}</span></div><div class="meta">${tx.type === 'income' ? (tx.source || 'Ingreso') : (tx.category || 'Gasto')}</div></div><div style="display:flex;gap:6px;align-items:center"><button class="btn-ghost" data-action="revert" data-id="${tx.id}">Eliminar</button></div>`; container.appendChild(div); });
  }
  function showSettings() { showOverlay(); if (el.settingsModal) el.settingsModal.classList.remove('hidden'); if ($('settings-nu-ea')) $('settings-nu-ea').value = state.settings.nuEA || 8.5; if ($('settings-low-threshold')) $('settings-low-threshold').value = state.settings.lowThreshold || 20000; if ($('settings-currency')) $('settings-currency').value = state.settings.currency || 'COP'; }
  function showBudgets() {
    showOverlay(); if (!el.budgetsModal) return; el.budgetsModal.classList.remove('hidden');
    const list = $('budgets-form-list'); if (!list) return; list.innerHTML = ''; const keys = Object.keys(state.budgets); const cats = getCategories();
    if (keys.length === 0) { const p = document.createElement('div'); p.className = 'meta'; p.textContent = 'Aún no hay presupuestos. Agrega uno abajo.'; list.appendChild(p); }
    let i = 0;
    keys.forEach(k => {
      const div = document.createElement('div'); div.className = 'row'; div.style.display = 'flex'; div.style.gap = '8px'; div.style.alignItems = 'center';
      const selHtml = document.createElement('select'); selHtml.style.flex = '1'; selHtml.style.padding = '8px'; selHtml.style.borderRadius = '8px'; selHtml.style.border = '1px solid rgba(0,0,0,0.06)'; selHtml.dataset.idx = i; selHtml.className = 'budget-cat-select';
      const used = new Set();
      cats.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.textContent = c; if (c === k) opt.selected = true; selHtml.appendChild(opt); used.add(c); });
      if (!used.has(k)) { const opt = document.createElement('option'); opt.value = k; opt.textContent = k; opt.selected = true; selHtml.appendChild(opt); }
      const amtInput = document.createElement('input'); amtInput.type = 'number'; amtInput.min = '0'; amtInput.step = '0.01'; amtInput.value = state.budgets[k]; amtInput.style.width = '120px'; amtInput.style.padding = '8px'; amtInput.style.borderRadius = '8px'; amtInput.style.border = '1px solid rgba(0,0,0,0.06)'; amtInput.className = 'budget-amt-input';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn-ghost remove-budget'; btn.dataset.key = k; btn.textContent = 'Eliminar';
      div.appendChild(selHtml); div.appendChild(amtInput); div.appendChild(btn); list.appendChild(div); i++;
    });
  }
  function showExportModal() { showOverlay(); const m = $('export-modal'); if (m) m.classList.remove('hidden'); }

  // ---------- Events ----------
  if (el.txType) el.txType.addEventListener('change', e => { const isIncome = e.target.value === 'income'; if (el.incomeSourceRow) el.incomeSourceRow.style.display = isIncome ? 'block' : 'none'; if (el.expenseCategoryRow) el.expenseCategoryRow.style.display = isIncome ? 'none' : 'block'; if (el.depositToNu && el.depositToNu.parentElement) el.depositToNu.parentElement.style.display = isIncome ? 'block' : 'none'; populateCategorySelects(); });
  if (el.depositToNu) el.depositToNu.addEventListener('change', e => { if (el.nuSplitRow) el.nuSplitRow.style.display = e.target.checked ? 'block' : 'none'; });

  if (el.txForm) {
    el.txForm.addEventListener('submit', e => {
      e.preventDefault();
      const type = el.txType.value; const amount = Number(el.txAmount.value || 0);
      if (amount <= 0) { showToast('El monto debe ser mayor a 0', 'error'); return; }
      const account = el.txAccount.value; const date = nowISO();
      if (type === 'income') {
        const source = el.incomeSource.value; const depositNU = el.depositToNu && el.depositToNu.checked; let nuAllocated = 0;
        if (depositNU) { const split = Number(el.nuSplitAmount.value || 0); nuAllocated = (split > 0 && split < amount) ? split : amount; }
        const tx = { id: uid(), type: 'income', amount: Number(amount.toFixed(2)), date, account, source, nuAllocated: nuAllocated > 0 ? Number(nuAllocated.toFixed(2)) : 0 };
        addTransaction(tx);
      } else {
        const category = el.expenseCategory ? el.expenseCategory.value : 'Otros';
        const tx = { id: uid(), type: 'expense', amount: Number(amount.toFixed(2)), date, account, category };
        addTransaction(tx);
      }
      el.txForm.reset(); if (el.nuSplitRow) el.nuSplitRow.style.display = 'none';
    });
  }

  document.addEventListener('click', e => {
    const action = e.target.dataset.action, id = e.target.dataset.id;
    if (!action) return;
    if (action === 'del' || action === 'revert') {
      if (confirm('¿Eliminar transacción? Esto revertirá su efecto.')) {
        removeTransactionById(id); if (action === 'revert') showViewAll();
      }
    } else if (action === 'view') {
      const tx = state.transactions.find(t => t.id === id); if (!tx) return;
      alert(`Transacción:\nID: ${tx.id}\nTipo: ${tx.type}\nMonto: ${money(tx.amount, state.settings.currency)}\nCuenta: ${tx.account}\n${tx.type === 'income' ? 'Origen: ' + tx.source : 'Categoría: ' + tx.category}`);
    }
  });

  if (el.btnViewAll) el.btnViewAll.addEventListener('click', showViewAll);
  if (el.btnViewAll2) el.btnViewAll2.addEventListener('click', showViewAll);

  if ($('tx-filter-type')) { $('tx-filter-type').addEventListener('change', showViewAll); $('tx-filter-account').addEventListener('change', showViewAll); $('tx-search').addEventListener('input', debounce(showViewAll, 300)); }
  on('close-all-tx', 'click', hideAllModals);
  if (el.modalOverlay) el.modalOverlay.addEventListener('click', hideAllModals);
  if (el.btnSettings) el.btnSettings.addEventListener('click', showSettings);

  on('settings-form', 'submit', e => {
    e.preventDefault();
    const val = Number($('settings-nu-ea').value || 0); state.settings.nuEA = val;
    state.settings.lowThreshold = Number($('settings-low-threshold').value || 0);
    state.settings.currency = $('settings-currency').value || 'COP';
    if (!state.meta.lastInterestApplied) state.meta.lastInterestApplied = nowISO();
    if (saveState(state)) showToast('Configuración guardada correctamente', 'success');
    hideAllModals(); renderAll();
  });

  on('btn-apply-interest', 'click', () => { if (!state.meta.lastInterestApplied) state.meta.lastInterestApplied = nowISO(); applyInterestNow(); });
  on('btn-edit-budgets', 'click', showBudgets); on('btn-close-budgets', 'click', hideAllModals);

  on('btn-export', 'click', showExportModal); on('btn-close-export', 'click', hideAllModals);
  on('btn-export-csv', 'click', () => exportData('csv')); on('btn-export-json', 'click', () => exportData('json'));

  on('btn-add-budget', 'click', () => {
    const sel = $('new-budget-name'); const name = sel ? sel.value : ''; const amt = Number($('new-budget-amt').value || 0);
    if (!name) { showToast('Selecciona una categoría válida', 'error'); return; }
    if (amt <= 0) { showToast('Ingresa monto mayor a 0', 'error'); return; }
    state.budgets[name] = amt; if (saveState(state)) showToast('Presupuesto agregado', 'success');
    if (sel) sel.value = ''; $('new-budget-amt').value = ''; populateCategorySelects(); showBudgets(); renderAll();
  });

  const budgetsListEl = $('budgets-form-list');
  if (budgetsListEl) budgetsListEl.addEventListener('click', e => {
    if (e.target.classList.contains('remove-budget')) {
      const key = e.target.dataset.key; if (confirm(`¿Eliminar presupuesto ${key}?`)) { delete state.budgets[key]; if (saveState(state)) showToast('Presupuesto eliminado', 'success'); populateCategorySelects(); showBudgets(); renderAll(); }
    }
  });

  if ($('budgets-form')) $('budgets-form').addEventListener('submit', e => {
    e.preventDefault();
    const list = $('budgets-form-list'); if (!list) return;
    const selects = list.querySelectorAll('.budget-cat-select'); const amtInputs = list.querySelectorAll('.budget-amt-input'); const newBudgets = {};
    for (let i = 0; i < selects.length; i++) {
      const name = selects[i].value && String(selects[i].value).trim(); const amt = Number((amtInputs[i] && amtInputs[i].value) || 0);
      if (name && amt > 0) newBudgets[name] = amt;
    }
    state.budgets = newBudgets; if (saveState(state)) showToast('Presupuestos guardados correctamente', 'success');
    populateCategorySelects(); hideAllModals(); renderAll();
  });

  if ($('setup-form')) $('setup-form').addEventListener('submit', e => {
    e.preventDefault(); const name = $('user-name').value.trim(); const nu = Number($('user-nu').value || 0); const nequi = Number($('user-nequi').value || 0); const ea = Number($('user-nu-ea').value || 8.5);
    state.user = { name, nu, nequi, createdAt: nowISO() }; state.settings.nuEA = ea; if (!state.meta.lastInterestApplied) state.meta.lastInterestApplied = nowISO();
    if (saveState(state)) showToast('Configuración inicial guardada', 'success'); hideAllModals(); populateCategorySelects(); renderAll();
  });

  if (el.refreshBalances) el.refreshBalances.addEventListener('click', () => { renderAll(); showToast('Balances actualizados', 'success'); });
  if (el.btnExpensesReport) el.btnExpensesReport.addEventListener('click', showExpensesReport);
  const closeExpBtn = $('close-expenses-report'); if (closeExpBtn) closeExpBtn.addEventListener('click', hideAllModals);

  // ---------- Utilities ----------
  function debounce(func, wait) { let timeout; return function (...args) { clearTimeout(timeout); timeout = setTimeout(() => func(...args), wait); }; }

  // ---------- Debug ----------
  window.__banklar_clear = function () { if (confirm('¿Borrar todos los datos locales?')) { localStorage.removeItem(STORAGE_KEY); location.reload(); } };

  // ---------- Init ----------
  if (!state.meta.lastInterestApplied && state.user) state.meta.lastInterestApplied = nowISO();
  window.addEventListener('load', () => { populateCategorySelects(); const interest = computeAccruedInterest(); if (interest > 0.01) console.log(`Interés acumulado: ${money(interest, state.settings.currency)}`); renderAll(); });

  // ---------- Public API for debugging */
  window._banklar_state = state;
  window._banklar_applyInterest = applyInterestNow;
  window._banklar_exportData = exportData;
})();
