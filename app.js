// DropControl — app.js

// ─── SUPABASE ─────────────────────────────────────────────
const SUPA_URL = 'https://hrydcrxufpajtojshgey.supabase.co';
const SUPA_KEY = 'sb_publishable_oiFnsAocEKTyrzMcrCNG0w_4XzziLmU';
const db = window.supabase.createClient(SUPA_URL, SUPA_KEY);

// Supabase Realtime — flag pour éviter de se déclencher soi-même
let isSavingLocally = false;

// Sauvegarde cloud (fire & forget — ne bloque pas l'UI)
async function dbSave(key, data) {
  isSavingLocally = true;
  try {
    const { error } = await db.from('dc_data').upsert({ key, value: data }, { onConflict: 'key' });
    if (error) console.warn('Sync cloud failed:', key, error.message);
  } catch(e) { console.warn('Sync cloud error:', e); }
  setTimeout(() => { isSavingLocally = false; }, 1000);
}

// Chargement cloud
async function dbLoadAll() {
  try {
    const { data, error } = await db.from('dc_data').select('key, value');
    if (error) throw error;
    return data || [];
  } catch(e) { console.warn('Cloud load failed:', e); return []; }
}

function initSplash() {
  const title   = document.getElementById('splash-title');
  const tag     = document.getElementById('splash-tag');
  const barWrap = document.getElementById('splash-bar-wrap');
  const bar     = document.getElementById('splash-bar');

  // État initial sans transition
  [title, tag, barWrap].forEach(el => { if(el) el.style.transition = 'none'; });
  if (title)   { title.style.opacity='0';   title.style.transform='translateY(40px)'; }
  if (tag)     { tag.style.opacity='0';     tag.style.transform='translateY(12px)'; }
  if (barWrap) { barWrap.style.opacity='0'; }

  // Force reflow Chrome/Safari
  void document.getElementById('app-loader')?.getBoundingClientRect();

  // Anime le titre
  if (title) {
    title.style.transition = 'opacity 0.7s cubic-bezier(0.2,0.9,0.3,1), transform 0.7s cubic-bezier(0.2,0.9,0.3,1)';
    title.style.opacity = '1';
    title.style.transform = 'none';
  }
  // Tagline avec délai
  setTimeout(() => {
    if (tag) {
      tag.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      tag.style.opacity = '1';
      tag.style.transform = 'none';
    }
  }, 350);
  // Barre de progression
  setTimeout(() => {
    if (barWrap) {
      barWrap.style.transition = 'opacity 0.4s ease';
      barWrap.style.opacity = '1';
    }
    if (bar) bar.style.width = '85%';
  }, 600);
}

function hideLoader(quick=false) {
  const l = document.getElementById('app-loader');
  const bar = document.getElementById('splash-bar');
  if (!l) return;
  if (bar) { bar.style.transition='width 0.4s ease'; bar.style.width='100%'; }
  const delay = quick ? 150 : 900;
  setTimeout(() => {
    l.style.opacity = '0';
    l.style.transform = 'scale(1.04)';
    setTimeout(() => { l.style.display = 'none'; }, 650);
  }, delay);
}

