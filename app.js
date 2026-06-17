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

// Loader UI
function hideLoader() {
  const l = document.getElementById('app-loader');
  if (!l) return;
  l.style.opacity = '0';
  setTimeout(() => l.style.display = 'none', 320);
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

// ─── DROP AI ─────────────────────────────────────────────
function openDropAI() {
  const overlay = document.getElementById('dropai-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.classList.add('modal-open');
  setTimeout(() => document.getElementById('dai-input')?.focus(), 400);
  if (window.lucide) lucide.createIcons();
}

function closeDropAI() {
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
      plateforme: 'Vinted',
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
  document.getElementById('dai-empty')?.remove();
  const msgs = document.getElementById('dai-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'dai-msg-user';
  div.innerHTML = `<div class="dai-msg-user-bubble">${text}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function addTypingIndicator() {
  const msgs = document.getElementById('dai-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'dai-typing'; div.id = 'dai-typing';
  div.innerHTML = `<div class="dai-typing-avatar">🤖</div><div class="dai-typing-dots"><div class="dai-dot"></div><div class="dai-dot"></div><div class="dai-dot"></div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTypingIndicator() {
  document.getElementById('dai-typing')?.remove();
}

function addAIMessage(html) {
  const msgs = document.getElementById('dai-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'dai-msg-ai';
  div.innerHTML = `<div class="dai-msg-ai-avatar">🤖</div><div class="dai-msg-ai-bubble" style="animation:typewriter-reveal 0.5s ease both">${html}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.4,maxOutputTokens:800} })
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Réponse vide');
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
  const cost    = parseFloat(document.getElementById('inp-cost')?.value);
  const selling = parseFloat(document.getElementById('inp-selling')?.value) || 0;
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

  try {
    const prompt = `Tu es un expert en revente de seconde main en France en 2026. Tu connais les prix pratiqués sur Vinted, Leboncoin, eBay France, Depop et les marchés aux puces.

Article : ${name}
Coût d'achat réel : €${cost.toFixed(2)} par unité
Prix de vente testé : €${selling.toFixed(2)}
Catégorie : ${cat}
État : ${etat}
${det ? `Détails : ${det}` : ''}

IMPORTANT : Sois honnête et objectif. Si tu manques d'information sur cet article précis, dis-le clairement plutôt que d'inventer des chiffres. Base-toi sur des articles similaires si nécessaire.

Donne une recommandation de prix de vente sur le marché de revente français (Vinted, Leboncoin, eBay FR), avec une marge raisonnable pour un petit revendeur.

Réponds UNIQUEMENT en JSON valide sans backticks :
{"prix_min":4.90,"prix_optimal":7.90,"prix_max":11.90,"marge_min":"72%","marge_optimal":"84%","marge_max":"91%","explication":"2-3 phrases honnêtes","conseils":["Conseil 1","Conseil 2","Conseil 3"]}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.3} })
    });
    if (!res.ok) throw new Error(`Erreur API: ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Réponse vide');
    const result = JSON.parse(text.replace(/```json|```/g,'').trim());

    clearInterval(window._marketStageInterval);
    document.getElementById('market-loading')?.classList.add('hidden');
    // Cache le formulaire pour remonter les résultats
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
  if (sub && name) sub.textContent = `${name} · Vinted · Leboncoin · eBay FR`;

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
let GEMINI_KEY = null; // chargée depuis Supabase au démarrage
let importedItems = [];

async function loadGeminiKey() {
  try {
    const { data } = await db.from('dc_data').select('value').eq('key', 'gemini_key').single();
    if (data?.value) GEMINI_KEY = data.value;
  } catch(e) { console.warn('Clé Gemini non trouvée', e); }
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
    screen.style.display = 'none';
    onUnlock();
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

// Formate les grands nombres : €1234 → €1.2K, €1234567 → €1.2M, €1234567890 → €1.2B
function fmtEur(val) {
  const v = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (v >= 1_000_000_000) return `${sign}€${(val/1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `${sign}€${(val/1_000_000).toFixed(1)}M`;
  if (v >= 10_000)        return `${sign}€${(val/1_000).toFixed(1)}K`;
  return `${sign}€${val.toFixed(2)}`;
}
function flashCard(id){const el=document.getElementById(id);if(!el)return;const c=el.closest('.metric-card');if(!c)return;c.classList.remove('flash');void c.offsetWidth;c.classList.add('flash');}

function showToast(msg,type='success'){
  const c=document.getElementById('toast-container');if(!c)return;
  const icons={success:'✅',error:'⛔',warn:'⚠️'};
  const t=document.createElement('div');t.className=`toast toast-${type}`;
  t.innerHTML=`<span class="toast-icon">${icons[type]||'•'}</span><span>${msg}</span>`;
  c.appendChild(t);requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),400);},3200);
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

  // N → nouvelle commande (sans Ctrl pour éviter conflit navigateur)
  if(!ctrl&&!e.shiftKey&&!e.altKey&&(e.key==='n'||e.key==='N')){
    e.preventDefault();switchView('orders');
    setTimeout(()=>{const f=document.getElementById('order-customer');if(f){f.focus();f.scrollIntoView({behavior:'smooth',block:'center'});}},150);
    return;
  }
  // S → nouveau stock
  if(!ctrl&&!e.shiftKey&&!e.altKey&&(e.key==='s'||e.key==='S')){
    e.preventDefault();switchView('stock');
    setTimeout(()=>{const f=document.getElementById('stock-name');if(f){f.focus();f.scrollIntoView({behavior:'smooth',block:'center'});}},150);
    return;
  }

  if(!ctrl)return;
  // Ctrl+1-4 navigation
  if(e.key==='1'){e.preventDefault();switchView('dashboard');}
  if(e.key==='2'){e.preventDefault();switchView('stock');}
  if(e.key==='3'){e.preventDefault();switchView('products');}
  if(e.key==='4'){e.preventDefault();switchView('orders');}
  // Ctrl+, → settings
  if(e.key===','){e.preventDefault();loadSettingsInputs();showModal(document.getElementById('settings-modal'));}
});

