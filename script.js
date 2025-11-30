// Banklar — app.js (ajustes: remover notas, mejorar claves y nombres de depuración)
// Autor: prototipo actualizado por asistente.

(function(){
  // ---------- Helpers ----------
  const $ = id => document.getElementById(id);
  const money = n => Number(n || 0).toLocaleString('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:2});
  const nowISO = () => new Date().toISOString();
  const uid = () => (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('id-'+Date.now()+'-'+Math.floor(Math.random()*10000));

  // ---------- Storage ----------
  const STORAGE_KEY = 'banklar_finances_v1';
  function saveState(state){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function loadState(){
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e){ return null; }
  }

  // ---------- Default data model ----------
  let state = loadState() || {
    user: null,
    transactions: [],
    budgets: {},
    settings: { nuEA: 8.5, lowThreshold: 20000 },
    meta: { lastInterestApplied: null }
  };

  // ---------- UI elements ----------
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
    budgetsModal: $('budgets-modal')
  };

  // ---------- Basic balances derived from transactions and user initial amounts ----------
  function computeBalances(){
    let nu = state.user ? Number(state.user.nu || 0) : 0;
    let nequi = state.user ? Number(state.user.nequi || 0) : 0;
    const txs = (state.transactions||[]).slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
    txs.forEach(tx => {
      if (tx.type === 'income'){
        if (tx.nuAllocated && tx.nuAllocated > 0){
          nu += Number(tx.nuAllocated);
          const rest = Number(tx.amount) - Number(tx.nuAllocated);
          if (rest > 0) nequi += rest;
        } else {
          if (tx.account === 'nu') nu += Number(tx.amount);
          else nequi += Number(tx.amount);
        }
      } else {
        if (tx.account === 'nu') nu -= Number(tx.amount);
        else nequi -= Number(tx.amount);
      }
    });
    return { nu, nequi, total: nu + nequi };
  }

  // ---------- Rendering ----------
  function renderAll(){
    if (!state.user){
      showSetup();
      return;
    }
    hideAllModals();
    el.greeting.textContent = `Hola, ${state.user.name}`;

    const balances = computeBalances();
    el.balanceNu.textContent = money(balances.nu);
    el.balanceNequi.textContent = money(balances.nequi);
    el.balanceTotal.textContent = money(balances.total);
    el.nuInterestInfo.textContent = `EA: ${Number(state.settings.nuEA).toFixed(2)}%`;

    const low = Number(state.settings.lowThreshold || 0);
    if (balances.total < low) {
      el.balanceStatus.textContent = 'Saldo bajo';
      el.balanceStatus.style.color = '#ef4444';
    } else {
      el.balanceStatus.textContent = 'Estable';
      el.balanceStatus.style.color = '#10b981';
    }

    const sorted = (state.transactions||[]).slice().sort((a,b)=> new Date(b.date) - new Date(a.date));
    const last3 = sorted.slice(0,3);
    el.lastTxList.innerHTML = '';
    last3.forEach(tx => {
      const li = document.createElement('li');
      li.className = 'tx-item';
      li.innerHTML = `
        <div>
          <div><strong>${tx.type === 'income' ? '+' : '-' } ${money(tx.amount)}</strong> <span class="meta">| ${tx.account.toUpperCase()} | ${tx.date.slice(0,10)}</span></div>
          <div class="meta">${tx.type==='income'? (tx.source||'Ingreso') : (tx.category||'Gasto')}</div>
        </div>
        <div class="actions">
          <button class="btn-ghost" data-id="${tx.id}" data-action="view">Ver</button>
          <button class="delete" data-id="${tx.id}" data-action="del">Eliminar</button>
        </div>
      `;
      el.lastTxList.appendChild(li);
    });

    const totals = calcTotals();
    el.totalIncomes.textContent = money(totals.incomes);
    el.totalExpenses.textContent = money(totals.expenses);

    const rec = suggestSavings(totals);
    el.suggestedSavings.textContent = rec.text;

    const nuAmt = balances.nu;
    const projected = (nuAmt * (Number(state.settings.nuEA) / 100));
    el.projectedInterest.textContent = money(projected);

    renderAlerts(balances, totals);
    renderBudgets(balances, totals);
    renderExpensesPie();

    saveState(state);
  }

  function renderAlerts(balances, totals){
    el.alerts.innerHTML = '';
    if (balances.total < Number(state.settings.lowThreshold || 0)){
      const d = document.createElement('div'); d.className='alert danger'; d.textContent = `Alerta: tu saldo total es bajo (${money(balances.total)}). Revisa tu presupuesto.`;
      el.alerts.appendChild(d);
    } else {
      const d = document.createElement('div'); d.className='alert good'; d.textContent = `Saldo OK. Total disponible ${money(balances.total)}.`;
      el.alerts.appendChild(d);
    }

    if (totals.expenses > totals.incomes){
      const d = document.createElement('div'); d.className='alert danger'; d.textContent = `Estás gastando más de lo que ingresas (Gastos ${money(totals.expenses)} > Ingresos ${money(totals.incomes)}).`;
      el.alerts.appendChild(d);
    } else {
      const ratio = totals.incomes > 0 ? (totals.expenses / totals.incomes) : 0;
      if (ratio > 0.8){
        const d = document.createElement('div'); d.className='alert info'; d.textContent = `Atención: tus gastos están en ${Math.round(ratio*100)}% de tus ingresos.`;
        el.alerts.appendChild(d);
      }
    }

    const spentByCat = calcExpensesByCategory();
    Object.keys(state.budgets).forEach(cat => {
      const spent = spentByCat[cat] || 0;
      const budget = state.budgets[cat] || 0;
      if (budget>0 && spent > budget){
        const d = document.createElement('div'); d.className='alert danger'; d.textContent = `Has excedido el presupuesto en ${cat}: gastado ${money(spent)} / presupuesto ${money(budget)}.`;
        el.alerts.appendChild(d);
      }
    });
  }

  function renderBudgets(balances, totals){
    el.budgetsList.innerHTML = '';
    const spentByCat = calcExpensesByCategory();
    const keys = Object.keys(state.budgets);
    if (keys.length === 0){
      el.budgetsList.innerHTML = '<div class="meta">No hay presupuestos. Crea uno desde "Editar / Crear presupuestos".</div>';
      return;
    }
    keys.forEach(cat=>{
      const budget = Number(state.budgets[cat]||0);
      const spent = Number(spentByCat[cat]||0);
      const percent = budget>0 ? Math.min(100, Math.round((spent/budget)*100)) : 0;
      const div = document.createElement('div');
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between">
          <div>${cat}</div>
          <div class="meta">${money(spent)} / ${money(budget)}</div>
        </div>
        <div class="progress"><i style="width:${percent}%;"></i></div>
      `;
      el.budgetsList.appendChild(div);
    });
  }

  // ---------- Transactions & totals ----------
  function addTransaction(tx){
    state.transactions.push(tx);
    saveState(state);
    renderAll();
  }

  function removeTransactionById(id){
    const idx = state.transactions.findIndex(t=>t.id===id);
    if (idx>=0){
      state.transactions.splice(idx,1);
      saveState(state);
      renderAll();
    }
  }

  function calcTotals(){
    let incomes = 0, expenses = 0;
    (state.transactions||[]).forEach(t=>{
      if (t.type==='income') incomes += Number(t.amount);
      else expenses += Number(t.amount);
    });
    return { incomes, expenses };
  }

  function calcExpensesByCategory(){
    const map = {};
    (state.transactions||[]).forEach(t=>{
      if (t.type==='expense'){
        const c = t.category || 'Otros';
        map[c] = (map[c]||0) + Number(t.amount);
      }
    });
    return map;
  }

  // ---------- Pie chart responsive ----------
  function renderExpensesPie(){
    const canvas = el.pieCanvas;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(220, Math.floor(rect.width));
    canvas.height = 160;
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const data = calcExpensesByCategory();
    const entries = Object.entries(data).filter(e=>e[1]>0);
    if (entries.length===0){
      ctx.fillStyle = 'rgba(15,9,55,0.04)';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px Inter';
      ctx.fillText('Sin gastos registrados', 20, 80);
      return;
    }
    const total = entries.reduce((s,e)=>s+e[1],0);
    let start = -Math.PI/2;
    const colors = ['#7c3aed','#a78bfa','#c084fc','#f472b6','#d946ef','#c026d3','#8b5cf6'];
    entries.forEach((e,i)=>{
      const slice = e[1]/total * (Math.PI*2);
      ctx.beginPath();
      ctx.moveTo(canvas.width*0.33,80);
      ctx.arc(canvas.width*0.33,80,60,start,start+slice);
      ctx.closePath();
      ctx.fillStyle = colors[i%colors.length];
      ctx.fill();
      start += slice;
    });
    // legend
    ctx.font = '12px Inter';
    let y = 12;
    entries.forEach((e,i)=>{
      ctx.fillStyle = colors[i%colors.length];
      ctx.fillRect(canvas.width*0.66, y, 10, 10);
      ctx.fillStyle = '#374151';
      ctx.fillText(`${e[0]} ${money(e[1])}`, canvas.width*0.66 + 16, y+10);
      y += 18;
    });
  }

  // ---------- Intelligent recommendation ----------
  function suggestSavings(totals){
    if (totals.incomes <= 0) return {text:'Registra tus ingresos para recomendaciones.'};
    const recentSalary = state.transactions.find(t => t.type==='income' && (t.source==='Salario' || t.source==='Banklar'));
    const ratio = totals.incomes>0 ? (totals.expenses / totals.incomes) : 0;
    if (ratio > 0.9) return {text:'Muy alto gasto. Reduce gastos inmediatos (≥10%).'};
    if (recentSalary) {
      let recommendedPercent = 20;
      if (ratio < 0.4) recommendedPercent = 30;
      else if (ratio < 0.6) recommendedPercent = 25;
      return {text: `${recommendedPercent}% de tus ingresos como ahorro (ej. guardar en Caja Nu).`};
    }
    return {text:'Considera ahorrar 15-20% de tus ingresos.'};
  }

  // ---------- Modals ----------
  function showOverlay(){ el.modalOverlay.classList.remove('hidden'); }
  function hideOverlay(){ el.modalOverlay.classList.add('hidden'); }
  function hideAllModals(){
    [el.setupModal, el.viewAllModal, el.settingsModal, el.budgetsModal].forEach(m=>m.classList.add('hidden'));
    hideOverlay();
  }

  function showSetup(){
    showOverlay();
    el.setupModal.classList.remove('hidden');
    $('user-nu').value = state.user ? state.user.nu : 0;
    $('user-nequi').value = state.user ? state.user.nequi : 0;
    $('user-nu-ea').value = state.settings.nuEA || 8.5;
  }

  function showViewAll(){
    showOverlay();
    el.viewAllModal.classList.remove('hidden');

    const container = $('all-tx-container');
    container.innerHTML = '';
    const sorted = (state.transactions||[]).slice().sort((a,b)=> new Date(b.date) - new Date(a.date));
    if (sorted.length===0){
      container.innerHTML = '<div class="meta">No hay transacciones registradas.</div>';
      return;
    }
    sorted.forEach(tx=>{
      const div = document.createElement('div');
      div.className = 'tx-row';
      div.innerHTML = `
        <div>
          <div><strong>${tx.type==='income' ? '+' : '-'} ${money(tx.amount)}</strong> <span class="meta">| ${tx.account.toUpperCase()} | ${tx.date.slice(0,10)}</span></div>
          <div class="meta">${tx.type==='income'? (tx.source||'Ingreso') : (tx.category||'Gasto')}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn-ghost" data-action="revert" data-id="${tx.id}">Eliminar</button>
        </div>
      `;
      container.appendChild(div);
    });
  }

  function showSettings(){
    showOverlay();
    el.settingsModal.classList.remove('hidden');
    $('settings-nu-ea').value = state.settings.nuEA || 8.5;
    $('settings-low-threshold').value = state.settings.lowThreshold || 20000;
  }

  function showBudgets(){
    showOverlay();
    el.budgetsModal.classList.remove('hidden');
    const list = $('budgets-form-list');
    list.innerHTML = '';
    const keys = Object.keys(state.budgets);
    if (keys.length === 0){
      const p = document.createElement('div'); p.className='meta'; p.textContent = 'Aún no hay presupuestos. Agrega uno abajo.';
      list.appendChild(p);
    }
    let i = 0;
    keys.forEach(k=>{
      const div = document.createElement('div');
      div.className = 'row';
      div.style.display = 'flex';
      div.style.gap = '8px';
      div.style.alignItems = 'center';
      div.innerHTML = `<input data-idx="${i}" name="cat-name-${i}" type="text" value="${k}" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,0.06)">
                       <input name="cat-amt-${i}" type="number" min="0" step="0.01" value="${state.budgets[k]}" style="width:120px;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,0.06)">
                       <button type="button" class="btn-ghost remove-budget" data-key="${k}">Eliminar</button>`;
      list.appendChild(div);
      i++;
    });
  }

  // ---------- Interest logic ----------
  function daysBetween(a,b){
    return Math.floor((new Date(b)-new Date(a)) / (1000*60*60*24));
  }
  function computeAccruedInterest(){
    if (!state.meta.lastInterestApplied) return 0;
    const balances = computeBalances();
    const nu = balances.nu;
    const days = daysBetween(state.meta.lastInterestApplied, nowISO());
    if (days <= 0) return 0;
    const annualRate = Number(state.settings.nuEA || 0)/100;
    const interest = nu * annualRate * (days/365);
    return interest;
  }
  function applyInterestNow(){
    const interest = computeAccruedInterest();
    if (interest <= 0) return;
    const tx = {
      id: uid(),
      type: 'income',
      amount: Number(interest.toFixed(2)),
      date: nowISO(),
      account: 'nu',
      source: 'Interés EA',
      nuAllocated: Number(interest.toFixed(2))
    };
    state.transactions.push(tx);
    state.meta.lastInterestApplied = nowISO();
    saveState(state);
    renderAll();
    alert(`Se aplicó interés: ${money(interest)} se añadió a Caja Nu.`);
  }

  // ---------- Event handlers ----------
  el.txType.addEventListener('change', e=>{
    const isIncome = e.target.value === 'income';
    el.incomeSourceRow.style.display = isIncome ? 'block' : 'none';
    el.expenseCategoryRow.style.display = isIncome ? 'none' : 'block';
    el.depositToNu.parentElement.style.display = isIncome ? 'block' : 'none';
  });

  el.depositToNu.addEventListener('change', e=>{
    el.nuSplitRow.style.display = e.target.checked ? 'block' : 'none';
  });

  el.txForm.addEventListener('submit', e=>{
    e.preventDefault();
    const type = el.txType.value;
    const amount = Number(el.txAmount.value || 0);
    if (amount <= 0) return alert('Monto debe ser mayor a 0');
    const account = el.txAccount.value;
    const date = nowISO();
    if (type === 'income'){
      const source = el.incomeSource.value;
      const depositNU = el.depositToNu.checked;
      let nuAllocated = 0;
      if (depositNU){
        const split = Number(el.nuSplitAmount.value || 0);
        if (split > 0 && split < amount) nuAllocated = split;
        else nuAllocated = amount;
      }
      const tx = {
        id: uid(),
        type: 'income',
        amount: Number(amount.toFixed(2)),
        date, account, source,
        nuAllocated: nuAllocated>0 ? Number(nuAllocated.toFixed(2)) : 0
      };
      addTransaction(tx);
    } else {
      const category = el.expenseCategory.value;
      const tx = {
        id: uid(),
        type: 'expense',
        amount: Number(amount.toFixed(2)),
        date, account, category
      };
      addTransaction(tx);
    }
    el.txForm.reset();
    el.nuSplitRow.style.display = 'none';
  });

  el.lastTxList.addEventListener('click', e=>{
    const action = e.target.dataset.action;
    const id = e.target.dataset.id;
    if (!action) return;
    if (action === 'del'){
      if (confirm('Eliminar transacción? Esto revertirá su efecto.')) removeTransactionById(id);
    } else if (action === 'view'){
      const tx = state.transactions.find(t=>t.id===id);
      if (!tx) return;
      alert(`Transacción:\nID: ${tx.id}\nTipo: ${tx.type}\nMonto: ${money(tx.amount)}\nCuenta: ${tx.account}\n${tx.type==='income' ? 'Origen: '+tx.source : 'Categoría: '+tx.category}`);
    }
  });

  el.btnViewAll.addEventListener('click', showViewAll);
  el.btnViewAll2.addEventListener('click', showViewAll);

  $('all-tx-container').addEventListener('click', e=>{
    const id = e.target.dataset.id;
    const action = e.target.dataset.action;
    if (action === 'revert'){
      if (confirm('Eliminar transacción? Esto revertirá su efecto.')) {
        removeTransactionById(id);
        showViewAll();
      }
    }
  });

  $('close-all-tx').addEventListener('click', hideAllModals);
  el.modalOverlay.addEventListener('click', hideAllModals);

  el.btnSettings.addEventListener('click', showSettings);
  $('settings-form').addEventListener('submit', e=>{
    e.preventDefault();
    const val = Number($('settings-nu-ea').value || 0);
    state.settings.nuEA = val;
    state.settings.lowThreshold = Number($('settings-low-threshold').value || 0);
    if (!state.meta.lastInterestApplied) state.meta.lastInterestApplied = nowISO();
    saveState(state);
    hideAllModals();
    renderAll();
  });

  $('btn-apply-interest').addEventListener('click', ()=>{
    if (!state.meta.lastInterestApplied) state.meta.lastInterestApplied = nowISO();
    const interest = computeAccruedInterest();
    if (interest <= 0){ alert('No hay interés acumulado aún.'); return; }
    if (confirm(`Aplicar interés acumulado ${money(interest)} ahora?`)){
      applyInterestNow();
    }
  });

  $('btn-edit-budgets').addEventListener('click', showBudgets);
  $('btn-close-budgets').addEventListener('click', hideAllModals);

  // add budget button in modal
  $('btn-add-budget').addEventListener('click', ()=>{
    const name = $('new-budget-name').value.trim();
    const amt = Number($('new-budget-amt').value || 0);
    if (!name) return alert('Ingresa nombre de categoría');
    if (amt <= 0) return alert('Ingresa monto mayor a 0');
    state.budgets[name] = amt;
    $('new-budget-name').value = '';
    $('new-budget-amt').value = '';
    showBudgets();
  });

  // delegate remove budget buttons inside modal
  $('budgets-form-list').addEventListener('click', e=>{
    if (e.target.classList.contains('remove-budget')){
      const key = e.target.dataset.key;
      if (confirm(`Eliminar presupuesto ${key}?`)){
        delete state.budgets[key];
        showBudgets();
      }
    }
  });

  // save budgets form
  $('budgets-form').addEventListener('submit', e=>{
    e.preventDefault();
    const list = $('budgets-form-list');
    const nameInputs = list.querySelectorAll('input[type="text"]');
    const amtInputs = list.querySelectorAll('input[type="number"]');
    const newBudgets = {};
    for (let i=0;i<nameInputs.length;i++){
      const name = nameInputs[i].value.trim();
      const amt = Number((amtInputs[i] && amtInputs[i].value) || 0);
      if (name && amt>0){
        newBudgets[name] = amt;
      }
    }
    state.budgets = newBudgets;
    saveState(state);
    hideAllModals();
    renderAll();
  });

  // setup form
  $('setup-form').addEventListener('submit', e=>{
    e.preventDefault();
    const name = $('user-name').value.trim();
    const nu = Number($('user-nu').value || 0);
    const nequi = Number($('user-nequi').value || 0);
    const ea = Number($('user-nu-ea').value || 8.5);
    state.user = { name, nu, nequi, createdAt: nowISO() };
    state.settings.nuEA = ea;
    if (!state.meta.lastInterestApplied) state.meta.lastInterestApplied = nowISO();
    saveState(state);
    hideAllModals();
    renderAll();
  });

  // delete all data (debug)
  window.__banklar_clear = function(){
    if (confirm('Borrar todos los datos locales?')) {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    }
  };

  // ---------- Initialization ----------
  if (!state.meta.lastInterestApplied && state.user) state.meta.lastInterestApplied = nowISO();
  renderAll();

  // Expose for debugging
  window._banklar_state = state;
  window._banklar_applyInterest = applyInterestNow;
})();