// ─── GEMINI REQUEST — retry automatique sur 429 ───────────
async function geminiRequest(prompt, maxTokens = 800) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = JSON.stringify({
    contents:[{parts:[{text:prompt}]}],
    generationConfig:{temperature:0, maxOutputTokens:maxTokens}
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body });
    if (res.status === 429) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
      throw new Error('Quota dépassé — réessaie dans quelques secondes');
    }
    if (!res.ok) throw new Error(`Erreur API: ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Réponse vide');
    return text;
  }
}

// ─── SUPABASE REALTIME ────────────────────────────────────
function initRealtime() {
  db.channel('dc-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dc_data' },
      async (payload) => {
        // Ignore si c'est ce device qui a fait le changement
        if (isSavingLocally) return;
        const key = payload.new?.key;
        const val = payload.new?.value;
        if (!key) return;
        // Mise à jour ciblée selon la clé modifiée
        if (key === 'dc_stocks')   { stocks   = Array.isArray(val) ? val : []; renderStock(); populateOrderSelect(); updateSidebarBadge(); }
        if (key === 'dc_products') { products = Array.isArray(val) ? val : []; renderProducts(); }
        if (key === 'dc_orders')   { orders   = Array.isArray(val) ? val : []; renderOrders(); buildMonthSelector(); }
        if (key === 'dropControlConfig') { currentConfig = { ...currentConfig, ...(val || {}) }; }
        updateDashboardMetrics();
        // Indicateur discret de sync (pas de toast pour éviter le spam)
        const dot=document.getElementById('sync-dot');
        if(dot){dot.style.background='#34d399';setTimeout(()=>dot.style.background='',2000);}
      }
    )
    .subscribe();
}

// ─── CUSTOM SELECT ────────────────────────────────────────
function initAllCustomSelects() {
  document.querySelectorAll('select').forEach(s => initCustomSelect(s));
}

function initCustomSelect(sel) {
  if (!sel || sel.dataset.cs) return;
  sel.dataset.cs = '1';
  const naturalWidth = sel.offsetWidth;
  const isAutoWidth = sel.classList.contains('w-auto') || (naturalWidth > 0 && naturalWidth < 280);
  const wrap = document.createElement('div');
  wrap.className = 'cs-wrapper';
  if (isAutoWidth) { wrap.style.display='inline-block'; wrap.style.minWidth=naturalWidth?`${naturalWidth}px`:'140px'; }
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.style.display = 'none';
  const trigger = document.createElement('div');
  trigger.className = `cs-trigger ${[...sel.classList].join(' ')}`;
  const st = sel.getAttribute('style');
  if (st) trigger.setAttribute('style', st.replace(/display[^;]*;?/g,''));
  const dropdown = document.createElement('div');
  dropdown.className = 'cs-dropdown';
  const arrow = `<svg class="cs-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>`;
  function syncTrigger() {
    const o = sel.options[sel.selectedIndex];
    trigger.innerHTML = `<span class="cs-value">${o ? o.text : '—'}</span>${arrow}`;
  }
  function buildDropdown() {
    dropdown.innerHTML = '';
    [...sel.options].forEach(o => {
      const div = document.createElement('div');
      div.className = 'cs-option' + (o.value === sel.value ? ' cs-selected' : '');
      div.textContent = o.text;
      div.addEventListener('click', e => {
        e.stopPropagation();
        sel.value = o.value;
        sel.dispatchEvent(new Event('change', {bubbles:true}));
        syncTrigger();
        dropdown.classList.remove('open');
        trigger.classList.remove('open');
      });
      dropdown.appendChild(div);
    });
  }
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.cs-dropdown.open').forEach(d => { d.classList.remove('open'); d.parentNode?.querySelector('.cs-trigger')?.classList.remove('open'); });
    if (!isOpen) { buildDropdown(); dropdown.classList.add('open'); trigger.classList.add('open'); }
  });
  document.addEventListener('click', () => { dropdown.classList.remove('open'); trigger.classList.remove('open'); });
  new MutationObserver(syncTrigger).observe(sel, {childList:true, subtree:true});
  syncTrigger();
  wrap.insertBefore(trigger, sel);
  wrap.appendChild(dropdown);
}
function initNumStepper(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.stepper) return;
  input.dataset.stepper = '1';
  const step = parseFloat(input.step) || 1;
  const min  = input.min !== '' ? parseFloat(input.min) : -Infinity;
  const wrap = document.createElement('div');
  wrap.className = 'num-stepper';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const mkBtn = (label, cls, action) => {
    const b = document.createElement('button');
    b.type='button'; b.className=`step-btn ${cls}`; b.textContent=label;
    b.addEventListener('click', () => {
      const cur = parseFloat(input.value)||0;
      const nv = Math.max(min, action(cur, step));
      input.value = step < 1 ? nv.toFixed(2) : String(Math.round(nv));
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    return b;
  };
  wrap.insertBefore(mkBtn('−','step-btn-minus',(v,s)=>v-s), input);
  wrap.appendChild(mkBtn('+','step-btn-plus',(v,s)=>v+s));
}

function initAllSteppers() {
  ['order-qty','inp-qty','stock-qty'].forEach(initNumStepper);
}
function generateRapportMensuel() {
  const filtered = getFilteredOrders();
  const stats = computeStats(filtered);
  const period = activeMonthFilter === 'all' ? 'Toutes périodes' : (() => {
    const [y,m] = activeMonthFilter.split('-');
    return new Date(+y, +m-1, 1).toLocaleDateString('fr-FR', {month:'long', year:'numeric'});
  })();
  const topProd = {};
  filtered.forEach(o => {
    if (!topProd[o.productName]) topProd[o.productName] = {qty:0, rev:0};
    topProd[o.productName].qty += o.qty||1;
    topProd[o.productName].rev += o.totalReceived;
  });
  const top3 = Object.entries(topProd).sort((a,b)=>b[1].rev-a[1].rev).slice(0,3);
  const goalPct = stats.monthlyGoal > 0 ? (stats.netProfit/currentConfig.monthlyGoal*100).toFixed(1) : null;
  const tr = (parseFloat(currentConfig.initialCapital)||0)
    + orders.reduce((a,o)=>a+o.totalReceived,0)
    - stocks.reduce((a,s)=>a+s.totalCost,0)
    - orders.reduce((a,o)=>a+(o.feeFixedAtTime??currentConfig.feeFixed)+(o.totalReceived*((o.feePctAtTime??currentConfig.feePercent)/100)),0);

  const lines = [
    { label:'Période', value: period, icon:'calendar' },
    { label:'Profit Net', value: `€${stats.netProfit.toFixed(2)}`, color: stats.netProfit >= 0 ? '#34d399' : '#f87171', icon:'trending-up' },
    { label:'Chiffre d\'Affaires', value: `€${stats.revenue.toFixed(2)}`, icon:'bar-chart-2' },
    { label:'Commandes', value: `${stats.orderCount}`, icon:'shopping-bag' },
    { label:'Panier Moyen', value: `€${stats.avgBasket.toFixed(2)}`, icon:'credit-card' },
    { label:'Taux de Marge', value: `${stats.marginRate.toFixed(1)}%`, icon:'percent' },
    { label:'Trésorerie', value: `€${tr.toFixed(2)}`, icon:'landmark' },
    currentConfig.monthlyGoal > 0 ? { label:'Objectif', value: `€${currentConfig.monthlyGoal} — ${goalPct}% atteint ${parseFloat(goalPct)>=100?'✓':'⏳'}`, icon:'target' } : null,
  ].filter(Boolean);

  const el = document.getElementById('rapport-content');
  el.innerHTML = [
    ...lines.map(l => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06)"><span style="color:rgba(255,255,255,0.6);font-size:12px;display:flex;align-items:center;gap:6px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:0.5">${getLucidePath(l.icon)}</svg>${l.label}</span><span style="font-weight:700;color:${l.color||'white'};font-size:13px">${l.value}</span></div>`),
    top3.length ? `<div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06)"><p style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;display:flex;align-items:center;gap:5px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2">${getLucidePath('trophy')}</svg> Top Produits</p>${top3.map((([n,d],i)=>`<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:rgba(255,255,255,0.7);font-size:12px">${['①','②','③'][i]} ${n}</span><span style="color:#34d399;font-weight:600;font-size:12px">${fmtEur(d.rev)}</span></div>`)).join('')}</div>` : ''
  ].join('');

  document.getElementById('rapport-period').textContent = period;
  showModal(document.getElementById('rapport-modal'));
  if (window.lucide) lucide.createIcons();

  document.getElementById('btn-rapport-copy').onclick = () => {
    const text = `RAPPORT DROPCONTROL — ${period}\n\n` +
      lines.map(l => `${l.label}: ${l.value}`).join('\n') +
      (top3.length ? `\n\nTOP PRODUITS\n${top3.map(([n,d],i)=>`${i+1}. ${n}: ${fmtEur(d.rev)}`).join('\n')}` : '');
    navigator.clipboard.writeText(text).then(() => showToast('Rapport copié !', 'success'));
  };
}

document.getElementById('btn-rapport-close')?.addEventListener('click', () => hideModal(document.getElementById('rapport-modal')));
document.getElementById('btn-rapport-close2')?.addEventListener('click', () => hideModal(document.getElementById('rapport-modal')));
const DAI_PHRASES = ['Quoi de neuf ?','On fait le point ?','Pose-moi ta question','Je t\'écoute','Qu\'est-ce qu\'on regarde ensemble ?','Dis-moi ce que tu veux savoir','Par où on commence ?'];
let _daiPhraseIdx = 0, _daiPhraseTimer = null;

function startPhraseRotation() {
  const el = document.getElementById('dai-phrase');
  if (!el) return;
  _daiPhraseTimer = setInterval(() => {
    el.style.animation = 'phrase-out 0.35s ease forwards';
    setTimeout(() => {
      _daiPhraseIdx = (_daiPhraseIdx + 1) % DAI_PHRASES.length;
      el.textContent = DAI_PHRASES[_daiPhraseIdx];
      el.style.animation = 'phrase-in 0.45s cubic-bezier(0.2,0.9,0.3,1) forwards';
    }, 350);
  }, 3500);
}

function stopPhraseRotation() {
  if (_daiPhraseTimer) { clearInterval(_daiPhraseTimer); _daiPhraseTimer = null; }
}

function openDropAI() {
  const overlay = document.getElementById('dropai-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.classList.add('modal-open');
  // Phrase aléatoire à chaque ouverture avec effet shine
  const el = document.getElementById('dai-phrase');
  if (el) {
    const idx = Math.floor(Math.random() * DAI_PHRASES.length);
    _daiPhraseIdx = idx;
    el.textContent = DAI_PHRASES[idx];
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'phrase-shine 1.4s cubic-bezier(0.2,0.9,0.3,1) both';
  }
  setTimeout(() => document.getElementById('dai-input')?.focus(), 400);
  if (window.lucide) lucide.createIcons();
}

function closeDropAI() {
  stopPhraseRotation();
  const overlay = document.getElementById('dropai-overlay');
  const drawer = document.getElementById('dropai-drawer');
  if (!drawer) return;
  drawer.style.animation = 'dropai-out 0.3s cubic-bezier(0.4,0,1,1) both';
  setTimeout(() => {
    overlay.classList.remove('open');
    drawer.style.animation = '';
    document.body.classList.remove('modal-open');
  }, 280);
}

function buildDropAIContext() {
  const stats = computeStats(orders);
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthOrders = orders.filter(o => o.date?.startsWith(monthKey));
  const monthStats = computeStats(monthOrders);
  const prevMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const prevKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth()+1).padStart(2,'0')}`;
  const prevOrders = orders.filter(o => o.date?.startsWith(prevKey));
  const prevStats = computeStats(prevOrders);

  // Trésorerie
  const tr = (parseFloat(currentConfig.initialCapital)||0)
    + orders.reduce((a,o)=>a+o.totalReceived,0)
    - stocks.reduce((a,s)=>a+s.totalCost,0)
    - orders.reduce((a,o)=>a+(o.feeFixedAtTime??currentConfig.feeFixed)+(o.totalReceived*((o.feePctAtTime??currentConfig.feePercent)/100)),0);

  // Top produits
  const prodMap = {};
  orders.forEach(o => {
    if (!prodMap[o.productName]) prodMap[o.productName] = {ventes:0, ca:0};
    prodMap[o.productName].ventes += o.qty||1;
    prodMap[o.productName].ca += o.totalReceived;
  });
  const topProd = Object.entries(prodMap).sort((a,b)=>b[1].ca-a[1].ca).slice(0,5);

  return {
    date_analyse: new Date().toLocaleDateString('fr-FR'),
    resume_global: {
      total_commandes: orders.length,
      ca_total: `€${stats.revenue.toFixed(2)}`,
      profit_net: `€${stats.netProfit.toFixed(2)}`,
      taux_marge: `${stats.marginRate.toFixed(1)}%`,
      panier_moyen: `€${stats.avgBasket.toFixed(2)}`,
      tresorerie: `€${tr.toFixed(2)}`
    },
    mois_en_cours: {
      mois: monthKey,
      commandes: monthOrders.length,
      ca: `€${monthStats.revenue.toFixed(2)}`,
      profit: `€${monthStats.netProfit.toFixed(2)}`,
      marge: `${monthStats.marginRate.toFixed(1)}%`,
      objectif: `€${currentConfig.monthlyGoal}`,
      progression: `${currentConfig.monthlyGoal>0?((monthStats.netProfit/currentConfig.monthlyGoal)*100).toFixed(1):0}%`
    },
    mois_precedent: {
      commandes: prevOrders.length,
      ca: `€${prevStats.revenue.toFixed(2)}`,
      profit: `€${prevStats.netProfit.toFixed(2)}`
    },
    stocks: stocks.map(s => ({
      nom: s.name,
      en_stock: s.currentQty,
      initial: s.originalQty ?? s.initialQty,
      alerte_rupture: s.currentQty <= currentConfig.stockAlert,
      cout_unitaire: `€${(s.unitCost||0).toFixed(2)}`,
      investissement: `€${(s.totalCost||0).toFixed(2)}`
    })),
    top_articles: topProd.map(([nom,d])=>({nom, ventes:d.ventes, ca:`€${d.ca.toFixed(2)}`})),
    dernieres_commandes: [...orders].reverse().slice(0,8).map(o=>({
      client: o.customer, article: o.productName,
      montant: `€${o.totalReceived.toFixed(2)}`,
      statut: o.status, date: o.date?.slice(0,10)
    })),
    catalogue_produits: products.map(p=>({
      nom: p.name,
      cout: `€${(p.cost||0).toFixed(2)}`,
      prix_vente: `€${(p.selling||0).toFixed(2)}`,
      marge: `${((p.selling-(p.cost+p.shipping+p.gatewayFees))/p.selling*100).toFixed(1)}%`
    })),
    config: {
      plateforme: 'Revente en ligne',
      frais_emballage: `€${currentConfig.feeFixed}`,
      frais_variables: `${currentConfig.feePercent}%`,
      objectif_mensuel: `€${currentConfig.monthlyGoal}`,
      seuil_alerte_stock: currentConfig.stockAlert
    }
  };
}

function formatDropAIResponse(text) {
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/^#{1,3}\s+(.+)$/gm, '<div class="dai-section-title">$1</div>');
  text = text.replace(/^[-•]\s+(.+)$/gm, '<div class="dai-bullet">$1</div>');
  text = text.replace(/(€[\d,\.]+)/g, '<span class="dai-number">$1</span>');
  text = text.replace(/(\d+[\.,]\d+%)/g, '<span class="dai-number">$1</span>');
  const paras = text.split(/\n\n+/);
  return paras.map(p => `<p style="margin:0 0 8px">${p.replace(/\n/g,'<br>')}</p>`).join('');
}

function addUserMessage(text) {
  stopPhraseRotation();
  document.getElementById('dai-empty')?.remove();
  const msgs = document.getElementById('dai-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'dai-msg-user';
  div.innerHTML = `<div class="dai-msg-user-bubble">${text}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function clearDropAIChat() {
  stopPhraseRotation();
  const msgs = document.getElementById('dai-messages');
  if (!msgs) return;
  const idx = Math.floor(Math.random() * DAI_PHRASES.length);
  _daiPhraseIdx = idx;
  msgs.innerHTML = `<div class="dai-empty" id="dai-empty">
    <div class="dai-phrase-wrap">
      <span id="dai-phrase">${DAI_PHRASES[idx]}</span>
      <p class="dai-powered">Drop AI · Powered by Gemini</p>
    </div>
  </div>`;
  document.getElementById('dai-presets')?.classList.remove('hidden');
}

function addTypingIndicator() {
  const msgs = document.getElementById('dai-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'dai-typing'; div.id = 'dai-typing';
  div.innerHTML = `<div class="dai-typing-avatar"><i data-lucide="sparkles" class="dai-sparkle-sm"></i></div><div class="dai-typing-dots"><div class="dai-dot"></div><div class="dai-dot"></div><div class="dai-dot"></div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  if (window.lucide) lucide.createIcons();
}

function removeTypingIndicator() {
  document.getElementById('dai-typing')?.remove();
}

function addAIMessage(html) {
  const msgs = document.getElementById('dai-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'dai-msg-ai';
  div.innerHTML = `<div class="dai-msg-ai-avatar"><i data-lucide="sparkles" class="dai-sparkle-sm"></i></div><div class="dai-msg-ai-bubble" style="animation:typewriter-reveal 0.5s ease both">${html}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  if (window.lucide) lucide.createIcons();
}

async function sendDropAI(question) {
  if (!GEMINI_KEY) { showToast('Clé Gemini non configurée','error'); return; }
  if (!question.trim()) return;

  // Hide presets after first use
  document.getElementById('dai-presets')?.classList.add('hidden');

  // UI
  addUserMessage(question);
  addTypingIndicator();
  document.getElementById('dai-send-btn').disabled = true;
  document.getElementById('dai-input').value = '';

  const context = buildDropAIContext();
  const prompt = `Tu es Drop AI, l'assistant IA de DropControl — l'app de gestion dropshipping de l'utilisateur.

DONNÉES BUSINESS EN TEMPS RÉEL :
${JSON.stringify(context, null, 2)}

INSTRUCTIONS :
- Réponds en français, de manière directe et actionnable
- Utilise les vraies données pour étayer tes réponses avec des chiffres précis
- Sois honnête : si les données sont insuffisantes ou si tu n'es pas sûr, dis-le
- Structure ta réponse avec des sections claires si nécessaire (max 4-5 points)
- Commence par l'essentiel, sans intro générique
- Utilise **gras** pour les chiffres clés et points importants
- Longueur : concis mais complet (5-10 lignes max)

QUESTION : ${question}`;

  try {
    const text = await geminiRequest(prompt, 2048);
    removeTypingIndicator();
    addAIMessage(formatDropAIResponse(text));
  } catch(e) {
    removeTypingIndicator();
    addAIMessage(`<span style="color:#f87171">⚠ ${e.message}</span>`);
  } finally {
    document.getElementById('dai-send-btn').disabled = false;
    document.getElementById('dai-input')?.focus();
  }
}

function sendDropAIFromInput() {
  const input = document.getElementById('dai-input');
  const q = input?.value.trim();
  if (q) sendDropAI(q);
}
function resetMarketInline() {
  document.getElementById('market-loading')?.classList.add('hidden');
  document.getElementById('market-results-fullwidth')?.classList.add('hidden');
  document.getElementById('market-error')?.classList.add('hidden');
  // Réaffiche le formulaire
  const form = document.getElementById('market-estimator-form');
  if (form) { form.style.display=''; }
  if (window._marketStageInterval) clearInterval(window._marketStageInterval);
}

async function analyzeMarketInline() {
  if (!GEMINI_KEY) { showToast('Clé Gemini non configurée','error'); return; }
  const name    = document.getElementById('inp-product-name')?.value.trim();
  const cost    = parseFloat(document.getElementById('inp-cost')?.value?.replace(',','.'));
  const selling = parseFloat(document.getElementById('inp-selling')?.value?.replace(',','.')) || 0;
  const etat    = document.getElementById('market-etat')?.value || 'Neuf';
  const cat     = document.getElementById('market-cat')?.value || 'Bijoux / Accessoires';
  const det     = document.getElementById('market-details')?.value.trim() || '';

  // Validation obligatoire
  if (!name) { showToast('Entrez d\'abord le nom du produit 👆','warn'); document.getElementById('inp-product-name')?.focus(); return; }
  if (!cost || cost <= 0) { showToast('Entrez d\'abord le prix d\'achat 👆','warn'); document.getElementById('inp-cost')?.focus(); return; }

  resetMarketInline();
  document.getElementById('market-loading')?.classList.remove('hidden');

  // Progress animation
  const prog = document.getElementById('market-progress');
  if (prog) { prog.style.animation='none'; void prog.offsetWidth; prog.style.animation='ai-progress 6s cubic-bezier(0.1,0.4,0.2,1) forwards'; }

  // Messages cycliques
  const stages = ['Analyse du marché…','Étude de la concurrence…','Calcul des marges…','Recommandation…'];
  let sIdx = 0;
  const stEl = document.getElementById('market-stage-text');
  window._marketStageInterval = setInterval(() => {
    sIdx = (sIdx+1) % stages.length;
    if (stEl) { stEl.style.opacity='0'; setTimeout(()=>{ stEl.textContent=stages[sIdx]; stEl.style.opacity='1'; },200); }
  }, 1400);

  const prompt = `Tu es un expert en revente de seconde main en France en 2026. Tu connais parfaitement les prix pratiqués sur Vinted, Leboncoin, eBay France et Depop.

ARTICLE À ANALYSER :
- Nom : ${name}
- Coût d'achat réel : €${cost.toFixed(2)}
- Catégorie : ${cat}
- État : ${etat}
${selling > 0 ? `- Prix de vente testé : €${selling.toFixed(2)}` : '- Prix de vente : non défini, suggère le prix optimal'}
${det ? `- Détails : ${det}` : ''}

INSTRUCTIONS :
1. Analyse le marché de revente français pour cet article spécifique
2. Les prix doivent être RÉALISTES et basés sur ce qui se vend vraiment
3. Les marges sont calculées sur : (prix_vente - coût_achat) / prix_vente × 100
4. Si tu manques d'info sur cet article précis, base-toi sur des articles similaires et dis-le dans l'explication
5. Sois honnête — si l'article est difficile à revendre ou si la marge est faible, dis-le clairement
6. Prix minimum = point d'entrée pour vendre vite, Prix optimal = meilleur équilibre marge/vitesse, Prix maximum = si patient et article rare

Réponds EXCLUSIVEMENT avec ce JSON, sans backticks, sans texte avant ou après :
{"prix_min":0.00,"prix_optimal":0.00,"prix_max":0.00,"marge_min":"0%","marge_optimal":"0%","marge_max":"0%","explication":"Analyse honnête en 2-3 phrases avec les chiffres clés","conseils":["Conseil concret 1","Conseil concret 2","Conseil concret 3"]}`;

  try {
    const raw = await geminiRequest(prompt, 4096);
    // Nettoie les backticks que Gemini ajoute malgré les instructions
    const text = raw.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse non structurée — réessaie');
    const result = JSON.parse(jsonMatch[0]);


    clearInterval(window._marketStageInterval);
    document.getElementById('market-loading')?.classList.add('hidden');
    const form = document.getElementById('market-estimator-form');
    if (form) form.style.display = 'none';
    showMarketResultsInline(result);
    setTimeout(()=>document.getElementById('market-results-fullwidth')?.scrollIntoView({behavior:'smooth',block:'nearest'}),100);

  } catch(e) {
    clearInterval(window._marketStageInterval);
    document.getElementById('market-loading')?.classList.add('hidden');
    document.getElementById('market-error')?.classList.remove('hidden');
    const errEl = document.getElementById('market-error-msg');
    if (errEl) errEl.textContent = e.message || 'Erreur lors de l\'analyse';
  }
}

function showMarketResultsInline(r) {
  // Affiche la section pleine largeur
  const section = document.getElementById('market-results-fullwidth');
  if (!section) return;
  section.classList.remove('hidden');
  section.style.animation = 'none'; void section.offsetWidth; section.style.animation = '';

  // Sous-titre avec le nom de l'article analysé
  const sub = document.getElementById('market-result-subtitle');
  const name = document.getElementById('inp-product-name')?.value.trim();
  if (sub && name) sub.textContent = `${name} · Leboncoin · eBay FR · Vinted`;

  // Reconstitue les icônes Lucide
  if (window.lucide) lucide.createIcons();

  const tiers = [
    { label:'Prix minimum', price:r.prix_min, marge:r.marge_min, color:'#fbbf24', border:'rgba(251,191,36,0.25)', bg:'rgba(251,191,36,0.07)', icon:'📉', sub:'Point de départ' },
    { label:'Prix optimal ⭐', price:r.prix_optimal, marge:r.marge_optimal, color:'#34d399', border:'rgba(52,211,153,0.35)', bg:'rgba(52,211,153,0.09)', icon:'🎯', sub:'Recommandé' },
    { label:'Prix maximum', price:r.prix_max, marge:r.marge_max, color:'#a78bfa', border:'rgba(167,139,250,0.25)', bg:'rgba(167,139,250,0.07)', icon:'📈', sub:'Premium' },
  ];

  // 3 cartes prix avec animation staggered
  const cards = document.getElementById('market-price-cards');
  if (cards) cards.innerHTML = tiers.map((t,i)=>`
    <div class="market-price-card" style="background:${t.bg};border:1px solid ${t.border};animation-delay:${i*130}ms;box-shadow:0 4px 24px ${t.bg}">
      <div style="font-size:24px;margin-bottom:10px">${t.icon}</div>
      <div style="font-size:30px;font-weight:800;color:${t.color};letter-spacing:-0.02em;text-shadow:0 0 20px ${t.color}44">€${t.price?.toFixed(2)??'—'}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:6px;font-weight:500">${t.label}</div>
      <div style="width:40px;height:2px;background:${t.border};border-radius:2px;margin:10px auto;"></div>
      <div style="font-size:20px;font-weight:800;color:${t.color}">${t.marge??''}</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:3px;text-transform:uppercase;letter-spacing:0.06em">${t.sub}</div>
    </div>`).join('');

  // Analyse + Conseils côte à côte
  const grid = document.getElementById('market-analysis-grid');
  if (grid) grid.innerHTML = `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px;animation:price-counter 0.35s 400ms both">
      <p style="font-size:11px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">📊 Analyse</p>
      <p style="font-size:13px;color:rgba(255,255,255,0.75);line-height:1.6">${r.explication??''}</p>
    </div>
    ${r.conseils?.length ? `<div style="background:rgba(139,92,246,0.05);border:1px solid rgba(139,92,246,0.15);border-radius:12px;padding:16px;animation:price-counter 0.35s 500ms both">
      <p style="font-size:11px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">💡 Conseils</p>
      ${r.conseils.slice(0,3).map(tip=>`<div style="display:flex;gap:8px;margin-bottom:8px;font-size:12px;color:rgba(255,255,255,0.65);line-height:1.5"><span style="color:#a78bfa;flex-shrink:0;margin-top:1px">→</span>${tip}</div>`).join('')}
    </div>` : ''}`;
}
let GEMINI_KEY = null;
let GEMINI_MODEL = 'gemini-2.5-flash-lite'; // chargée depuis Supabase au démarrage
let importedItems = [];

async function loadGeminiKey() {
  try {
    const { data, error } = await db.from('dc_data').select('key,value').in('key',['gemini_key','gemini_model']);
    if (!error && data) {
      const keyRow   = data.find(r => r.key === 'gemini_key');
      const modelRow = data.find(r => r.key === 'gemini_model');
      if (keyRow?.value)   GEMINI_KEY   = typeof keyRow.value === 'string' ? keyRow.value : JSON.parse(keyRow.value);
      if (modelRow?.value) GEMINI_MODEL = typeof modelRow.value === 'string' ? modelRow.value : JSON.parse(modelRow.value);
    }
  } catch(e) { console.warn('Gemini key/model load failed', e); }
}

function closeAIModal() {
  const modal = document.getElementById('import-invoice-modal');
  const card  = modal?.querySelector('.ai-modal-card');
  if (!modal) return;
  // Animation de fermeture
  if (card) { card.style.animation = 'ai-modal-out 0.3s cubic-bezier(0.4,0,1,1) both'; }
  modal.style.animation = 'ai-backdrop-out 0.3s ease both';
  setTimeout(() => {
    hideModal(modal);
    modal.style.animation = '';
    if (card) card.style.animation = '';
  }, 280);
}

function resetImportModal() {
  document.getElementById('import-upload-zone').style.display = '';
  document.getElementById('import-loading').classList.add('hidden');
  document.getElementById('import-results').classList.add('hidden');
  document.getElementById('import-error').classList.add('hidden');
  document.getElementById('import-file-input').value = '';
  importedItems = [];
}

async function analyzeInvoice(file) {
  if (!GEMINI_KEY) {
    document.getElementById('import-error').classList.remove('hidden');
    document.getElementById('import-upload-zone').style.display = 'none';
    document.getElementById('import-error-msg').textContent = 'Clé Gemini non configurée';
    return;
  }
  document.getElementById('import-upload-zone').style.display = 'none';
  document.getElementById('import-loading').classList.remove('hidden');

  // Réinitialise la barre de progression
  const fill = document.getElementById('ai-progress-fill');
  if (fill) { fill.style.animation = 'none'; void fill.offsetWidth; fill.style.animation = 'ai-progress 8s cubic-bezier(0.1,0.4,0.2,1) forwards'; }

  // Messages cycliques pendant l'analyse
  const stages = ['Lecture de la facture…','Identification des articles…','Extraction des quantités…','Calcul des prix réels…','Application des réductions…','Finalisation…'];
  let sIdx = 0;
  const stEl = document.getElementById('ai-stage-text');
  const stInterval = setInterval(() => {
    sIdx = (sIdx + 1) % stages.length;
    if (stEl) { stEl.style.opacity='0'; stEl.style.transform='translateY(4px)'; setTimeout(()=>{ stEl.textContent=stages[sIdx]; stEl.style.opacity='1'; stEl.style.transform='none'; }, 200); }
  }, 1400);
  window._aiStageInterval = stInterval;

  try {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

    const mimeType = file.type || 'image/jpeg';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: `Analyse cette facture d'achat. Pour chaque article extrait: le nom court et clair, la quantité achetée, et le prix total RÉELLEMENT PAYÉ après toutes les réductions appliquées à cet article. Si des réductions sont mentionnées pour des articles spécifiques, soustrait-les du prix original de l'article concerné. Le total de tous les prixTotal doit correspondre au total final de la commande (après réductions, avant ou après livraison). Réponds UNIQUEMENT en JSON valide sans backticks ni texte autour, exactement dans ce format: {"articles": [{"nom": "Bague Acier Noir", "quantite": 10, "prixTotal": 4.86}]}` }
            ]
          }],
          generationConfig: { temperature: 0.1 }
        })
      }
    );

    if (!response.ok) throw new Error(`Erreur API Gemini: ${response.status}`);
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Réponse vide de Gemini');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.articles || !Array.isArray(parsed.articles)) throw new Error('Format de réponse invalide');
    if (window._aiStageInterval) clearInterval(window._aiStageInterval);
    importedItems = parsed.articles;
    showImportResults();

  } catch(e) {
    if (window._aiStageInterval) clearInterval(window._aiStageInterval);
    console.error('Import error:', e);
    document.getElementById('import-loading').classList.add('hidden');
    document.getElementById('import-error').classList.remove('hidden');
    document.getElementById('import-error-msg').textContent = e.message || 'Erreur lors de l\'analyse';
  }
}