// ─── MOIS ─────────────────────────────────────────────────
function buildMonthSelector(){
  const sel=document.getElementById('dash-month-selector');if(!sel)return;
  const ms=new Set();orders.forEach(o=>{if(!o.date)return;const d=new Date(o.date);ms.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);});
  const months=[...ms].sort((a,b)=>b.localeCompare(a));const now=new Date();
  sel.innerHTML='<option value="all">Toutes périodes</option>';
  months.forEach(m=>{const[y,mo]=m.split('-'),label=new Date(+y,+mo-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'}),cur=+y===now.getFullYear()&&+mo===now.getMonth()+1;const opt=document.createElement('option');opt.value=m;opt.innerText=label.charAt(0).toUpperCase()+label.slice(1)+(cur?' (En cours)':' (Archivé)');sel.appendChild(opt);});
  sel.value=activeMonthFilter;
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
    const row=document.createElement('div');row.className='inv-grid-row'+(isLow?' row-low':'');row.style.animationDelay=`${idx*40}ms`;
    row.innerHTML=`
      <div class="inv-name-cell"><div class="inv-avatar">${av}</div><span class="inv-name-txt" title="${s.name}">${s.name}</span></div>
      <div class="inv-cell">€${s.totalCost.toFixed(2)}</div>
      <div class="inv-cell-c">${displayQty}</div>
      <div class="inv-stock ${isLow?'low':'ok'}">${s.currentQty}</div>
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
  if(av.length===0){sel.innerHTML='<option value="">Aucun article disponible</option>';return;}
  av.forEach(s=>{const opt=document.createElement('option');opt.value=s.id;opt.innerText=`${s.name} (Reste : ${s.currentQty})`;sel.appendChild(opt);});
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

function renderOrders(){
  const listEl=document.getElementById('orders-list');if(!listEl)return;listEl.innerHTML='';
  const q=(orderSearchQuery||'').trim().toLowerCase();
  let list=[...orders].reverse();if(q)list=list.filter(o=>(o.customer||'').toLowerCase().includes(q)||(o.productName||'').toLowerCase().includes(q));
  document.getElementById('order-counter').innerText=q?`${list.length} / ${orders.length} Order(s)`:`${orders.length} Order(s) Total`;
  if(list.length===0){listEl.innerHTML=`<div class="orders-empty">${q?'Aucune commande ne correspond.':'Aucune commande pour le moment…'}</div>`;return;}
  const SC={'En cours':'status-encours','Expédié':'status-expedie','Livré':'status-livre'};
  const isMobile=window.innerWidth<=768;

  list.forEach((o,idx)=>{
    const row=document.createElement('div');
    row.className='order-row';row.style.animationDelay=`${idx*30}ms`;
    const dateISO=o.date?new Date(o.date).toISOString().split('T')[0]:'';

    if(isMobile){
      // ── LAYOUT MOBILE : 3 lignes propres ──
      row.innerHTML=`
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div class="order-client-wrap" style="min-width:0;overflow:hidden">
            <div class="order-avatar">${initials(o.customer)}</div>
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
      cClient.innerHTML=`<div class="order-client-wrap"><div class="order-avatar">${initials(o.customer)}</div><div class="order-client-info"><div class="order-customer-name" title="Modifier le nom">${o.customer}</div><span class="order-date" title="Modifier la date">${formatDate(o.date)} ✎</span></div></div>`;
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

// ─── DASHBOARD ────────────────────────────────────────────
function updateDashboardMetrics(){
  const filtered=getFilteredOrders(),cur=computeStats(filtered);
  const sc=activeMonthFilter!=='all',prev=sc?computeStats(getOrdersForMonth(getPrevKey(activeMonthFilter))):null;
  const pe=document.getElementById('dash-profit');pe.innerText=`€${cur.netProfit.toFixed(2)}`;pe.className=`text-2xl font-medium ${cur.netProfit<0?'text-red-400':'text-emerald-400'}`;flashCard('dash-profit');
  const ps=document.getElementById('dash-profit-compare');if(sc&&prev){const d=formatDelta(cur.netProfit,prev.netProfit,true);ps.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}else{const p=currentConfig.monthlyGoal>0?(cur.netProfit/currentConfig.monthlyGoal)*100:0;ps.innerHTML=`${p.toFixed(1)}% de l'objectif (€${currentConfig.monthlyGoal})`;}
  const gb=document.getElementById('dash-goal-bar');if(gb){const g=currentConfig.monthlyGoal>0?Math.max(0,(cur.netProfit/currentConfig.monthlyGoal)*100):0;gb.style.width=`${Math.min(g,100).toFixed(1)}%`;gb.classList.toggle('over',g>=100);}
  document.getElementById('dash-orders').innerText=cur.orderCount;flashCard('dash-orders');
  const os=document.getElementById('dash-orders-compare');if(os){if(sc&&prev){const d=formatDelta(cur.orderCount,prev.orderCount,false);os.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}else{os.innerText='Commandes au total';}}
  const re=document.getElementById('dash-revenue');if(re){re.innerText=`€${cur.revenue.toFixed(2)}`;flashCard('dash-revenue');const rs=document.getElementById('dash-revenue-compare');if(rs){if(sc&&prev){const d=formatDelta(cur.revenue,prev.revenue,true);rs.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}else{rs.innerText='Total encaissé';}}}
  document.getElementById('dash-roi').innerText=`€${cur.avgBasket.toFixed(2)}`;flashCard('dash-roi');
  const bs=document.getElementById('dash-basket-compare');if(bs){if(sc&&prev){const d=formatDelta(cur.avgBasket,prev.avgBasket,true);bs.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}else{bs.innerText='Moyenne par vente';}}
  document.getElementById('dash-margin-rate').innerText=`${cur.marginRate.toFixed(1)}%`;flashCard('dash-margin-rate');
  const ms2=document.getElementById('dash-margin-compare');if(ms2){if(sc&&prev){const d=formatDelta(cur.marginRate,prev.marginRate,false,true);ms2.innerHTML=`<span class="${d.colorClass} font-medium">${d.text}</span>`;}else{ms2.innerText='Santé globale du mois';}}
  const tr=(parseFloat(currentConfig.initialCapital)||0)+orders.reduce((a,o)=>a+o.totalReceived,0)-stocks.reduce((a,s)=>a+s.totalCost,0)-orders.reduce((a,o)=>a+(o.feeFixedAtTime??currentConfig.feeFixed)+(o.totalReceived*((o.feePctAtTime??currentConfig.feePercent)/100)),0);
  document.getElementById('dash-budget-display').innerText=`€${tr.toFixed(2)}`;
  const at=document.getElementById('alert-tbody');at.innerHTML='';const low=stocks.filter(s=>s.currentQty<=currentConfig.stockAlert);
  if(low.length===0){at.innerHTML='<tr><td colspan="3" class="p-4 text-center text-gray-500 italic">Aucune rupture ! 🚀</td></tr>';}
  else{low.forEach(s=>{const tr2=document.createElement('tr');tr2.className='border-b border-white/5';const qc=s.currentQty===0?'text-red-500':'text-red-400';tr2.innerHTML=`<td class="p-2.5 font-medium">${s.name}</td><td class="p-2.5 text-center font-bold ${qc}">${s.currentQty} u</td><td class="p-2.5 text-right"><button onclick="openReapproModal('${s.id}')" class="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 px-2.5 py-0.5 rounded text-[10px] font-medium uppercase transition">+ Réappro</button></td>`;at.appendChild(tr2);});}
  const tc2=document.getElementById('todo-list-container');tc2.innerHTML='';const pend=orders.filter(o=>o.status!=='Livré');
  if(pend.length===0){tc2.innerHTML='<p class="text-sm opacity-40 italic col-span-3">Toutes les commandes livrées ! 🎉</p>';}
  else{pend.forEach(o=>{const c=document.createElement('div');c.className='border border-white/10 bg-white/5 p-4 rounded-xl flex flex-col justify-between space-y-3';c.innerHTML=`<div><div class="flex justify-between items-start"><h5 class="text-white font-medium text-sm">${o.customer}</h5><span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded ${o.status==='En cours'?'bg-amber-500/20 text-amber-300':'bg-blue-500/20 text-blue-300'}">${o.status}</span></div><p class="text-xs text-gray-400 mt-1">${o.productName} <span class="opacity-60">x${o.qty||1}</span></p><p class="text-[11px] text-gray-600 mt-0.5">${formatDate(o.date)}</p></div><button onclick="markAsShipped('${o.id}')" class="w-full text-center text-xs bg-white text-black font-medium py-1.5 rounded-lg hover:bg-gray-200 transition">${o.status==='En cours'?'Passer en expédié':'Marquer comme livré'}</button>`;tc2.appendChild(c);});}
  if(window.lucide)lucide.createIcons();
  updateSidebarBadge();renderTopProducts(filtered);renderSVGChart(filtered);
}
function markAsShipped(id){const o=orders.find(o=>o.id===id);if(!o)return;if(o.status==='Livré'){showToast(`Déjà livrée`,'warn');return;}o.status=o.status==='En cours'?'Expédié':'Livré';saveOrders();renderOrders();updateDashboardMetrics();showToast(`${o.customer} → ${o.status}`);}
function renderTopProducts(fo){
  const con=document.getElementById('top-products-container'),pe=document.getElementById('top-products-period');if(!con)return;
  const map={};fo.forEach(o=>{if(!map[o.productName])map[o.productName]={revenue:0,qty:0};map[o.productName].revenue+=o.totalReceived;map[o.productName].qty+=(o.qty||1);});
  const sorted=Object.entries(map).map(([n,d])=>({name:n,...d})).sort((a,b)=>b.revenue-a.revenue).slice(0,5);
  if(pe)pe.textContent=activeMonthFilter==='all'?'Toutes périodes':(()=>{const[y,m]=activeMonthFilter.split('-');return new Date(+y,+m-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});})();
  con.innerHTML='';if(sorted.length===0){con.innerHTML='<p class="text-sm opacity-40 italic">Aucune commande.</p>';return;}
  const mx=sorted[0].revenue,me=['🥇','🥈','🥉','4.','5.'];
  sorted.forEach((p,i)=>{const pct=mx>0?(p.revenue/mx)*100:0;const d=document.createElement('div');d.className='flex items-center gap-3';d.innerHTML=`<span class="text-sm w-5 text-center flex-shrink-0">${me[i]}</span><span class="text-sm text-white font-medium w-36 truncate flex-shrink-0" title="${p.name}">${p.name}</span><div class="top-bar-track flex-1"><div class="top-bar-fill" style="width:${pct.toFixed(1)}%"></div></div><span class="text-xs text-gray-400 w-16 text-right flex-shrink-0">${p.qty} vendus</span><span class="text-sm font-semibold text-emerald-400 w-20 text-right flex-shrink-0" title="€${p.revenue.toFixed(2)}">${fmtEur(p.revenue)}</span>`;con.appendChild(d);});
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
  ['chart-area-fill','chart-polyline','chart-goal-line','chart-goal-label','chart-dots-group','chart-tooltip'].forEach(id=>{const e=document.getElementById(id);if(e)e.remove();});
  const tm=document.getElementById('chart-txt-max'),mi=document.getElementById('chart-txt-mid');
  if(fo.length===0){if(tm)tm.textContent='€0';if(mi)mi.textContent='€0';return;}
  const sorted=[...fo].sort((a,b)=>new Date(a.date)-new Date(b.date));let cum=0;const pts=sorted.map(o=>{cum+=o.totalReceived;return{order:o,cumul:cum};});
  const mx=cum,goal=currentConfig.monthlyGoal||0,axM=Math.max(mx,goal)*1.1||100,axH=axM/2;
  if(tm)tm.textContent=fmtEur(Math.round(axM));if(mi)mi.textContent=fmtEur(Math.round(axH));
  const XS=50,XE=600,YT=20,YB=190,W=XE-XS,H=YB-YT,NS='http://www.w3.org/2000/svg';
  const tx=i=>pts.length>1?XS+(i/(pts.length-1))*W:XS+W/2,ty=v=>YB-(v/axM)*H;
  const co=pts.map((p,i)=>({x:tx(i),y:ty(p.cumul),order:p.order,cumul:p.cumul}));
  let defs=svg.querySelector('defs');if(!defs){defs=document.createElementNS(NS,'defs');svg.insertBefore(defs,svg.firstChild);}
  if(!document.getElementById('chart-gradient')){const g=document.createElementNS(NS,'linearGradient');g.setAttribute('id','chart-gradient');g.setAttribute('x1','0');g.setAttribute('y1','0');g.setAttribute('x2','0');g.setAttribute('y2','1');g.innerHTML='<stop offset="0%" stop-color="rgba(52,211,153,0.25)"/><stop offset="100%" stop-color="rgba(52,211,153,0)"/>';defs.appendChild(g);}
  const fp=[`${co[0].x},${YB}`,...co.map(c=>`${c.x.toFixed(1)},${c.y.toFixed(1)}`),`${co[co.length-1].x},${YB}`].join(' ');
  const fi=document.createElementNS(NS,'polygon');fi.setAttribute('id','chart-area-fill');fi.setAttribute('points',fp);fi.setAttribute('fill','url(#chart-gradient)');svg.appendChild(fi);
  const pl=document.createElementNS(NS,'polyline');pl.setAttribute('id','chart-polyline');pl.setAttribute('fill','none');pl.setAttribute('stroke','rgba(52,211,153,0.9)');pl.setAttribute('stroke-width','2');pl.setAttribute('stroke-linecap','round');pl.setAttribute('stroke-linejoin','round');pl.setAttribute('points',co.map(c=>`${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '));svg.appendChild(pl);
  if(goal>0&&goal<=axM){const gy=ty(goal),gr=mx>=goal,gc=gr?'rgba(52,211,153,0.7)':'rgba(251,191,36,0.7)';const gl=document.createElementNS(NS,'line');gl.setAttribute('id','chart-goal-line');gl.setAttribute('x1',XS);gl.setAttribute('x2',XE);gl.setAttribute('y1',gy);gl.setAttribute('y2',gy);gl.setAttribute('stroke',gc);gl.setAttribute('stroke-width','1');gl.setAttribute('stroke-dasharray','6,4');svg.appendChild(gl);const gL=document.createElementNS(NS,'text');gL.setAttribute('id','chart-goal-label');gL.setAttribute('x',XE-2);gL.setAttribute('y',gy-4);gL.setAttribute('fill',gc);gL.setAttribute('font-size','10');gL.setAttribute('text-anchor','end');gL.setAttribute('font-weight','600');gL.textContent=gr?`✓ Objectif ${fmtEur(goal)}`:`Objectif ${fmtEur(goal)}`;svg.appendChild(gL);}
  const tg=document.createElementNS(NS,'g');tg.setAttribute('id','chart-tooltip');tg.setAttribute('pointer-events','none');tg.style.display='none';
  const tr2=document.createElementNS(NS,'rect');tr2.setAttribute('rx','6');tr2.setAttribute('fill','rgba(20,20,20,0.92)');tr2.setAttribute('stroke','rgba(255,255,255,0.1)');tr2.setAttribute('stroke-width','1');tr2.setAttribute('width','140');tr2.setAttribute('height','44');
  const tn=document.createElementNS(NS,'text');tn.setAttribute('fill','white');tn.setAttribute('font-size','11');tn.setAttribute('font-weight','600');
  const ta=document.createElementNS(NS,'text');ta.setAttribute('fill','rgba(52,211,153,0.9)');ta.setAttribute('font-size','10');
  const td2=document.createElementNS(NS,'text');td2.setAttribute('fill','rgba(255,255,255,0.35)');td2.setAttribute('font-size','9');
  tg.append(tr2,tn,ta,td2);svg.appendChild(tg);
  const dg=document.createElementNS(NS,'g');dg.setAttribute('id','chart-dots-group');
  co.forEach(c=>{const ha=document.createElementNS(NS,'circle');ha.setAttribute('cx',c.x.toFixed(1));ha.setAttribute('cy',c.y.toFixed(1));ha.setAttribute('r','12');ha.setAttribute('fill','transparent');ha.style.cursor='pointer';const dot=document.createElementNS(NS,'circle');dot.setAttribute('cx',c.x.toFixed(1));dot.setAttribute('cy',c.y.toFixed(1));dot.setAttribute('r','4');dot.setAttribute('fill','rgba(52,211,153,1)');dot.setAttribute('stroke','rgba(26,26,26,1)');dot.setAttribute('stroke-width','2');dot.style.transition='r 0.15s ease';ha.addEventListener('mouseenter',()=>{dot.setAttribute('r','6');let ttx=c.x+12;if(ttx+140>XE)ttx=c.x-152;let tty=c.y-52;if(tty<5)tty=c.y+10;tr2.setAttribute('x',ttx);tr2.setAttribute('y',tty);tn.setAttribute('x',ttx+8);tn.setAttribute('y',tty+16);ta.setAttribute('x',ttx+8);ta.setAttribute('y',tty+30);td2.setAttribute('x',ttx+8);td2.setAttribute('y',tty+42);tn.textContent=c.order.customer.length>16?c.order.customer.slice(0,15)+'…':c.order.customer;ta.textContent=`${fmtEur(c.order.totalReceived)} · Cumul ${fmtEur(c.cumul)}`;td2.textContent=c.order.date?new Date(c.order.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';tg.style.display='block';});ha.addEventListener('mouseleave',()=>{dot.setAttribute('r','4');tg.style.display='none';});dg.append(dot,ha);});svg.appendChild(dg);
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

const settingsModal=document.getElementById('settings-modal');
function loadSettingsInputs(){
  document.getElementById('set-fee-fixed').value=currentConfig.feeFixed;document.getElementById('set-fee-percent').value=currentConfig.feePercent;
  document.getElementById('set-stock-alert').value=currentConfig.stockAlert;document.getElementById('set-monthly-goal').value=currentConfig.monthlyGoal;
  document.getElementById('set-initial-capital').value=currentConfig.initialCapital||0;buildPurgeMonthSelect();
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
document.getElementById('btn-settings-save').addEventListener('click',()=>{
  currentConfig.feeFixed=parseFloat(document.getElementById('set-fee-fixed').value)||0;currentConfig.feePercent=parseFloat(document.getElementById('set-fee-percent').value)||0;
  currentConfig.stockAlert=parseInt(document.getElementById('set-stock-alert').value)||0;currentConfig.monthlyGoal=parseFloat(document.getElementById('set-monthly-goal').value)||0;
  currentConfig.initialCapital=parseFloat(document.getElementById('set-initial-capital').value)||0;
  saveConfig();hideModal(settingsModal);calculateSimulator();updateDashboardMetrics();renderStock();showToast('Configuration enregistrée');
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
  try {
    await initStorage();
  } catch(e) {
    console.error('Init error:', e);
  } finally {
    hideLoader();
  }
  initLockScreen(startApp);
});
function startApp(){
  const now=new Date(),ck=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  activeMonthFilter=orders.some(o=>{if(!o.date)return false;const d=new Date(o.date);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`===ck;})?ck:'all';
  buildMonthSelector();renderStock();populateOrderSelect();renderProducts();renderOrders();calculateSimulator();updateDashboardMetrics();

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
    showToast('Déconnecté', 'success');
    setTimeout(() => window.location.reload(), 800);
  });
}