function showImportResults() {
  document.getElementById('import-loading').classList.add('hidden');
  document.getElementById('import-results').classList.remove('hidden');
  const list = document.getElementById('import-items-list');
  list.innerHTML = '';
  importedItems.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'ai-item';
    div.style.animationDelay = `${i * 80}ms`;
    div.innerHTML = `
      <div style="flex:1;min-width:0">
        <input type="text" value="${item.nom}" data-idx="${i}" data-field="nom" placeholder="Nom de l'article">
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div style="text-align:center">
          <input type="number" value="${item.quantite}" data-idx="${i}" data-field="quantite" min="1" style="text-align:center">
          <div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:2px">unités</div>
        </div>
        <div style="text-align:center">
          <input type="number" value="${item.prixTotal}" data-idx="${i}" data-field="prixTotal" step="0.01" min="0" class="ai-price-input" style="text-align:center">
          <div style="font-size:9px;color:rgba(52,211,153,0.6);margin-top:2px">€ total</div>
        </div>
      </div>`;
    list.appendChild(div);
    div.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.idx);
        const field = inp.dataset.field;
        importedItems[idx][field] = field === 'nom' ? inp.value : parseFloat(inp.value) || 0;
      });
    });
  });
  if (window.lucide) lucide.createIcons();
}

function confirmImport() {
  let added = 0;
  importedItems.forEach(item => {
    if (!item.nom || !item.quantite || item.quantite < 1 || item.prixTotal <= 0) return;
    stocks.push({
      id: generateId('st'),
      name: item.nom,
      totalCost: item.prixTotal,
      originalQty: item.quantite,
      initialQty: item.quantite,
      currentQty: item.quantite,
      unitCost: item.prixTotal / item.quantite
    });
    added++;
  });
  if (added === 0) { showToast('Aucun article valide à importer', 'warn'); return; }
  saveStocks();
  renderStock();
  populateOrderSelect();
  updateSidebarBadge();
  updateDashboardMetrics();
  closeAIModal();
  showToast(`${added} article${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} au stock ✅`, 'success');
}
async function initLockScreen(onUnlock) {
  const screen  = document.getElementById('lock-screen');
  const email   = document.getElementById('lock-email');
  const pwd     = document.getElementById('lock-input');
  const errorEl = document.getElementById('lock-error');
  const submit  = document.getElementById('lock-submit');
  const card    = screen.querySelector('.lock-card');

  // Déjà connecté ? on démarre directement
  const { data:{ session } } = await db.auth.getSession();
  if (session) { onUnlock(); return; }

  screen.style.display = 'flex';

  function fail(msg) {
    errorEl.textContent = msg;
    card.classList.remove('lock-shake'); void card.offsetWidth; card.classList.add('lock-shake');
    submit.textContent = 'Se connecter'; submit.disabled = false;
  }

  async function attempt() {
    const e = email.value.trim(), p = pwd.value;
    if (!e || !p) return fail('Email et mot de passe requis');
    submit.textContent = 'Connexion…'; submit.disabled = true;
    const { error } = await db.auth.signInWithPassword({ email: e, password: p });
    if (error) return fail('Email ou mot de passe incorrect');
    // Transition fluide lock → dashboard
    card.style.transition = 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.4,0,0.2,1), filter 0.5s ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95) translateY(-10px)';
    card.style.filter = 'blur(4px)';
    setTimeout(() => {
      screen.style.transition = 'opacity 0.4s ease';
      screen.style.opacity = '0';
      setTimeout(() => {
        screen.style.display = 'none';
        screen.style.opacity = '';
        onUnlock();
      }, 400);
    }, 250);
  }

  submit.addEventListener('click', attempt);
  pwd.addEventListener('keydown',   e => { if (e.key === 'Enter') attempt(); });
  email.addEventListener('keydown', e => { if (e.key === 'Enter') pwd.focus(); });
  setTimeout(() => email.focus(), 100);
}

// ─── DATA ─────────────────────────────────────────────────
let stocks=[],products=[],orders=[];
let currentConfig={feeFixed:0,feePercent:2.0,stockAlert:3,monthlyGoal:1000,initialCapital:0};

// Initialisation async — Supabase = source de vérité, localStorage = cache local
async function initStorage() {
  const rows = await dbLoadAll();

  if (rows.length > 0) {
    // ── Données cloud trouvées → on les utilise ──
    rows.forEach(r => {
      if (r.key === 'dc_stocks')        stocks        = Array.isArray(r.value) ? r.value : [];
      if (r.key === 'dc_products')      products      = Array.isArray(r.value) ? r.value : [];
      if (r.key === 'dc_orders')        orders        = Array.isArray(r.value) ? r.value : [];
      if (r.key === 'dropControlConfig') currentConfig = { ...currentConfig, ...(r.value || {}) };
    });
  } else {
    // ── Aucune donnée cloud → migration depuis localStorage si dispo ──
    try {
      const s=localStorage.getItem('dc_stocks'),p=localStorage.getItem('dc_products'),
            o=localStorage.getItem('dc_orders'),c=localStorage.getItem('dropControlConfig');
      if(s) stocks=JSON.parse(s);
      if(p) products=JSON.parse(p);
      if(o) orders=JSON.parse(o);
      if(c) currentConfig={...currentConfig,...JSON.parse(c)};
      // Pousse tout vers le cloud
      await dbSave('dc_stocks', stocks);
      await dbSave('dc_products', products);
      await dbSave('dc_orders', orders);
      await dbSave('dropControlConfig', currentConfig);
      if(stocks.length>0||orders.length>0) showToast('Données migrées vers le cloud ☁️', 'success');
    } catch(e) { console.warn('Migration failed:', e); }
  }

  // Migration silencieuse : ajout d'IDs manquants
  stocks = stocks.map(s => {
    if (!s.id) s.id = 'st-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    return s;
  });

  // Charge la clé Gemini depuis Supabase
  await loadGeminiKey();

  // Mise à jour du cache local
  try {
    localStorage.setItem('dc_stocks',    JSON.stringify(stocks));
    localStorage.setItem('dc_products',  JSON.stringify(products));
    localStorage.setItem('dc_orders',    JSON.stringify(orders));
    localStorage.setItem('dropControlConfig', JSON.stringify(currentConfig));
  } catch {}
}
let itemToDelete=null,activeMonthFilter='all',orderSearchQuery='';

// Sauvegarde double : localStorage (immédiat) + Supabase (cloud)
function saveStocks()  {try{localStorage.setItem('dc_stocks',  JSON.stringify(stocks));}catch{} dbSave('dc_stocks',  stocks);}
function saveProducts(){try{localStorage.setItem('dc_products',JSON.stringify(products));}catch{} dbSave('dc_products',products);}
function saveOrders()  {try{localStorage.setItem('dc_orders',  JSON.stringify(orders));}catch{} dbSave('dc_orders',  orders);}
function saveConfig()  {try{localStorage.setItem('dropControlConfig',JSON.stringify(currentConfig));}catch{} dbSave('dropControlConfig',currentConfig);}

// ─── UTILS ────────────────────────────────────────────────
function formatDate(iso){if(!iso)return'—';return new Date(iso).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});}
function generateId(p){return`${p}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;}
function showModal(el){
  el.style.cssText='display:flex!important';
  document.body.classList.add('modal-open');
}
function hideModal(el){
  el.style.cssText='display:none!important';
  // Retire modal-open seulement si aucun autre modal n'est ouvert
  const anyOpen=['settings-modal','delete-modal','reappro-modal'].some(id=>{
    const m=document.getElementById(id);
    return m&&m.style.display!=='none'&&m.style.display!=='';
  });
  if(!anyOpen) document.body.classList.remove('modal-open');
}
function initials(name){const p=(name||'?').trim().split(/\s+/);return p.length>=2?(p[0][0]+p[1][0]).toUpperCase():(p[0]||'?').slice(0,2).toUpperCase();}

// Formate les grands nombres
function fmtEur(val) {
  const v = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (v >= 1_000_000_000) return `${sign}€${(val/1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `${sign}€${(val/1_000_000).toFixed(1)}M`;
  if (v >= 10_000)        return `${sign}€${(val/1_000).toFixed(1)}K`;
  return `${sign}€${val.toFixed(2)}`;
}

// Anime un chiffre de l'ancienne valeur vers la nouvelle
function animateKPI(el, toVal, formatter, decimals=2) {
  if (!el) return;
  const from = parseFloat(el.dataset.rawVal || '0') || 0;
  el.dataset.rawVal = toVal;
  if (Math.abs(from - toVal) < 0.01) { el.textContent = formatter(toVal); return; }
  const duration = 600, start = performance.now();
  // Animation sans forcer reflow
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatter(from + (toVal - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = formatter(toVal);
  }
  requestAnimationFrame(tick);
}

function flashCard(id){const el=document.getElementById(id);if(!el)return;const c=el.closest('.metric-card');if(!c)return;c.classList.remove('flash');void c.offsetWidth;c.classList.add('flash');}

function showToast(msg, type='success') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const icons = {
    success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>`,
    error:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
    warn:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`
  };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<div class="toast-icon-box">${icons[type]||icons.success}</div><span>${msg}</span>`;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
}
function updateSidebarBadge(){
  const b=document.getElementById('sidebar-stock-badge');
  const mb=document.getElementById('mob-stock-badge');
  const n=stocks.filter(s=>s.currentQty<=currentConfig.stockAlert).length;
  if(n>0){
    if(b){b.textContent=n;b.classList.remove('hidden');}
    if(mb){mb.textContent=n;mb.classList.remove('hidden');}
  }else{
    if(b)b.classList.add('hidden');
    if(mb)mb.classList.add('hidden');
  }
}

// ─── NAVIGATION ───────────────────────────────────────────
const views={dashboard:document.getElementById('view-dashboard'),stock:document.getElementById('view-stock'),products:document.getElementById('view-products'),orders:document.getElementById('view-orders')};
const navBtns={dashboard:document.getElementById('btn-dashboard'),stock:document.getElementById('btn-stock'),products:document.getElementById('btn-products'),orders:document.getElementById('btn-orders')};
const PAGE_TITLES={dashboard:['Overview','Welcome back to your command center'],stock:['Stock & Inventaire','Gérez vos approvisionnements et lots de bijoux'],products:['Products & Margin','Simulateur de rentabilité et fiches produits'],orders:['Orders Tracking','Suivi en temps réel de vos commandes clients']};
function switchView(t){
  if(t==='orders'){
    // Reset filtre statut quand on arrive sur Orders
    orderStatusFilter='all';
    document.querySelectorAll('#status-filters .status-filter-btn').forEach(b=>b.className='status-filter-btn');
    document.querySelector('#status-filters .status-filter-btn[data-filter="all"]')?.classList.add('active-all');
  }
  Object.keys(views).forEach(k=>{const iT=k===t;views[k].classList.toggle('hidden',!iT);if(iT){views[k].classList.remove('view-enter');void views[k].offsetWidth;views[k].classList.add('view-enter');}navBtns[k].classList.toggle('active',iT);navBtns[k].classList.toggle('opacity-60',!iT);});
  const[ti,su]=PAGE_TITLES[t];document.getElementById('page-title').innerText=ti;document.getElementById('page-subtitle').innerText=su;
  const b=navBtns[t];if(b){b.classList.remove('just-clicked');void b.offsetWidth;b.classList.add('just-clicked');}
  // Sync bottom nav mobile
  ['dashboard','stock','products','orders'].forEach(k=>{
    const mb=document.getElementById('mob-'+k);
    if(mb)mb.classList.toggle('active',k===t);
  });
  window.scrollTo({top:0,behavior:'smooth'});
}
Object.keys(navBtns).forEach(k=>navBtns[k].addEventListener('click',()=>switchView(k)));

// ─── SHORTCUTS ────────────────────────────────────────────
const shortcutsOverlay=document.getElementById('shortcuts-overlay');
function showShortcuts(){shortcutsOverlay.classList.remove('hidden');}
function hideShortcuts(){shortcutsOverlay.classList.add('hidden');}
document.getElementById('btn-shortcuts-close').addEventListener('click',hideShortcuts);
document.getElementById('btn-show-shortcuts').addEventListener('click',showShortcuts);
shortcutsOverlay.addEventListener('click',e=>{if(e.target===shortcutsOverlay)hideShortcuts();});

document.addEventListener('keydown',e=>{
  const inInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT';
  const ctrl=e.ctrlKey||e.metaKey;

  // Escape — ferme tout
  if(e.key==='Escape'){
    const fep=document.getElementById('_fep');if(fep){fep.remove();return;}
    const lp=document.getElementById('_lot_panel');if(lp){lp.remove();return;}
    if(!shortcutsOverlay.classList.contains('hidden')){hideShortcuts();return;}
    hideModal(document.getElementById('delete-modal'));
    hideModal(document.getElementById('settings-modal'));
    hideModal(document.getElementById('reappro-modal'));
    return;
  }

  if(inInput)return;

  // ? → shortcuts
  if(e.key==='?'||(e.shiftKey&&e.key==='/')){e.preventDefault();showShortcuts();return;}

  if(!ctrl&&!e.shiftKey&&!e.altKey&&(e.key==='n'||e.key==='N')){
    e.preventDefault();switchView('orders');
    setTimeout(()=>{const f=document.getElementById('order-customer');if(f){f.focus();f.scrollIntoView({behavior:'smooth',block:'center'});}},150);
    return;
  }
  if(!ctrl&&!e.shiftKey&&!e.altKey&&(e.key==='s'||e.key==='S')){
    e.preventDefault();switchView('stock');
    setTimeout(()=>{const f=document.getElementById('stock-name');if(f){f.focus();f.scrollIntoView({behavior:'smooth',block:'center'});}},150);
    return;
  }
  // Navigation 1-4 — une seule touche
  if(!ctrl&&!e.shiftKey&&!e.altKey){
    if(e.key==='1'){e.preventDefault();switchView('dashboard');return;}
    if(e.key==='2'){e.preventDefault();switchView('stock');return;}
    if(e.key==='3'){e.preventDefault();switchView('products');return;}
    if(e.key==='4'){e.preventDefault();switchView('orders');return;}
    if(e.key===','){e.preventDefault();loadSettingsInputs();showModal(document.getElementById('settings-modal'));return;}
  }
});

// ─── MOIS ─────────────────────────────────────────────────
function buildMonthSelector(){
  const sel=document.getElementById('dash-month-selector');if(!sel)return;
  const ms=new Set();orders.forEach(o=>{if(!o.date)return;const d=new Date(o.date);ms.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);});
  const months=[...ms].sort((a,b)=>b.localeCompare(a));const now=new Date();
  sel.innerHTML='<option value="all">Toutes périodes</option>';
  months.forEach(m=>{const[y,mo]=m.split('-'),label=new Date(+y,+mo-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'}),cur=+y===now.getFullYear()&&+mo===now.getMonth()+1;const opt=document.createElement('option');opt.value=m;opt.innerText=label.charAt(0).toUpperCase()+label.slice(1)+(cur?' (En cours)':' (Archivé)');sel.appendChild(opt);});
  // Restaure la valeur active (ou pointe sur le mois actuel si dispo)
  if(activeMonthFilter!=='all'&&[...sel.options].some(o=>o.value===activeMonthFilter)){sel.value=activeMonthFilter;}
  else{sel.value='all';activeMonthFilter='all';}
  // Sync custom select trigger manuellement
  const trigger=sel.parentNode?.querySelector('.cs-trigger .cs-value');
  if(trigger){const o=sel.options[sel.selectedIndex];if(o)trigger.textContent=o.text;}
}
document.getElementById('dash-month-selector').addEventListener('change',e=>{activeMonthFilter=e.target.value;updateDashboardMetrics();});
function getFilteredOrders(){if(activeMonthFilter==='all')return orders;return orders.filter(o=>{if(!o.date)return false;const d=new Date(o.date);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`===activeMonthFilter;});}

// ─── SIMULATEUR ───────────────────────────────────────────
const inpCost=document.getElementById('inp-cost'),inpShipping=document.getElementById('inp-shipping'),inpSelling=document.getElementById('inp-selling'),inpQty=document.getElementById('inp-qty');
function calculateSimulator(){
  const cost=parseFloat(inpCost.value)||0,shipping=parseFloat(inpShipping.value)||0,selling=parseFloat(inpSelling.value)||0,qty=Math.max(1,parseInt(inpQty?.value)||1);
  const gf=currentConfig.feeFixed+(selling*(currentConfig.feePercent/100)),tc=cost+shipping+gf,np=selling-tc,mr=selling>0?(np/selling)*100:0,be=tc>0&&(selling-tc)>0?selling/(selling-tc):0;
  ['out-total-cost','out-be-roas','out-fees','out-margin-rate','out-net-profit'].forEach(id=>{const el=document.getElementById(id);if(el){el.classList.remove('sim-flash');void el.offsetWidth;el.classList.add('sim-flash');}});
  document.getElementById('out-total-cost').innerText=`€${tc.toFixed(2)}`;
  document.getElementById('out-be-roas').innerText=be.toFixed(2);
  document.getElementById('out-fees').innerText=currentConfig.feeFixed>0
    ?`€${gf.toFixed(2)} (€${currentConfig.feeFixed.toFixed(2)} fixe + ${currentConfig.feePercent}%)`
    :`€${gf.toFixed(2)} (${currentConfig.feePercent}%)`;
  const me=document.getElementById('out-margin-rate');me.innerText=`${mr.toFixed(1)}%`;me.style.color=mr<0?'#ef4444':'#10b981';
  const pe=document.getElementById('out-net-profit');pe.innerText=`€${np.toFixed(2)}`;pe.style.color=np<0?'#ef4444':'#10b981';
  const cp=document.getElementById('card-profit');
  if(np<0){cp.classList.add('border-red-500/40','bg-red-950/20');pe.className='text-4xl font-semibold mt-2 text-red-400';}
  else{cp.classList.remove('border-red-500/40','bg-red-950/20');pe.className='text-4xl font-semibold mt-2 text-emerald-400';}
  const bc=document.getElementById('card-batch');
  if(bc){if(qty>1){bc.classList.remove('hidden');document.getElementById('batch-qty-label').textContent=`×${qty}`;
    // feeFixed × qty (1 emballage par vente séparée) | shipping × 1 (1 livraison fournisseur)
    const bItemCost=(cost*qty)+shipping,bGateway=selling*qty*(currentConfig.feePercent/100),bTotalCost=bItemCost+(currentConfig.feeFixed*qty)+bGateway,bRevenue=selling*qty,bProfit=bRevenue-bTotalCost;
    document.getElementById('batch-total-cost').textContent=`€${bTotalCost.toFixed(2)}`;const bp=document.getElementById('batch-profit');bp.textContent=`€${bProfit.toFixed(2)}`;bp.style.color=bProfit<0?'#ef4444':'#10b981';document.getElementById('batch-revenue').textContent=`€${bRevenue.toFixed(2)}`;bc.classList.remove('sim-flash');void bc.offsetWidth;bc.classList.add('sim-flash');if(window.lucide)lucide.createIcons();}else{bc.classList.add('hidden');}}
}
[inpCost,inpShipping,inpSelling].forEach(i=>i.addEventListener('input',calculateSimulator));
if(inpQty)inpQty.addEventListener('input',calculateSimulator);

// ─── CATALOGUE — CSS Grid (même style que inventory/orders) ──
document.getElementById('btn-save-product').addEventListener('click',()=>{
  const name=document.getElementById('inp-product-name').value.trim();
  if(!name)return showToast('Veuillez donner un nom au produit','warn');
  const cost=parseFloat(inpCost.value)||0,shipping=parseFloat(inpShipping.value)||0,selling=parseFloat(inpSelling.value)||0;
  const gf=currentConfig.feeFixed+(selling*(currentConfig.feePercent/100));
  // Sauvegarde les frais du moment pour cohérence avec le panel Lot
  products.push({id:generateId('prod'),name,cost,shipping,selling,gatewayFees:gf,
    feeFixedAtSave:currentConfig.feeFixed,feePctAtSave:currentConfig.feePercent});
  saveProducts();document.getElementById('inp-product-name').value='';renderProducts();showToast(`Produit « ${name} » ajouté au catalogue`);
});

function renderProducts(){
  const container=document.getElementById('catalog-tbody');container.innerHTML='';
  document.getElementById('catalog-counter').innerText=`${products.length} Produit(s) validé(s)`;

  if(products.length===0){
    container.innerHTML='<div class="cat-empty">Aucun produit sauvegardé pour le moment…</div>';
    return;
  }

  products.forEach((p,idx)=>{
    const tc=p.cost+p.shipping+p.gatewayFees,np=p.selling-tc,m=p.selling>0?(np/p.selling)*100:0;
    const av=initials(p.name);
    const row=document.createElement('div');
    row.className='cat-grid-row';
    row.style.animationDelay=`${idx*40}ms`;

    // Nom avec avatar bleu
    const nameCell=document.createElement('div');
    nameCell.className='cat-name-cell';
    nameCell.innerHTML=`<div class="cat-avatar">${av}</div><span class="cat-name-txt" title="${p.name}">${p.name}</span>`;

    // Coût total
    const costCell=document.createElement('div');
    costCell.className='cat-cell';
    costCell.textContent=`€${tc.toFixed(2)}`;

    // Prix de vente
    const priceCell=document.createElement('div');
    priceCell.className='cat-cell-r';
    priceCell.textContent=`€${p.selling.toFixed(2)}`;

    // Marge %
    const marginCell=document.createElement('div');
    marginCell.className='cat-margin';
    marginCell.textContent=`${m.toFixed(1)}%`;
    marginCell.style.color=m<0?'var(--danger)':'var(--accent)';

    // Profit net / U
    const profitCell=document.createElement('div');
    profitCell.className='cat-profit';
    profitCell.textContent=`€${np.toFixed(2)}`;
    profitCell.style.color=np<0?'var(--danger)':'var(--accent)';

    // Bouton Lot uniquement
    const lotCell=document.createElement('div');
    lotCell.style.cssText='display:flex;justify-content:center;align-items:center;';
    const lotBtn=document.createElement('button');
    lotBtn.className='cat-lot-btn';
    lotBtn.innerHTML=`<i data-lucide="layers" style="width:11px;height:11px"></i> Lot`;
    lotBtn.addEventListener('click',()=>openLotPanel(p.id,lotBtn));
    lotCell.appendChild(lotBtn);

    // Bouton supprimer
    const delCell=document.createElement('div');
    delCell.style.cssText='display:flex;justify-content:flex-end;';
    const delBtn=document.createElement('button');
    delBtn.className='cat-del';
    delBtn.title='Supprimer ce produit';
    delBtn.innerHTML=`<i data-lucide="trash-2" style="width:14px;height:14px"></i>`;
    delBtn.addEventListener('click',()=>openDeleteModal('product',p.id));
    delCell.appendChild(delBtn);

    row.append(nameCell,costCell,priceCell,marginCell,profitCell,lotCell,delCell);

    // Info mobile catalogue
    const mobInfo=document.createElement('div');
    mobInfo.className='cat-mobile-info';
    mobInfo.innerHTML=`<span>Coût: <strong>€${tc.toFixed(2)}</strong></span><span class="sep">·</span><span>Vente: <strong>€${p.selling.toFixed(2)}</strong></span><span class="sep">·</span><span style="color:${m<0?'var(--danger)':'var(--accent)'}">${m.toFixed(1)}%</span><span class="sep">·</span><span style="color:${np<0?'var(--danger)':'var(--accent)'}">+€${np.toFixed(2)}/u</span>`;
    row.appendChild(mobInfo);

    container.appendChild(row);
  });

  if(window.lucide)lucide.createIcons();
}

// ─── LOT PANEL — calculateur flottant par produit ──────────
function openLotPanel(productId, triggerBtn) {
  // Toggle si même produit
  const existing=document.getElementById('_lot_panel');
  if(existing){
    if(existing.dataset.pid===productId){
      existing.remove();
      triggerBtn.classList.remove('active');
      return;
    }
    // Désactive l'ancien bouton
    const oldBtn=document.querySelector('.cat-lot-btn.active');
    if(oldBtn)oldBtn.classList.remove('active');
    existing.remove();
  }

  const product=products.find(p=>p.id===productId);
  if(!product)return;
  triggerBtn.classList.add('active');

  const tc=product.cost+product.shipping+product.gatewayFees;
  const np=product.selling-tc;

  const panel=document.createElement('div');
  panel.id='_lot_panel';
  panel.dataset.pid=productId;
  panel.className='lot-panel';

  panel.innerHTML=`
    <div class="lot-panel-header">
      <div class="lot-panel-icon"><i data-lucide="layers" style="width:13px;height:13px"></i></div>
      <span class="lot-panel-title">${product.name}</span>
      <button class="lot-panel-close" title="Fermer">×</button>
    </div>
    <div class="lot-panel-body">
      <div class="lot-qty-row">
        <span class="lot-qty-label">Quantité</span>
        <input type="number" class="lot-qty-input" id="_lot_qty" value="${product.lastLotQty??10}" min="1" step="1">
      </div>
      <div class="lot-results">
        <div class="lot-result-cell">
          <div class="lot-result-label">Coût lot</div>
          <div class="lot-result-value" id="_lot_cost">—</div>
        </div>
        <div class="lot-result-cell profit-cell">
          <div class="lot-result-label">Profit lot</div>
          <div class="lot-result-value" id="_lot_profit">—</div>
        </div>
        <div class="lot-result-cell revenue-cell">
          <div class="lot-result-label">CA potentiel</div>
          <div class="lot-result-value" id="_lot_rev">—</div>
        </div>
      </div>
      <div class="lot-per-unit">
        <span class="lot-per-unit-label">Profit / unité</span>
        <span class="lot-per-unit-value" id="_lot_unit">€${np.toFixed(2)}</span>
      </div>
    </div>`;

  document.body.appendChild(panel);
  if(window.lucide)lucide.createIcons();

  function calcLot(){
    const qty=Math.max(1,parseInt(document.getElementById('_lot_qty').value)||1);
    const savedFF = product.feeFixedAtSave ?? currentConfig.feeFixed;
    const savedFP = product.feePctAtSave   ?? currentConfig.feePercent;
    const itemOnly=(product.cost*qty)+product.shipping;
    const gw=product.selling*qty*(savedFP/100);
    // feeFixed × qty : 1 emballage par vente séparée
    const bCost=itemOnly+(savedFF*qty)+gw;
    const bRev=product.selling*qty;
    const bProfit=bRev-bCost;
    const npUnit=product.selling-(product.cost+product.shipping+savedFF+product.selling*(savedFP/100));
    document.getElementById('_lot_cost').textContent=`€${bCost.toFixed(2)}`;
    const pEl=document.getElementById('_lot_profit');
    pEl.textContent=`€${bProfit.toFixed(2)}`;
    pEl.style.color=bProfit<0?'var(--danger)':'var(--accent)';
    document.getElementById('_lot_rev').textContent=`€${bRev.toFixed(2)}`;
    const uEl=document.getElementById('_lot_unit');
    uEl.textContent=`€${npUnit.toFixed(2)}`;
    uEl.style.color=npUnit<0?'var(--danger)':'rgba(255,255,255,0.6)';
    // Sauvegarde la quantité avec debounce (évite spam Supabase à chaque frappe)
    const prod=products.find(p=>p.id===productId);
    if(prod&&prod.lastLotQty!==qty){
      prod.lastLotQty=qty;
      clearTimeout(calcLot._saveTimer);
      calcLot._saveTimer=setTimeout(()=>saveProducts(),800);
    }
  }
  document.getElementById('_lot_qty').addEventListener('input',calcLot);
  calcLot();

  // Positionnement — centré sur mobile, sous le bouton sur desktop
  const rect=triggerBtn.getBoundingClientRect();
  if(window.innerWidth<=768){
    panel.style.left='16px';
    panel.style.right='16px';
    panel.style.width='calc(100vw - 32px)';
    panel.style.top='50%';
    panel.style.transform='translateY(-50%)';
    panel.style.position='fixed';
  } else {
    panel.style.left=rect.left+'px';
    panel.style.top=(rect.bottom+6)+'px';
    requestAnimationFrame(()=>{
      const pr=panel.getBoundingClientRect();
      if(pr.bottom>window.innerHeight-16)panel.style.top=(rect.top-pr.height-6)+'px';
      // Décalage vers la gauche si trop proche du bord droit
      if(pr.right>window.innerWidth-24){
        panel.style.left=(window.innerWidth-pr.width-24)+'px';
      }
    });
  }

  panel.querySelector('.lot-panel-close').addEventListener('click',()=>{panel.remove();triggerBtn.classList.remove('active');});

  function outside(e){
    if(!panel.contains(e.target)&&e.target!==triggerBtn){
      document.removeEventListener('mousedown',outside,true);
      panel.remove();triggerBtn.classList.remove('active');
    }
  }
  setTimeout(()=>document.addEventListener('mousedown',outside,true),50);
}

// ─── STOCK ────────────────────────────────────────────────
document.getElementById('btn-add-stock').addEventListener('click',()=>{
  const name=document.getElementById('stock-name').value.trim(),tc=parseFloat(document.getElementById('stock-total-cost').value)||0,iq=parseInt(document.getElementById('stock-qty').value)||0;
  if(!name||tc<=0||iq<=0)return showToast('Remplissez tous les champs correctement','warn');
  stocks.push({id:generateId('st'),name,totalCost:tc,originalQty:iq,initialQty:iq,currentQty:iq,unitCost:tc/iq});
  saveStocks();document.getElementById('stock-name').value='';document.getElementById('stock-total-cost').value='';document.getElementById('stock-qty').value='';
  renderStock();populateOrderSelect();updateDashboardMetrics();showToast(`Lot « ${name} » ajouté (${iq} u.)`);
});
function renderStock(){
  const container=document.getElementById('stock-tbody');container.innerHTML='';
  if(stocks.length===0){container.innerHTML='<div class="inv-empty">Aucun article en inventaire pour le moment…</div>';return;}
  stocks.forEach((s,idx)=>{
    const uc=s.unitCost!=null?s.unitCost:(s.initialQty>0?s.totalCost/s.initialQty:0),isLow=s.currentQty<=currentConfig.stockAlert,av=initials(s.name);
    const displayQty=s.originalQty??s.initialQty;
    const pct=displayQty>0?Math.min(100,(s.currentQty/displayQty)*100):0;
    const barColor=pct>60?'var(--accent)':pct>25?'var(--warn)':'var(--danger)';
    const [avbg,avborder,avcolor]=isLow?['rgba(248,113,113,0.12)','rgba(248,113,113,0.25)','#f87171']:avatarColor(s.name);
    const row=document.createElement('div');row.className='inv-grid-row'+(isLow?' row-low':'');row.style.animationDelay=`${idx*40}ms`;
    row.innerHTML=`
      <div class="inv-name-cell"><div class="inv-avatar" style="background:${avbg};border-color:${avborder};color:${avcolor};width:38px;height:38px;font-size:13px">${av}</div><span class="inv-name-txt" title="${s.name}">${s.name}</span></div>
      <div class="inv-cell">€${s.totalCost.toFixed(2)}</div>
      <div class="inv-cell-c">${displayQty}</div>
      <div class="inv-stock ${isLow?'low':'ok'}">
        ${s.currentQty}
        <div class="stock-level-bar"><div class="stock-level-fill" style="width:${pct}%;background:${barColor}"></div></div>
      </div>
      <div class="inv-cell-r">€${uc.toFixed(2)}</div>
      <div style="display:flex;justify-content:flex-end"><button class="inv-del" onclick="openDeleteModal('stock','${s.id}')" title="Supprimer"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button></div>
      <div class="inv-mobile-info">
        <span>Investi: <strong>€${s.totalCost.toFixed(2)}</strong></span>
        <span class="sep">·</span>
        <span>Stock: <strong class="${isLow?'text-red-400':'text-white'}">${s.currentQty}</strong>/${displayQty}</span>
        <span class="sep">·</span>
        <span>€${uc.toFixed(2)}/u</span>
      </div>`;
    container.appendChild(row);
  });
  if(window.lucide)lucide.createIcons();
}
function populateOrderSelect(){
  const sel=document.getElementById('order-product-select'),av=stocks.filter(s=>s.currentQty>0);sel.innerHTML='';
  if(av.length===0){sel.innerHTML='<option value="">Aucun article disponible</option>';}
  else{av.forEach(s=>{const opt=document.createElement('option');opt.value=s.id;opt.innerText=`${s.name} (Reste : ${s.currentQty})`;sel.appendChild(opt);});}
  // Refresh custom select trigger text
  const trigger=sel.parentNode?.querySelector('.cs-trigger .cs-value');
  if(trigger){const o=sel.options[sel.selectedIndex];trigger.textContent=o?o.text:'—';}
}

// ─── COMMANDES ────────────────────────────────────────────
document.getElementById('btn-add-order').addEventListener('click',()=>{
  const customer=document.getElementById('order-customer').value.trim(),stockId=document.getElementById('order-product-select').value,
    tr=parseFloat(document.getElementById('order-total').value)||0,status=document.getElementById('order-status').value,qty=parseInt(document.getElementById('order-qty').value)||1;
  if(!customer||!stockId||tr<=0||qty<=0)return showToast('Données de commande invalides','warn');
  const stock=stocks.find(s=>s.id===stockId);if(!stock)return showToast('Article introuvable','error');
  if(stock.currentQty<qty)return showToast(`Stock insuffisant : ${stock.currentQty} u.`,'warn');
  stock.currentQty-=qty;saveStocks();
  orders.push({id:generateId('ord'),customer,stockId,productName:stock.name,qty,
    unitCostItem:stock.unitCost!=null?stock.unitCost:(stock.initialQty>0?stock.totalCost/stock.initialQty:0),
    feeFixedAtTime:currentConfig.feeFixed,
    feePctAtTime:currentConfig.feePercent,
    totalReceived:tr,status,date:new Date().toISOString()});
  saveOrders();document.getElementById('order-customer').value='';document.getElementById('order-total').value='';document.getElementById('order-qty').value='1';
  const now=new Date(),ck=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;activeMonthFilter=(activeMonthFilter==='all')?'all':ck;
  buildMonthSelector();renderStock();populateOrderSelect();renderOrders();updateDashboardMetrics();showToast(`Commande de ${customer} enregistrée`);
});

// Couleur avatar basée sur le nom
function avatarColor(name='') {
  const p=[['rgba(124,58,237,0.18)','rgba(124,58,237,0.35)','#a78bfa'],['rgba(52,211,153,0.15)','rgba(52,211,153,0.3)','#34d399'],['rgba(96,165,250,0.15)','rgba(96,165,250,0.3)','#60a5fa'],['rgba(251,191,36,0.15)','rgba(251,191,36,0.3)','#fbbf24'],['rgba(248,113,113,0.15)','rgba(248,113,113,0.3)','#f87171'],['rgba(34,211,238,0.15)','rgba(34,211,238,0.3)','#22d3ee'],['rgba(167,139,250,0.15)','rgba(167,139,250,0.3)','#c4b5fd'],['rgba(16,185,129,0.15)','rgba(16,185,129,0.3)','#10b981']];
  let h=0;for(let i=0;i<name.length;i++)h=name.charCodeAt(i)+((h<<5)-h);
  return p[Math.abs(h)%p.length];
}

let orderStatusFilter='all';

function renderOrders(){
  const listEl=document.getElementById('orders-list');if(!listEl)return;listEl.innerHTML='';
  const q=(orderSearchQuery||'').trim().toLowerCase();
  let list=[...orders].reverse();
  if(q)list=list.filter(o=>(o.customer||'').toLowerCase().includes(q)||(o.productName||'').toLowerCase().includes(q));
  if(orderStatusFilter!=='all')list=list.filter(o=>o.status===orderStatusFilter);
  document.getElementById('order-counter').innerText=`${list.length} / ${orders.length} Order(s)`;
  if(list.length===0){listEl.innerHTML=`<div class="orders-empty">${q?'Aucune commande ne correspond.':'Aucune commande pour le moment…'}</div>`;return;}
  const SC={'En cours':'status-encours','Expédié':'status-expedie','Livré':'status-livre'};
  const isMobile=window.innerWidth<=768;

  list.forEach((o,idx)=>{
    const row=document.createElement('div');
    row.className='order-row';row.style.animationDelay=`${idx*30}ms`;
    const dateISO=o.date?new Date(o.date).toISOString().split('T')[0]:'';

    const [abg,aborder,acolor]=avatarColor(o.customer||'');
    if(isMobile){
      row.innerHTML=`
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div class="order-client-wrap" style="min-width:0;overflow:hidden">
            <div class="order-avatar" style="background:${abg};border-color:${aborder};color:${acolor}">${initials(o.customer)}</div>
            <div class="order-client-info">
              <div class="order-customer-name mob-name">${o.customer}</div>
              <span class="order-date mob-date">${formatDate(o.date)} ✎</span>
            </div>
          </div>
          <span class="status-badge ${SC[o.status]||'status-encours'} mob-status">${o.status}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 0">
          <div class="order-article-wrap" style="min-width:0;flex:1">
            <span class="order-article-name">${o.productName}</span>
            <span class="qty-pill mob-qty">×${o.qty||1}</span>
          </div>
          <span class="order-amount mob-amt">€${o.totalReceived.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:flex-end">
          <button class="order-del mob-del"><i data-lucide="trash-2" style="width:13px;height:13px"></i><span>Supprimer</span></button>
        </div>`;

      row.querySelector('.mob-name').addEventListener('click',function(e){openFloatingEdit(e.currentTarget,'text',o.customer,v=>{const ord=orders.find(x=>x.id===o.id);if(!ord)return;ord.customer=v.trim()||ord.customer;saveOrders();renderOrders();updateDashboardMetrics();});});
      row.querySelector('.mob-date').addEventListener('click',function(e){e.stopPropagation();openFloatingEdit(e.currentTarget,'date',dateISO,v=>{if(!v)return;const ord=orders.find(x=>x.id===o.id);if(!ord)return;const tp=ord.date?ord.date.slice(11):'12:00:00.000Z';ord.date=v+'T'+tp;saveOrders();buildMonthSelector();renderOrders();updateDashboardMetrics();showToast('Date mise à jour');});});
      row.querySelector('.mob-status').addEventListener('click',()=>cycleOrderStatus(o.id));
      row.querySelector('.mob-qty').addEventListener('click',function(e){openFloatingEdit(e.currentTarget,'number',o.qty||1,v=>{const nq=parseInt(v);if(isNaN(nq)||nq<=0){renderOrders();return;}const ord=orders.find(x=>x.id===o.id);if(!ord)return;const st=stocks.find(s=>s.id===ord.stockId),diff=nq-(ord.qty||1);if(st&&diff>0&&st.currentQty<diff){showToast(`Stock insuffisant`,'warn');renderOrders();return;}if(st){st.currentQty-=diff;saveStocks();}ord.qty=nq;saveOrders();renderOrders();renderStock();populateOrderSelect();updateDashboardMetrics();});});
      row.querySelector('.mob-amt').addEventListener('click',function(e){openFloatingEdit(e.currentTarget,'number',o.totalReceived,v=>{const p=parseFloat(v);if(isNaN(p)||p<0)return;const ord=orders.find(x=>x.id===o.id);if(!ord)return;ord.totalReceived=p;saveOrders();renderOrders();updateDashboardMetrics();});});
      row.querySelector('.mob-del').addEventListener('click',()=>openDeleteModal('order',o.id));

    } else {
      // ── LAYOUT DESKTOP : grille 5 colonnes ──
      const cClient=document.createElement('div');
      cClient.innerHTML=`<div class="order-client-wrap"><div class="order-avatar" style="background:${abg};border-color:${aborder};color:${acolor}">${initials(o.customer)}</div><div class="order-client-info"><div class="order-customer-name" title="Modifier le nom">${o.customer}</div><span class="order-date" title="Modifier la date">${formatDate(o.date)} ✎</span></div></div>`;
      cClient.querySelector('.order-customer-name').addEventListener('click',function(e){openFloatingEdit(e.currentTarget,'text',o.customer,v=>{const ord=orders.find(x=>x.id===o.id);if(!ord)return;ord.customer=v.trim()||ord.customer;saveOrders();renderOrders();updateDashboardMetrics();});});
      cClient.querySelector('.order-date').addEventListener('click',function(e){e.stopPropagation();openFloatingEdit(e.currentTarget,'date',dateISO,v=>{if(!v)return;const ord=orders.find(x=>x.id===o.id);if(!ord)return;const tp=ord.date?ord.date.slice(11):'12:00:00.000Z';ord.date=v+'T'+tp;saveOrders();buildMonthSelector();renderOrders();updateDashboardMetrics();showToast('Date mise à jour');});});
      const cArticle=document.createElement('div');
      cArticle.innerHTML=`<div class="order-article-wrap"><span class="order-article-name" title="${o.productName}">${o.productName}</span><span class="qty-pill" title="Modifier la quantité">×${o.qty||1}</span></div>`;
      cArticle.querySelector('.qty-pill').addEventListener('click',function(e){openFloatingEdit(e.currentTarget,'number',o.qty||1,v=>{const nq=parseInt(v);if(isNaN(nq)||nq<=0){renderOrders();return;}const ord=orders.find(x=>x.id===o.id);if(!ord)return;const st=stocks.find(s=>s.id===ord.stockId),diff=nq-(ord.qty||1);if(st&&diff>0&&st.currentQty<diff){showToast(`Stock insuffisant : ${st.currentQty} u.`,'warn');renderOrders();return;}if(st){st.currentQty-=diff;saveStocks();}ord.qty=nq;saveOrders();renderOrders();renderStock();populateOrderSelect();updateDashboardMetrics();});});
      const cAmount=document.createElement('div');
      cAmount.innerHTML=`<span class="order-amount" title="Modifier">€${o.totalReceived.toFixed(2)}</span>`;
      cAmount.querySelector('.order-amount').addEventListener('click',function(e){openFloatingEdit(e.currentTarget,'number',o.totalReceived,v=>{const p=parseFloat(v);if(isNaN(p)||p<0)return;const ord=orders.find(x=>x.id===o.id);if(!ord)return;ord.totalReceived=p;saveOrders();renderOrders();updateDashboardMetrics();});});
      const cStatus=document.createElement('div');
      cStatus.innerHTML=`<span class="status-badge ${SC[o.status]||'status-encours'}" title="Changer">${o.status}</span>`;
      cStatus.querySelector('.status-badge').addEventListener('click',()=>cycleOrderStatus(o.id));
      const cAction=document.createElement('div');
      cAction.innerHTML=`<button class="order-del"><i data-lucide="trash-2" style="width:13px;height:13px"></i><span>Supprimer</span></button>`;
      cAction.querySelector('.order-del').addEventListener('click',()=>openDeleteModal('order',o.id));
      row.append(cClient,cArticle,cAmount,cStatus,cAction);
    }

    listEl.appendChild(row);
  });
  if(window.lucide)lucide.createIcons();
}

// ─── FLOATING EDIT ────────────────────────────────────────
function openFloatingEdit(targetEl,type,currentValue,onCommit){
  const existing=document.getElementById('_fep');if(existing)existing.remove();
  const rect=targetEl.getBoundingClientRect();
  const panel=document.createElement('div');panel.id='_fep';panel.className='floating-edit-panel';
  const input=document.createElement('input');
  if(type==='number'){input.type='number';input.step='0.01';input.min='0';}
  else if(type==='date'){input.type='date';}else{input.type='text';}
  input.value=currentValue;input.className='floating-edit-input';
  input.style.width=Math.max(rect.width,type==='date'?160:130)+'px';
  const hint=document.createElement('div');hint.className='floating-edit-hint';hint.textContent='↵ valider  ·  Échap annuler';
  panel.append(input,hint);document.body.appendChild(panel);
  let top=rect.bottom+6,left=rect.left;panel.style.left=left+'px';panel.style.top=top+'px';
  requestAnimationFrame(()=>{const pr=panel.getBoundingClientRect();if(pr.bottom>window.innerHeight-16)panel.style.top=(rect.top-pr.height-6)+'px';if(pr.right>window.innerWidth-16)panel.style.left=(window.innerWidth-pr.width-16)+'px';});
  input.focus();if(type!=='date')input.select();
  function commit(){document.removeEventListener('mousedown',outside,true);const val=input.value;panel.remove();onCommit(val);}
  function cancel(){document.removeEventListener('mousedown',outside,true);panel.remove();renderOrders();}
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape'){e.preventDefault();cancel();}});
  function outside(e){if(!panel.contains(e.target)&&e.target!==targetEl){document.removeEventListener('mousedown',outside,true);commit();}}
  setTimeout(()=>document.addEventListener('mousedown',outside,true),50);
}
function cycleOrderStatus(id){const o=orders.find(o=>o.id===id);if(!o)return;const next={'En cours':'Expédié','Expédié':'Livré','Livré':'En cours'};o.status=next[o.status]||'En cours';saveOrders();renderOrders();updateDashboardMetrics();showToast(`${o.customer} → ${o.status}`);}

// ─── STATS ────────────────────────────────────────────────
function computeStats(list){
  let rev=0,cost=0;
  list.forEach(o=>{
    rev+=o.totalReceived;
    // Utilise les frais figés au moment de la commande (snapshot)
    // ?? assure la rétrocompatibilité avec les anciennes commandes
    const ff = o.feeFixedAtTime  ?? currentConfig.feeFixed;
    const fp = o.feePctAtTime    ?? currentConfig.feePercent;
    cost+=(o.unitCostItem*(o.qty||1))+ff+(o.totalReceived*(fp/100));
  });
  const np=rev-cost,mr=rev>0?(np/rev)*100:0,ab=list.length>0?rev/list.length:0;
  return{revenue:rev,costBasis:cost,netProfit:np,marginRate:mr,avgBasket:ab,orderCount:list.length};
}
function getPrevKey(k){let y,m;if(k==='all'){const n=new Date();y=n.getFullYear();m=n.getMonth()+1;}else[y,m]=k.split('-').map(Number);m--;if(m===0){m=12;y--;}return`${y}-${String(m).padStart(2,'0')}`;}
function getOrdersForMonth(k){return orders.filter(o=>{if(!o.date)return false;const d=new Date(o.date);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`===k;});}
function formatDelta(cur,prev,isCur=true,isPct=false){
  if(prev===0&&cur===0)return{text:'— pas de données',colorClass:'text-gray-500'};if(prev===0)return{text:'— premier mois',colorClass:'text-gray-500'};
  const diff=cur-prev,pct=(diff/Math.abs(prev))*100,sign=diff>=0?'+':'',arrow=diff>=0?'▲':'▼',color=diff>=0?'text-emerald-400':'text-red-400';
  const vs=isPct?`${sign}${diff.toFixed(1)}pt`:isCur?`${sign}€${Math.abs(diff).toFixed(2)}`:`${sign}${diff}`;
  return{text:`${arrow} ${vs} (${sign}${pct.toFixed(0)}% vs mois préc.)`,colorClass:color};
}

  // KPI trend badges
  function setTrend(id, cur, prev) {
    const el = document.getElementById(id); if(!el) return;
    if (!prev && prev !== 0) { el.className='kpi-trend kpi-trend-flat'; el.textContent=''; return; }
    const diff = cur - prev;
    if (Math.abs(diff) < 0.01) { el.className='kpi-trend kpi-trend-flat'; el.textContent='→'; return; }
    el.className = `kpi-trend ${diff>0?'kpi-trend-up':'kpi-trend-down'}`;
    el.textContent = diff>0?'▲':'▼';
  }

  // Trésorerie sparkline
  function renderTresoSparkline() {
    const svg = document.getElementById('treso-sparkline'); if(!svg) return;
    const sorted = [...orders].sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(-12);
    if(sorted.length < 2) { svg.innerHTML=''; return; }
    let cumP = 0; const pts = sorted.map(o => {
      const fee=(o.feeFixedAtTime??currentConfig.feeFixed)+o.totalReceived*((o.feePctAtTime??currentConfig.feePercent)/100);
      const cost=(o.unitCostItem??0)*(o.qty||1);
      cumP+=o.totalReceived-fee-cost; return cumP;
    });
    const mn=Math.min(...pts),mx=Math.max(...pts),range=mx-mn||1;
    const W=60,H=20,pad=2;
    const tx=i=>(i/(pts.length-1))*(W-pad*2)+pad;
    const ty=v=>H-pad-((v-mn)/range)*(H-pad*2);
    const d=pts.map((p,i)=>`${i===0?'M':'L'}${tx(i).toFixed(1)} ${ty(p).toFixed(1)}`).join(' ');
    const color=pts[pts.length-1]>=pts[0]?'#34d399':'#f87171';
    svg.innerHTML=`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/><circle cx="${tx(pts.length-1).toFixed(1)}" cy="${ty(pts[pts.length-1]).toFixed(1)}" r="2" fill="${color}"/>`;
  }

function updateDashboardMetrics(){
  const filtered=getFilteredOrders(),cur=computeStats(filtered);
  const sc=activeMonthFilter!=='all',prev=sc?computeStats(getOrdersForMonth(getPrevKey(activeMonthFilter))):null;

  // Profit net — animé
  const pe=document.getElementById('dash-profit');
  pe.className=`text-2xl font-medium ${cur.netProfit<0?'text-red-400':'text-emerald-400'}`;
  animateKPI(pe, cur.netProfit, v=>`€${v.toFixed(2)}`);
  const ps=document.getElementById('dash-profit-compare');
  if(sc&&prev){const d=formatDelta(cur.netProfit,prev.netProfit,true);ps.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}
  else{const p=currentConfig.monthlyGoal>0?(cur.netProfit/currentConfig.monthlyGoal)*100:0;ps.innerHTML=`${p.toFixed(1)}% de l'objectif (€${currentConfig.monthlyGoal})`;}

  // Barre objectif
  const gb=document.getElementById('dash-goal-bar');
  if(gb){const g=currentConfig.monthlyGoal>0?Math.max(0,(cur.netProfit/currentConfig.monthlyGoal)*100):0;gb.style.width=`${Math.min(g,100).toFixed(1)}%`;gb.classList.toggle('over',g>=100);}

  // Commandes
  const oe=document.getElementById('dash-orders');
  animateKPI(oe, cur.orderCount, v=>Math.round(v).toString(), 0);
  const os=document.getElementById('dash-orders-compare');
  if(os){if(sc&&prev){const d=formatDelta(cur.orderCount,prev.orderCount,false);os.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}else{os.innerText='Commandes au total';}}

  // CA
  const re=document.getElementById('dash-revenue');
  if(re){animateKPI(re, cur.revenue, v=>`€${v.toFixed(2)}`);const rs=document.getElementById('dash-revenue-compare');if(rs){if(sc&&prev){const d=formatDelta(cur.revenue,prev.revenue,true);rs.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}else{rs.innerText='Total encaissé';}}}

  // Panier moyen
  const roi=document.getElementById('dash-roi');
  animateKPI(roi, cur.avgBasket, v=>`€${v.toFixed(2)}`);
  
  const bs=document.getElementById('dash-basket-compare');
  if(bs){if(sc&&prev){const d=formatDelta(cur.avgBasket,prev.avgBasket,true);bs.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}else{bs.innerText='Moyenne par vente';}}

  // Marge
  const mr=document.getElementById('dash-margin-rate');
  animateKPI(mr, cur.marginRate, v=>`${v.toFixed(1)}%`, 1);
  
  const ms2=document.getElementById('dash-margin-compare');
  if(ms2){if(sc&&prev){const d=formatDelta(cur.marginRate,prev.marginRate,false,true);ms2.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}else{ms2.innerText='Santé globale du mois';}}

  // Trésorerie
  const tr=(parseFloat(currentConfig.initialCapital)||0)+orders.reduce((a,o)=>a+o.totalReceived,0)-stocks.reduce((a,s)=>a+s.totalCost,0)-orders.reduce((a,o)=>a+(o.feeFixedAtTime??currentConfig.feeFixed)+(o.totalReceived*((o.feePctAtTime??currentConfig.feePercent)/100)),0);
  const bde=document.getElementById('dash-budget-display');
  animateKPI(bde, tr, v=>`€${v.toFixed(2)}`);

  // Alertes stock
  const at=document.getElementById('alert-tbody');at.innerHTML='';const low=stocks.filter(s=>s.currentQty<=currentConfig.stockAlert);
  if(low.length===0){at.innerHTML='<tr><td colspan="3" class="p-4 text-center text-gray-500 italic">Aucune rupture ! 🚀</td></tr>';}
  else{low.forEach(s=>{const tr2=document.createElement('tr');tr2.className='border-b border-white/5';const qc=s.currentQty===0?'text-red-500':'text-red-400';tr2.innerHTML=`<td class="p-2.5 font-medium">${s.name}</td><td class="p-2.5 text-center font-bold ${qc}">${s.currentQty} u</td><td class="p-2.5 text-right"><button onclick="openReapproModal('${s.id}')" class="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 px-2.5 py-0.5 rounded text-[10px] font-medium uppercase transition">+ Réappro</button></td>`;at.appendChild(tr2);});}

  // Todo commandes en attente
  // To-Do List Express — design premium
  const tc2=document.getElementById('todo-list-container');
  const badge=document.getElementById('todo-count-badge');
  const statsEl=document.getElementById('todo-stats');
  tc2.innerHTML='';
  const pend=orders.filter(o=>o.status!=='Livré').sort((a,b)=>({'En cours':0,'Expédié':1}[a.status]??2)-({'En cours':0,'Expédié':1}[b.status]??2));
  const enCours=pend.filter(o=>o.status==='En cours').length, expedie=pend.filter(o=>o.status==='Expédié').length;
  if(badge){badge.textContent=pend.length;badge.classList.toggle('hidden',pend.length===0);}
  if(statsEl)statsEl.textContent=pend.length>0?`${enCours} en cours · ${expedie} expédiés`:'';
  if(pend.length===0){
  tc2.innerHTML=`<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:8px;padding:24px;opacity:0.5"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><p style="font-size:13px;color:white;font-weight:500">Toutes les commandes livrées !</p><p style="font-size:11px;color:rgba(255,255,255,0.4)">Rien à traiter pour le moment</p></div>`;
  } else {
    pend.forEach((o,i)=>{
      const [avbg,,avcolor]=avatarColor(o.customer||'');
      const isEncours=o.status==='En cours';
      const fee=(o.feeFixedAtTime??currentConfig.feeFixed)+o.totalReceived*((o.feePctAtTime??currentConfig.feePercent)/100);
      const profit=(o.totalReceived-fee-(o.unitCostItem??0)*(o.qty||1)).toFixed(2);
      const c=document.createElement('div');
      c.className=`todo-card status-${isEncours?'encours':'expedie'}`;
      c.style.animationDelay=`${i*60}ms`;
      c.innerHTML=`
        <div style="display:flex;align-items:center;gap:10px">
          <div class="todo-avatar" style="background:${avbg};color:${avcolor}">${initials(o.customer)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.customer}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:1px">${formatDate(o.date)}${(()=>{const days=o.date?Math.floor((Date.now()-new Date(o.date))/86400000):0;return days>7?` <span style="color:#f87171;font-weight:600">· ${days}j</span>`:''})()}</div>
          </div>
          <span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;${isEncours?'background:rgba(251,191,36,0.12);color:#fbbf24;border:1px solid rgba(251,191,36,0.25)':'background:rgba(96,165,250,0.12);color:#60a5fa;border:1px solid rgba(96,165,250,0.25)'}">${o.status}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06)">
          <div><div style="font-size:10px;color:rgba(255,255,255,0.35)">Article</div><div style="font-size:12px;font-weight:500;color:white;margin-top:2px">${o.productName||'—'} <span style="opacity:0.4">×${o.qty||1}</span></div></div>
          <div style="text-align:right"><div style="font-size:10px;color:rgba(255,255,255,0.35)">Profit</div><div style="font-size:13px;font-weight:700;color:${parseFloat(profit)>=0?'#34d399':'#f87171'};margin-top:2px">€${profit}</div></div>
        </div>
        <button onclick="markAsShipped('${o.id}')" class="todo-btn ${isEncours?'todo-btn-expedie':'todo-btn-livre'}">
          ${isEncours?`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Passer en expédié`:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Marquer comme livré`}
        </button>`;
      tc2.appendChild(c);
    });
  }

  if(window.lucide)lucide.createIcons();
  updateSidebarBadge();renderTopProducts(filtered);renderSVGChart(filtered);
  renderTresoSparkline();
  // Trend badges
  if(sc&&prev){
    setTrend('trend-profit', cur.netProfit, prev.netProfit);
    setTrend('trend-revenue', cur.revenue, prev.revenue);
    setTrend('trend-orders', cur.orderCount, prev.orderCount);
    setTrend('trend-basket', cur.avgBasket, prev.avgBasket);
    setTrend('trend-margin', cur.marginRate, prev.marginRate);
  }
}
function markAsShipped(id){const o=orders.find(o=>o.id===id);if(!o)return;if(o.status==='Livré'){showToast(`Déjà livrée`,'warn');return;}o.status=o.status==='En cours'?'Expédié':'Livré';saveOrders();renderOrders();updateDashboardMetrics();showToast(`${o.customer} → ${o.status}`);}
// Helper pour les paths SVG Lucide inline
function getLucidePath(icon) {
  const paths = {
    'calendar':'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    'trending-up':'<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    'bar-chart-2':'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    'shopping-bag':'<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>',
    'credit-card':'<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    'percent':'<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    'landmark':'<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
    'target':'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'trophy':'<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="18" width="12" height="4"/>',
  };
  return paths[icon] || '';
}

// Top products rank icons
const RANK_ICONS = [
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="#fbbf24" stroke="none"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`,
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(255,255,255,0.5)" stroke="none"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`,
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="#cd7c2f" stroke="none"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`,
  `<svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(255,255,255,0.25)" stroke="none"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`,
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="rgba(255,255,255,0.18)" stroke="none"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`,
];

function renderTopProducts(fo){
  const con=document.getElementById('top-products-container'),pe=document.getElementById('top-products-period');if(!con)return;
  const map={};fo.forEach(o=>{if(!map[o.productName])map[o.productName]={revenue:0,qty:0};map[o.productName].revenue+=o.totalReceived;map[o.productName].qty+=(o.qty||1);});
  const sorted=Object.entries(map).map(([n,d])=>({name:n,...d})).sort((a,b)=>b.revenue-a.revenue).slice(0,5);
  if(pe)pe.textContent=activeMonthFilter==='all'?'Toutes périodes':(()=>{const[y,m]=activeMonthFilter.split('-');return new Date(+y,+m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});})();
  con.innerHTML='';if(sorted.length===0){con.innerHTML='<p class="text-sm opacity-40 italic">Aucune commande.</p>';return;}
  const mx=sorted[0].revenue,me=RANK_ICONS;
  sorted.forEach((p,i)=>{
    const pct=mx>0?(p.revenue/mx)*100:0;
    const barColors=['#fbbf24','rgba(255,255,255,0.6)','#cd7c2f','rgba(255,255,255,0.4)','rgba(255,255,255,0.3)'];
    const d=document.createElement('div');
    d.className='flex items-center gap-3';
    d.style.animation=`ai-item-in 0.3s ${i*60}ms both`;
    d.innerHTML=`<span class="text-sm w-5 text-center flex-shrink-0">${me[i]}</span><span class="text-sm text-white font-medium w-36 truncate flex-shrink-0" title="${p.name}">${p.name}</span><div class="top-bar-track flex-1"><div class="top-bar-fill" style="width:0%;background:${barColors[i]||'rgba(52,211,153,0.8)'}"></div></div><span class="text-xs text-gray-400 w-16 text-right flex-shrink-0">${p.qty} vendus</span><span class="text-sm font-semibold text-emerald-400 w-20 text-right flex-shrink-0" title="€${p.revenue.toFixed(2)}">${fmtEur(p.revenue)}</span>`;
    con.appendChild(d);
    // Anime la barre depuis 0
    setTimeout(()=>{const fill=d.querySelector('.top-bar-fill');if(fill)fill.style.width=`${pct.toFixed(1)}%`;}, 100 + i*80);
  });
}
function exportOrdersCSV(){
  const f=getFilteredOrders();if(f.length===0)return showToast('Aucune commande à exporter','warn');
  const hd=['Date','Client','Article','Quantité','Montant (€)','Statut'];
  const rows=[...f].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(o=>[formatDate(o.date),`"${o.customer.replace(/"/g,'""')}"`,`"${o.productName.replace(/"/g,'""')}"`,o.qty||1,o.totalReceived.toFixed(2),o.status]);
  const csv=[hd,...rows].map(r=>r.join(';')).join('\n'),blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob);
  const today=new Date().toISOString().split('T')[0],period=activeMonthFilter==='all'?'toutes-periodes':activeMonthFilter;
  const a=document.createElement('a');a.href=url;a.download=`dropcontrol_orders_${period}_${today}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
document.getElementById('btn-export-csv').addEventListener('click',exportOrdersCSV);

// Status filter buttons
document.querySelectorAll('#status-filters .status-filter-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    orderStatusFilter=btn.dataset.filter;
    document.querySelectorAll('#status-filters .status-filter-btn').forEach(b=>b.className='status-filter-btn');
    const cls={'all':'active-all','En cours':'active-encours','Expédié':'active-expedie','Livré':'active-livre'};
    btn.classList.add(cls[orderStatusFilter]||'active-all');
    renderOrders();
  });
});

const reapproModal=document.getElementById('reappro-modal');let reapproStockId=null;
function openReapproModal(id){const s=stocks.find(s=>s.id===id);if(!s)return;reapproStockId=id;document.getElementById('reappro-stock-name').textContent=`${s.name} — ${s.currentQty} u. en stock`;document.getElementById('reappro-qty').value=10;document.getElementById('reappro-cost').value=0;showModal(reapproModal);}
document.getElementById('btn-reappro-cancel').addEventListener('click',()=>{hideModal(reapproModal);reapproStockId=null;});
document.getElementById('btn-reappro-confirm').addEventListener('click',()=>{
  const s=stocks.find(s=>s.id===reapproStockId);if(!s)return;
  const aq=parseInt(document.getElementById('reappro-qty').value)||0,ac=parseFloat(document.getElementById('reappro-cost').value)||0;
  if(aq<=0)return showToast('Quantité > 0 requise','warn');
  s.currentQty+=aq;s.initialQty+=aq;s.totalCost+=ac;s.unitCost=s.initialQty>0?s.totalCost/s.initialQty:0;
  saveStocks();hideModal(reapproModal);reapproStockId=null;renderStock();populateOrderSelect();updateDashboardMetrics();showToast(`Réappro « ${s.name} » : +${aq} u.`);
});

function renderSVGChart(fo){
  const svg=document.getElementById('chart-svg');if(!svg)return;
  ['chart-ca-fill','chart-profit-fill','chart-ca-path','chart-profit-path','chart-goal-line','chart-goal-label','chart-dots-group','chart-tooltip','chart-legend','chart-area-fill','chart-polyline'].forEach(id=>{const e=document.getElementById(id);if(e)e.remove();});
  const tm=document.getElementById('chart-txt-max'),mi=document.getElementById('chart-txt-mid');
  if(fo.length===0){if(tm)tm.textContent='€0';if(mi)mi.textContent='€0';return;}
  const NS='http://www.w3.org/2000/svg';
  const sorted=[...fo].sort((a,b)=>new Date(a.date)-new Date(b.date));
  let cumCA=0,cumProfit=0;
  const pts=sorted.map(o=>{
    cumCA+=o.totalReceived;
    const fee=(o.feeFixedAtTime??currentConfig.feeFixed)+o.totalReceived*((o.feePctAtTime??currentConfig.feePercent)/100);
    const cost=(o.unitCostItem??0)*(o.qty||1);
    cumProfit+=o.totalReceived-fee-cost;
    return{order:o,cumCA,cumProfit};
  });
  const maxCA=cumCA,goal=currentConfig.monthlyGoal||0;
  const axM=Math.max(maxCA,goal)*1.1||100,axH=axM/2;
  if(tm)tm.textContent=fmtEur(Math.round(axM));if(mi)mi.textContent=fmtEur(Math.round(axH));
  const XS=50,XE=600,YT=20,YB=190,W=XE-XS,H=YB-YT;
  const tx=i=>pts.length>1?XS+(i/(pts.length-1))*W:XS+W/2;
  const ty=v=>YB-(Math.max(0,v)/axM)*H;
  const caP=pts.map((p,i)=>({x:tx(i),y:ty(p.cumCA),...p}));
  const prP=pts.map((p,i)=>({x:tx(i),y:ty(p.cumProfit),...p}));

  // Defs & gradients
  let defs=svg.querySelector('defs');if(!defs){defs=document.createElementNS(NS,'defs');svg.insertBefore(defs,svg.firstChild);}
  [['gca','96,165,250'],['gpr','52,211,153']].forEach(([id,rgb])=>{
    if(!document.getElementById(id)){const g=document.createElementNS(NS,'linearGradient');g.setAttribute('id',id);g.setAttribute('x1','0');g.setAttribute('y1','0');g.setAttribute('x2','0');g.setAttribute('y2','1');g.innerHTML=`<stop offset="0%" stop-color="rgba(${rgb},0.22)"/><stop offset="100%" stop-color="rgba(${rgb},0)"/>`;defs.appendChild(g);}
  });

  // Smooth bezier path
  function curvePath(ps){
    if(!ps.length)return'';
    if(ps.length===1)return`M${ps[0].x.toFixed(1)} ${ps[0].y.toFixed(1)}`;
    let d=`M${ps[0].x.toFixed(1)} ${ps[0].y.toFixed(1)}`;
    for(let i=1;i<ps.length;i++){const p=ps[i-1],c=ps[i],cpx=((p.x+c.x)/2).toFixed(1);d+=` C${cpx} ${p.y.toFixed(1)} ${cpx} ${c.y.toFixed(1)} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;}
    return d;
  }
  function areaPath(ps,fill){return`${curvePath(ps)} L${ps[ps.length-1].x.toFixed(1)} ${YB} L${ps[0].x.toFixed(1)} ${YB} Z`;}

  // Area fills
  const caFill=document.createElementNS(NS,'path');caFill.setAttribute('id','chart-ca-fill');caFill.setAttribute('d',areaPath(caP));caFill.setAttribute('fill','url(#gca)');svg.appendChild(caFill);
  const prFill=document.createElementNS(NS,'path');prFill.setAttribute('id','chart-profit-fill');prFill.setAttribute('d',areaPath(prP));prFill.setAttribute('fill','url(#gpr)');svg.appendChild(prFill);

  // Animated curves
  function animCurve(id,ps,stroke,delay){
    const p=document.createElementNS(NS,'path');p.setAttribute('id',id);p.setAttribute('d',curvePath(ps));p.setAttribute('fill','none');p.setAttribute('stroke',stroke);p.setAttribute('stroke-width','2');p.setAttribute('stroke-linecap','round');p.setAttribute('filter',`drop-shadow(0 0 3px ${stroke})`);
    p.style.strokeDasharray='2000';p.style.strokeDashoffset='2000';p.style.transition=`stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1) ${delay}ms`;
    svg.appendChild(p);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{p.style.strokeDashoffset='0';}));
  }
  animCurve('chart-ca-path',caP,'rgba(96,165,250,0.9)',0);
  animCurve('chart-profit-path',prP,'rgba(52,211,153,0.9)',200);

  // Goal line
  if(goal>0&&goal<=axM){const gy=ty(goal),gr=maxCA>=goal,gc=gr?'rgba(52,211,153,0.7)':'rgba(251,191,36,0.7)';const gl=document.createElementNS(NS,'line');gl.setAttribute('id','chart-goal-line');gl.setAttribute('x1',XS);gl.setAttribute('x2',XE);gl.setAttribute('y1',gy);gl.setAttribute('y2',gy);gl.setAttribute('stroke',gc);gl.setAttribute('stroke-width','1');gl.setAttribute('stroke-dasharray','6,4');svg.appendChild(gl);const gL=document.createElementNS(NS,'text');gL.setAttribute('id','chart-goal-label');gL.setAttribute('x',XE-2);gL.setAttribute('y',gy-4);gL.setAttribute('fill',gc);gL.setAttribute('font-size','10');gL.setAttribute('text-anchor','end');gL.setAttribute('font-weight','600');gL.textContent=gr?`✓ Objectif ${fmtEur(goal)}`:`Objectif ${fmtEur(goal)}`;svg.appendChild(gL);}

  // Legend
  const leg=document.createElementNS(NS,'g');leg.setAttribute('id','chart-legend');
  leg.innerHTML=`<circle cx="${XS+2}" cy="10" r="4" fill="rgba(96,165,250,0.9)"/><text x="${XS+10}" y="14" fill="rgba(96,165,250,0.9)" font-size="10" font-weight="600">CA</text><circle cx="${XS+38}" cy="10" r="4" fill="rgba(52,211,153,0.9)"/><text x="${XS+46}" y="14" fill="rgba(52,211,153,0.9)" font-size="10" font-weight="600">Profit</text>`;
  svg.appendChild(leg);

  // Rich tooltip
  const tg=document.createElementNS(NS,'g');tg.setAttribute('id','chart-tooltip');tg.setAttribute('pointer-events','none');tg.style.display='none';
  const tr2=document.createElementNS(NS,'rect');tr2.setAttribute('rx','8');tr2.setAttribute('fill','rgba(10,10,18,0.97)');tr2.setAttribute('stroke','rgba(255,255,255,0.1)');tr2.setAttribute('stroke-width','1');tr2.setAttribute('width','170');tr2.setAttribute('height','90');
  const els={date:['rgba(255,255,255,0.4)','9'],ca:['rgba(96,165,250,0.95)','11'],profit:['rgba(52,211,153,0.95)','11'],marge:['rgba(255,255,255,0.4)','9'],client:['rgba(255,255,255,0.3)','9']};
  const tel={};Object.entries(els).forEach(([k,[fill,fs]])=>{const t=document.createElementNS(NS,'text');t.setAttribute('fill',fill);t.setAttribute('font-size',fs);tel[k]=t;});
  tg.append(tr2,...Object.values(tel));

  // Dots + hover
  const dg=document.createElementNS(NS,'g');dg.setAttribute('id','chart-dots-group');
  caP.forEach((c,i)=>{
    const pp=prP[i];
    const mkDot=(cx,cy,color)=>{const d=document.createElementNS(NS,'circle');d.setAttribute('cx',cx);d.setAttribute('cy',cy);d.setAttribute('r','4');d.setAttribute('fill',color);d.setAttribute('stroke','rgba(10,10,18,1)');d.setAttribute('stroke-width','2');d.style.transition='r 0.15s';return d;};
    const cd=mkDot(c.x.toFixed(1),c.y.toFixed(1),'rgba(96,165,250,1)');
    const pd=mkDot(c.x.toFixed(1),pp.y.toFixed(1),'rgba(52,211,153,1)');
    const ha=document.createElementNS(NS,'rect');ha.setAttribute('x',(c.x-12).toFixed(1));ha.setAttribute('y',Math.min(c.y,pp.y)-12);ha.setAttribute('width','24');ha.setAttribute('height',Math.abs(c.y-pp.y)+24);ha.setAttribute('fill','transparent');ha.style.cursor='pointer';
    ha.addEventListener('mouseenter',()=>{
      cd.setAttribute('r','6');pd.setAttribute('r','6');
      const o=c.order;
      const fee=(o.feeFixedAtTime??currentConfig.feeFixed)+o.totalReceived*((o.feePctAtTime??currentConfig.feePercent)/100);
      const cost=(o.unitCostItem??0)*(o.qty||1);
      const np=o.totalReceived-fee-cost;
      const marge=o.totalReceived>0?(np/o.totalReceived*100).toFixed(1):'0';
      let ttx=c.x+16;if(ttx+170>XE)ttx=c.x-186;
      let tty=Math.min(c.y,pp.y)-98;if(tty<5)tty=Math.min(c.y,pp.y)+10;
      tr2.setAttribute('x',ttx);tr2.setAttribute('y',tty);
      const setT=(k,x,y,txt)=>{tel[k].setAttribute('x',ttx+x);tel[k].setAttribute('y',tty+y);tel[k].textContent=txt;};
      setT('date',10,16,o.date?new Date(o.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'');
      setT('ca',10,33,`CA   ${fmtEur(o.totalReceived)}  · cumul ${fmtEur(c.cumCA)}`);
      setT('profit',10,50,`Profit   ${fmtEur(np)}  · cumul ${fmtEur(c.cumProfit)}`);
      setT('marge',10,64,`Marge ${marge}%  · x${o.qty||1} article`);
      setT('client',10,78,`${o.customer.length>22?o.customer.slice(0,21)+'…':o.customer} — ${o.productName?.slice(0,18)||''}`);
      tg.style.display='block';
    });
    ha.addEventListener('mouseleave',()=>{cd.setAttribute('r','4');pd.setAttribute('r','4');tg.style.display='none';});
    dg.append(cd,pd,ha);
  });
  svg.appendChild(dg);
  svg.appendChild(tg); // tooltip toujours au premier plan
}

const deleteModal=document.getElementById('delete-modal');
function openDeleteModal(type,id){itemToDelete={type,id};showModal(deleteModal);}
document.getElementById('btn-cancel-delete').addEventListener('click',()=>{hideModal(deleteModal);itemToDelete=null;});
document.getElementById('btn-confirm-delete').addEventListener('click',()=>{
  if(!itemToDelete)return;const{type,id}=itemToDelete;
  if(type==='stock'){const lo=orders.filter(o=>o.stockId===id);if(lo.length>0){orders.forEach(o=>{if(o.stockId===id)o.stockId=null;});saveOrders();}stocks=stocks.filter(s=>s.id!==id);saveStocks();renderStock();populateOrderSelect();renderOrders();showToast(lo.length>0?`Lot supprimé — ${lo.length} commande(s) conservée(s)`:'Lot supprimé','success');}
  else if(type==='product'){products=products.filter(p=>p.id!==id);saveProducts();renderProducts();showToast('Produit supprimé du catalogue');}
  else if(type==='order'){const od=orders.find(o=>o.id===id);if(od){const st=stocks.find(s=>s.id===od.stockId);if(st){st.currentQty+=(od.qty||1);saveStocks();}}orders=orders.filter(o=>o.id!==id);saveOrders();buildMonthSelector();renderStock();populateOrderSelect();renderOrders();showToast('Commande supprimée','success');}
  updateDashboardMetrics();hideModal(deleteModal);itemToDelete=null;
});

// ─── SETTINGS TABS ────────────────────────────────────────
const tabColors = {
  business:['rgba(52,211,153,0.1)','rgba(52,211,153,0.2)','#34d399'],
  payment: ['rgba(96,165,250,0.1)','rgba(96,165,250,0.2)','#60a5fa'],
  ia:      ['rgba(139,92,246,0.1)','rgba(139,92,246,0.2)','#a78bfa'],
  data:    ['rgba(251,191,36,0.1)','rgba(251,191,36,0.2)','#fbbf24'],
};
const tabMeta = {
  business:['Business','Objectifs et alertes'],
  payment: ['Paiement','Frais et passerelle'],
  ia:      ['Intelligence IA','Modèle et clé API'],
  data:    ['Données','Sauvegarde et restauration'],
};

function switchSettingsTab(tab) {
  // Reset all tabs
  ['business','payment','ia','data'].forEach(t => {
    const btn = document.getElementById(`stab-${t}`);
    if (btn) { btn.style.background='transparent'; btn.style.color='rgba(255,255,255,0.45)'; btn.style.borderColor='transparent'; }
    document.getElementById(`spanel-${t}`)?.classList.add('hidden');
  });
  // Activate selected
  const [bg,border,color] = tabColors[tab]||tabColors.business;
  const btn = document.getElementById(`stab-${tab}`);
  if (btn) { btn.style.background=bg; btn.style.color=color; btn.style.borderColor=border; }
  document.getElementById(`spanel-${tab}`)?.classList.remove('hidden');
  const [title,sub] = tabMeta[tab]||tabMeta.business;
  document.getElementById('stab-title').textContent = title;
  document.getElementById('stab-sub').textContent = sub;
  if (window.lucide) lucide.createIcons();
}

const settingsModal=document.getElementById('settings-modal');
function loadSettingsInputs(){
  document.getElementById('set-fee-fixed').value=currentConfig.feeFixed;document.getElementById('set-fee-percent').value=currentConfig.feePercent;
  document.getElementById('set-stock-alert').value=currentConfig.stockAlert;document.getElementById('set-monthly-goal').value=currentConfig.monthlyGoal;
  document.getElementById('set-initial-capital').value=currentConfig.initialCapital||0;buildPurgeMonthSelect();
  const gd=document.getElementById('settings-gemini-display');
  if(gd)gd.textContent=GEMINI_KEY?`••••••••••••${GEMINI_KEY.slice(-8)}`:'Non configurée';
  const ms=document.getElementById('set-gemini-model');
  if(ms)ms.value=GEMINI_MODEL;
  switchSettingsTab('business');
}
function buildPurgeMonthSelect(){
  const sel=document.getElementById('purge-month-select');if(!sel)return;
  const ms=new Set();orders.forEach(o=>{if(!o.date)return;const d=new Date(o.date);ms.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);});
  const months=[...ms].sort((a,b)=>b.localeCompare(a));sel.innerHTML='<option value="">— Choisir un mois —</option>';
  months.forEach(m=>{const[y,mo]=m.split('-'),label=new Date(+y,+mo-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'}),cnt=orders.filter(o=>{if(!o.date)return false;const d=new Date(o.date);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`===m;}).length;const opt=document.createElement('option');opt.value=m;opt.textContent=`${label.charAt(0).toUpperCase()+label.slice(1)} (${cnt} cmd)`;sel.appendChild(opt);});
}
document.getElementById('btn-settings-open').addEventListener('click',()=>{loadSettingsInputs();showModal(settingsModal);});
document.getElementById('btn-settings-close').addEventListener('click',()=>hideModal(settingsModal));
document.getElementById('btn-settings-close-x').addEventListener('click',()=>hideModal(settingsModal));
document.getElementById('btn-settings-save').addEventListener('click', async ()=>{
  currentConfig.feeFixed=parseFloat(document.getElementById('set-fee-fixed').value)||0;currentConfig.feePercent=parseFloat(document.getElementById('set-fee-percent').value)||0;
  currentConfig.stockAlert=parseInt(document.getElementById('set-stock-alert').value)||0;currentConfig.monthlyGoal=parseFloat(document.getElementById('set-monthly-goal').value)||0;
  currentConfig.initialCapital=parseFloat(document.getElementById('set-initial-capital').value)||0;
  // Modèle Gemini
  const selectedModel = document.getElementById('set-gemini-model')?.value;
  if (selectedModel && selectedModel !== GEMINI_MODEL) {
    GEMINI_MODEL = selectedModel;
    await dbSave('gemini_model', selectedModel);
    showToast('Modèle mis à jour — rechargez la page pour l\'appliquer', 'warn');
  }
  saveConfig();hideModal(settingsModal);calculateSimulator();updateDashboardMetrics();renderStock();
  if (!selectedModel || selectedModel === GEMINI_MODEL) showToast('Configuration enregistrée');
});
document.getElementById('btn-export-data').addEventListener('click',()=>{
  const bk={_app:'DropControl',_version:2,_exportedAt:new Date().toISOString(),dc_stocks:JSON.stringify(stocks),dc_products:JSON.stringify(products),dc_orders:JSON.stringify(orders),dropControlConfig:JSON.stringify(currentConfig)};
  const today=new Date().toISOString().split('T')[0];const a=document.createElement('a');a.href='data:text/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(bk,null,2));a.download=`dropcontrol_backup_${today}.json`;document.body.appendChild(a);a.click();a.remove();showToast('Sauvegarde exportée','success');
});
document.getElementById('btn-trigger-import').addEventListener('click',()=>document.getElementById('input-import-file').click());
document.getElementById('input-import-file').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;const r=new FileReader();
  r.onload=async ev=>{let imp;try{imp=JSON.parse(ev.target.result);}catch{showToast('JSON invalide','error');return;}
  const kk=['dc_stocks','dc_products','dc_orders','dropControlConfig'];if(!kk.some(k=>imp[k]!==undefined)){showToast('Pas une sauvegarde DropControl','error');return;}
  try{kk.forEach(k=>{if(imp[k]!==undefined)JSON.parse(imp[k]);});}catch{showToast('Sauvegarde corrompue','error');return;}
  // Restore local
  kk.forEach(k=>{if(imp[k]!==undefined)try{localStorage.setItem(k,imp[k]);}catch{}});
  // Push vers Supabase
  for(const k of kk){
    if(imp[k]!==undefined){
      try{await dbSave(k,JSON.parse(imp[k]));}catch{}
    }
  }
  showToast('Restaurée — redémarrage…','success');setTimeout(()=>window.location.reload(),900);};r.readAsText(f);e.target.value='';
});
const brd=document.getElementById('btn-reset-data');
if(brd)brd.addEventListener('click',async()=>{
  if(!confirm('⚠️ Effacer DÉFINITIVEMENT toutes les données ?'))return;
  stocks=[];products=[];orders=[];currentConfig={feeFixed:0,feePercent:2.0,stockAlert:3,monthlyGoal:1000,initialCapital:0};
  // Efface localement et dans le cloud
  ['dc_stocks','dc_products','dc_orders','dropControlConfig','dc_pwd_hash'].forEach(k=>{try{localStorage.removeItem(k);}catch{}});
  await dbSave('dc_stocks',[]);
  await dbSave('dc_products',[]);
  await dbSave('dc_orders',[]);
  await dbSave('dropControlConfig',currentConfig);
  showToast('Réinitialisé','success');setTimeout(()=>window.location.reload(),600);
});
const bpm=document.getElementById('btn-purge-month');
if(bpm)bpm.addEventListener('click',()=>{
  const k=document.getElementById('purge-month-select').value;if(!k)return showToast('Choisissez un mois','warn');
  const td=orders.filter(o=>{if(!o.date)return false;const d=new Date(o.date);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`===k;});if(td.length===0)return showToast('Aucune commande pour ce mois','warn');
  const[y,mo]=k.split('-'),label=new Date(+y,+mo-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});if(!confirm(`⚠️ Effacer ${td.length} commande(s) de ${label} ?`))return;
  td.forEach(o=>{const st=stocks.find(s=>s.id===o.stockId);if(st)st.currentQty+=(o.qty||1);});const di=new Set(td.map(o=>o.id));orders=orders.filter(o=>!di.has(o.id));
  saveStocks();saveOrders();buildMonthSelector();buildPurgeMonthSelect();renderStock();populateOrderSelect();renderOrders();updateDashboardMetrics();showToast(`${td.length} commande(s) de ${label} supprimée(s)`,'success');
});

document.addEventListener('DOMContentLoaded', async () => {
  initSplash();
  const splashStart = Date.now();
  let hasSession = false;
  try {
    await initStorage();
    const { data } = await db.auth.getSession();
    hasSession = !!data?.session;
  } catch(e) {
    console.error('Init error:', e);
  } finally {
    const elapsed = Date.now() - splashStart;
    const minTime = hasSession ? 400 : 1800;
    const wait = Math.max(0, minTime - elapsed);
    setTimeout(() => {
      hideLoader(hasSession);
      initLockScreen(startApp);
    }, wait);
  }
});
function startApp(){
  const now=new Date(),ck=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  activeMonthFilter=orders.some(o=>{if(!o.date)return false;const d=new Date(o.date);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`===ck;})?ck:'all';
  buildMonthSelector();renderStock();populateOrderSelect();renderProducts();renderOrders();calculateSimulator();updateDashboardMetrics();
  // Animation d'entrée du dashboard
  const main = document.querySelector('main');
  const sidebar = document.querySelector('aside');
  if(main){main.style.opacity='0';main.style.transform='translateY(16px)';requestAnimationFrame(()=>{main.style.transition='opacity 0.6s 0.1s ease,transform 0.6s 0.1s cubic-bezier(0.2,0.9,0.3,1)';main.style.opacity='1';main.style.transform='none';});}
  if(sidebar){sidebar.style.opacity='0';requestAnimationFrame(()=>{sidebar.style.transition='opacity 0.5s ease';sidebar.style.opacity='1';});}
  setTimeout(()=>{ initAllCustomSelects(); initAllSteppers(); }, 150);
  // Engrenage settings — accélère au hover, ralentit au départ, pause si onglet masqué
  setTimeout(()=>{
    const gearBtn=document.getElementById('btn-settings-open');
    const gi=document.getElementById('gear-icon');
    if(gearBtn&&gi){
      let speed=0,target=0,angle=0,last=null,running=true;
      gi.style.transformOrigin='50% 50%';
      const anim=(ts)=>{
        if(!running){last=null;requestAnimationFrame(anim);return;}
        if(last!==null){
          const dt=Math.min(ts-last,50);
          speed+=(target-speed)*0.06;
          angle=(angle+speed*dt/1000*360)%360;
          gi.style.transform=`rotate(${angle.toFixed(2)}deg)`;
        }
        last=ts;
        requestAnimationFrame(anim);
      };
      gearBtn.addEventListener('mouseenter',()=>{target=2;});
      gearBtn.addEventListener('mouseleave',()=>{target=0;});
      document.addEventListener('visibilitychange',()=>{running=!document.hidden;});
      requestAnimationFrame(anim);
    }
  }, 200);

  // Sync temps réel entre appareils
  initRealtime();
  function refreshDate(){
    const d=new Date(),ds=d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}),ts=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    ['header-date','dash-date'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=ds;});
    ['header-time','dash-time'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=ts;});
  }
  refreshDate();setInterval(refreshDate,30000);
  const si=document.getElementById('order-search');if(si){let t=null;si.addEventListener('input',e=>{orderSearchQuery=e.target.value;clearTimeout(t);t=setTimeout(renderOrders,120);});}
  document.getElementById('btn-market-analyze')?.addEventListener('click', analyzeMarketInline);

  document.getElementById('btn-price-close')?.addEventListener('click', ()=>{});
  document.getElementById('btn-price-retry')?.addEventListener('click', resetMarketInline);

  // Import facture IA
  const btnImportInvoice = document.getElementById('btn-import-invoice');
  if (btnImportInvoice) btnImportInvoice.addEventListener('click', (e) => {
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = btnImportInvoice.getBoundingClientRect();
    ripple.style.left = (e.clientX - rect.left) + 'px';
    ripple.style.top = (e.clientY - rect.top) + 'px';
    btnImportInvoice.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
    resetImportModal();
    showModal(document.getElementById('import-invoice-modal'));
    // Relance l'animation d'entrée de la card
    const card = document.querySelector('.ai-modal-card');
    if (card) { card.style.animation='none'; void card.offsetWidth; card.style.animation=''; }
    if (window.lucide) lucide.createIcons();
  });
  document.getElementById('btn-import-invoice-close')?.addEventListener('click', closeAIModal);
  document.getElementById('btn-import-cancel')?.addEventListener('click', closeAIModal);
  document.getElementById('btn-import-confirm')?.addEventListener('click', confirmImport);
  document.getElementById('import-file-input')?.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) analyzeInvoice(f);
  });
  // Drag & drop sur la zone upload
  const uploadZone = document.getElementById('import-upload-zone');
  if (uploadZone) {
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-active'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-active'));
    uploadZone.addEventListener('drop', e => {
      e.preventDefault(); uploadZone.classList.remove('drag-active');
      const f = e.dataTransfer.files[0];
      if (f) analyzeInvoice(f);
    });
  }

  // Bottom nav mobile
  ['dashboard','stock','products','orders'].forEach(k=>{
    const btn=document.getElementById('mob-'+k);
    if(btn) btn.addEventListener('click',()=>switchView(k));
  });

  // Détection clavier iOS — cache la bottom nav quand le clavier est visible
  if ('visualViewport' in window) {
    window.visualViewport.addEventListener('resize', () => {
      const keyboardVisible = window.visualViewport.height < window.innerHeight * 0.8;
      document.body.classList.toggle('keyboard-open', keyboardVisible);
    });
  }

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', async () => {
    await db.auth.signOut();
    hideModal(document.getElementById('settings-modal'));
    // Transition fluide vers la page de connexion
    const main = document.querySelector('main');
    const sidebar = document.querySelector('aside');
    [main, sidebar].forEach(el => { if(el){el.style.transition='opacity 0.4s ease';el.style.opacity='0';} });
    setTimeout(() => {
      const lock = document.getElementById('lock-screen');
      if (lock) {
        lock.style.opacity = '0';
        lock.style.display = 'flex';
        requestAnimationFrame(() => {
          lock.style.transition = 'opacity 0.5s ease';
          lock.style.opacity = '1';
        });
        // Reset lock card
        const card = lock.querySelector('.lock-card');
        if (card) { card.style.opacity='1'; card.style.transform='none'; card.style.filter='none'; }
        document.getElementById('lock-email').value = '';
        document.getElementById('lock-input').value = '';
        document.getElementById('lock-error').textContent = '';
      }
      [main, sidebar].forEach(el => { if(el) el.style.opacity='0'; });
    }, 400);
  });
}
