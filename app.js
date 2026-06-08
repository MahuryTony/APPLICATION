const API_STATE = '/api/state';
const API_COMMAND = '/api/command';
const API_STREAM = '/api/stream';

let events = [];
let babyInfo = { name: 'Oscar', birthdate: '', emoji: '👶' };
let currentType = 'couche';
let currentCoucheType = 'pipi';
let currentRepasType = 'sein';
let currentVomisType = 'normal';
let sleepTimerInterval = null;
let sleepStartTime = null;
let sleepActive = null;
let eventSource = null;
let serverConnected = false;
let reconnectTimeout = null;

function persistLocal() {
  localStorage.setItem('bb_events', JSON.stringify(events || []));
  localStorage.setItem('bb_baby', JSON.stringify(babyInfo || { name: 'Mon Bébé', birthdate: '', emoji: '👶' }));
  localStorage.setItem('bb_sleep_active', JSON.stringify(sleepActive || null));
}

function loadLocalState() {
  try {
    const savedEvents = JSON.parse(localStorage.getItem('bb_events') || '[]');
    const savedBaby = JSON.parse(localStorage.getItem('bb_baby') || '{"name":"Mon Bébé","birthdate":"","emoji":"👶"}');
    const savedSleep = JSON.parse(localStorage.getItem('bb_sleep_active') || 'null');
    return { events: savedEvents, babyInfo: savedBaby, sleepActive: savedSleep };
  } catch (err) {
    return null;
  }
}

function applyState(stateData, showNetworkStatus = false) {
  if (!stateData) return;
  events = Array.isArray(stateData.events) ? stateData.events : [];
  babyInfo = typeof stateData.babyInfo === 'object' ? stateData.babyInfo : babyInfo;
  sleepActive = stateData.sleepActive || null;
  persistLocal();
  if (showNetworkStatus && serverConnected) {
    showToast('🔄 Synchronisé en direct');
  }
  renderHome();
  renderHistory();
  renderBaby();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return await response.json();
}

async function loadState() {
  try {
    const data = await fetchJson(API_STATE);
    applyState(data, false);
    startEventStream();
  } catch (err) {
    console.warn('Serveur indisponible', err);
    const local = loadLocalState();
    if (local) {
      applyState(local, false);
      showToast('⚠️ Mode hors ligne');
    } else {
      applyState({ events: [], babyInfo, sleepActive: null }, false);
    }
  }
}

function reconnectStream() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    startEventStream();
  }, 3000);
}

function startEventStream() {
  if (!window.EventSource) return;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  eventSource = new EventSource(API_STREAM);
  eventSource.onopen = () => {
    serverConnected = true;
    showToast('✅ Synchronisation en direct');
  };

  eventSource.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.type === 'state') applyState(payload.state, false);
    } catch (err) {
      console.warn('SSE parse error', err);
    }
  };

  eventSource.onerror = () => {
    if (serverConnected) {
      showToast('⚠️ Déconnexion du serveur');
    }
    serverConnected = false;
    if (eventSource.readyState === EventSource.CLOSED) {
      reconnectStream();
    }
  };
}

async function sendServerCommand(command) {
  try {
    const result = await fetchJson(API_COMMAND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (result && result.state) {
      applyState(result.state, true);
    }
    return result;
  } catch (err) {
    console.warn('sendServerCommand fail', err);
    return null;
  }
}

function save() {
  persistLocal();
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 60000);
  if (diff < 1) return "à l'instant";
  if (diff < 60) return `il y a ${diff} min`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)}j`;
}

let statsPeriod = 'daily';

function formatDuration(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
}

function getPeriodRange(period) {
  const end = new Date();
  const start = new Date(end);
  if (period === 'daily') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    const day = end.getDay();
    const diff = (day + 6) % 7; // commencer le lundi
    start.setDate(end.getDate() - diff);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'monthly') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'yearly') {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

function getStatsForRange(start, end) {
  const filtered = events.filter(e => {
    const t = new Date(e.time);
    return t >= start && t <= end;
  });
  return {
    totalEvents: filtered.length,
    couches: filtered.filter(e => e.type === 'couche').length,
    repas: filtered.filter(e => e.type === 'repas').length,
    sommeilMin: filtered.filter(e => e.type === 'sommeil').reduce((sum, e) => sum + (e.duree || 0), 0),
    bains: filtered.filter(e => e.type === 'bain').length,
    medicaments: filtered.filter(e => e.type === 'medicament').length,
    vomis: filtered.filter(e => e.type === 'vomis').length,
  };
}

function renderPeriodStats() {
  const { start, end } = getPeriodRange(statsPeriod);
  const stats = getStatsForRange(start, end);
  const label = {
    daily: "Aujourd'hui",
    weekly: 'Cette semaine',
    monthly: 'Ce mois',
    yearly: 'Cette année'
  }[statsPeriod] || 'Période';

  document.getElementById('period-stats-grid').innerHTML = `
    <div class="stat-card pink">
      <span class="emoji">📅</span>
      <div class="label">${label}</div>
      <div class="value">${stats.totalEvents}</div>
      <div class="sub">événements</div>
    </div>
    <div class="stat-card mint">
      <span class="emoji">👶</span>
      <div class="label">Couches</div>
      <div class="value">${stats.couches}</div>
      <div class="sub">durant la période</div>
    </div>
    <div class="stat-card lavender">
      <span class="emoji">🍼</span>
      <div class="label">Repas</div>
      <div class="value">${stats.repas}</div>
      <div class="sub">durant la période</div>
    </div>
    <div class="stat-card sky">
      <span class="emoji">😴</span>
      <div class="label">Sommeil</div>
      <div class="value">${stats.sommeilMin > 0 ? formatDuration(stats.sommeilMin) : '—'}</div>
      <div class="sub">durant la période</div>
    </div>
  `;
}

function setStatsPeriod(period) {
  statsPeriod = period;
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
  renderPeriodStats();
}

function getEventLabel(e) {
  switch (e.type) {
    case 'couche': return `Couche ${e.coucheType || ''}`;
    case 'repas': return e.repasType === 'biberon' ? `Biberon${e.ml ? ' – ' + e.ml + 'ml' : ''}` : e.repasType === 'sein' ? `Tétée${e.duree ? ' – ' + e.duree + ' min' : ''}` : 'Repas mixte';
    case 'sommeil': return `Dodo${e.duree ? ' – ' + formatDuration(e.duree) : ''}`;
    case 'bain': return 'Bain';
    case 'medicament': return `${e.medName || 'Médicament'}${e.medDose ? ' – ' + e.medDose + 'mg' : ''}`;
    case 'vomis': return `Vomis ${e.vomisType === 'particulier' ? 'particulier' : 'normal'}${e.observation ? ' – ' + e.observation : ''}`;
    case 'autre': return e.desc || 'Autre';
    default: return e.type;
  }
}

function getEventEmoji(type) {
  return { couche: '👶', repas: '🍼', sommeil: '😴', bain: '🛁', medicament: '💊', vomis: '🤮', }[type] || '📝';
}

function getEventColor(type) {
  return { couche: 'var(--soft-pink)', repas: 'var(--mint)', sommeil: 'var(--lavender)', bain: 'var(--sky)', medicament: 'var(--yellow)', vomis: '#F7D7E4', autre: '#f5f0ea' }[type] || '#f5f0ea';
}

function getBabyAge() {
  if (!babyInfo.birthdate) return '';
  const born = new Date(babyInfo.birthdate);
  const now = new Date();
  const days = Math.floor((now - born) / 86400000);
  if (days < 0) return 'À naître bientôt 🌟';
  if (days < 30) return `${days} jour${days > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} mois`;
  const years = Math.floor(months / 12);
  return `${years} an${years > 1 ? 's' : ''}`;
}

function goPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'baby') renderBaby();
}

function renderHome() {
  const today = new Date().toDateString();
  const todayEvents = events.filter(e => new Date(e.time).toDateString() === today);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 6) return 'Bonne nuit 🌙';
    if (h < 12) return 'Bonjour 👋';
    if (h < 18) return 'Bon après-midi ☀️';
    return 'Bonsoir 🌆';
  };

  document.getElementById('greeting').textContent = greeting();
  document.getElementById('home-date').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  const todayCouche = todayEvents.filter(e => e.type === 'couche').length;
  const todayRepas = todayEvents.filter(e => e.type === 'repas').length;
  const todaySommeil = todayEvents.filter(e => e.type === 'sommeil');
  const sommeilMin = todaySommeil.reduce((a, e) => a + (e.duree || 0), 0);
  const lastRepas = [...events].filter(e => e.type === 'repas').sort((a, b) => new Date(b.time) - new Date(a.time))[0];

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card pink">
      <span class="emoji">👶</span>
      <div class="label">Couches</div>
      <div class="value">${todayCouche}</div>
      <div class="sub">aujourd'hui</div>
    </div>
    <div class="stat-card mint">
      <span class="emoji">🍼</span>
      <div class="label">Repas</div>
      <div class="value">${todayRepas}</div>
      <div class="sub">${lastRepas ? timeAgo(lastRepas.time) : 'aucun'}</div>
    </div>
    <div class="stat-card lavender">
      <span class="emoji">😴</span>
      <div class="label">Sommeil</div>
      <div class="value">${sommeilMin > 0 ? formatDuration(sommeilMin) : '—'}</div>
      <div class="sub">aujourd'hui</div>
    </div>
    <div class="stat-card sky">
      <span class="emoji">📊</span>
      <div class="label">Événements</div>
      <div class="value">${todayEvents.length}</div>
      <div class="sub">aujourd'hui</div>
    </div>
  `;

  ['couche', 'repas', 'sommeil', 'bain', 'medicament', 'vomis', 'autre'].forEach(type => {
    const last = [...events].filter(e => e.type === type).sort((a, b) => new Date(b.time) - new Date(a.time))[0];
    const el = document.getElementById('last-' + type);
    if (el) el.textContent = last ? timeAgo(last.time) : 'jamais';
  });

  const container = document.getElementById('today-events');
  const sorted = [...todayEvents].sort((a, b) => new Date(b.time) - new Date(a.time));
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-emoji">☀️</div><p>Aucun événement aujourd\'hui</p></div>';
  } else {
    container.innerHTML = sorted.map(e => `
      <div class="event-item" id="ev-${e.id}">
        <div class="event-icon" style="background:${getEventColor(e.type)}">${getEventEmoji(e.type)}</div>
        <div class="event-info">
          <div class="event-title">${getEventLabel(e)}</div>
          ${e.note ? `<div class="event-meta">${e.note}</div>` : ''}
        </div>
        <div class="event-time">${formatTime(e.time)}</div>
        <button class="event-delete" onclick="deleteEvent('${e.id}')">✕</button>
      </div>
    `).join('');
  }

  renderPeriodStats();
  updateSleepBanner();
}

function updateSleepBanner() {
  const banner = document.getElementById('sleep-banner');
  if (sleepActive) {
    banner.style.display = 'flex';
    updateSleepBannerTime();
    if (!window.sleepBannerInterval) {
      window.sleepBannerInterval = setInterval(updateSleepBannerTime, 1000);
    }
  } else {
    banner.style.display = 'none';
    if (window.sleepBannerInterval) {
      clearInterval(window.sleepBannerInterval);
      window.sleepBannerInterval = null;
    }
  }
}

function updateSleepBannerTime() {
  if (!sleepActive) return;
  const diff = Math.floor((Date.now() - new Date(sleepActive.start)) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const el = document.getElementById('sleep-timer-display');
  if (el) el.textContent = h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function stopSleep() {
  if (!sleepActive) return;
  const result = await sendServerCommand({ action: 'sleepStop', stop: new Date().toISOString(), note: '' });
  if (!result) {
    const diff = Math.floor((Date.now() - new Date(sleepActive.start)) / 60000);
    const event = {
      id: Date.now().toString(),
      type: 'sommeil',
      time: sleepActive.start,
      duree: diff,
      note: '',
    };
    events.push(event);
    sleepActive = null;
    save();
    showToast('😴 Dodo terminé localement – ' + formatDuration(diff));
    renderHome();
  }
}

function renderHistory() {
  const container = document.getElementById('history-container');
  if (events.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-emoji">📅</div><p>Aucun événement enregistré</p></div>';
    return;
  }
  const sorted = [...events].sort((a, b) => new Date(b.time) - new Date(a.time));
  const byDay = {};
  sorted.forEach(e => {
    const key = new Date(e.time).toDateString();
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(e);
  });
  container.innerHTML = Object.entries(byDay).map(([day, evs]) => `
    <div class="history-day">
      <div class="history-day-title">${formatDate(evs[0].time)} (${evs.length})</div>
      <div class="event-list">
        ${evs.map(e => `
          <div class="event-item">
            <div class="event-icon" style="background:${getEventColor(e.type)}">${getEventEmoji(e.type)}</div>
            <div class="event-info">
              <div class="event-title">${getEventLabel(e)}</div>
              ${e.note ? `<div class="event-meta">${e.note}</div>` : ''}
            </div>
            <div class="event-time">${formatTime(e.time)}</div>
            <button class="event-delete" onclick="deleteEvent('${e.id}', true)">✕</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderBaby() {
  document.getElementById('baby-name-display').textContent = babyInfo.name || 'Mon Bébé';
  document.getElementById('baby-emoji-display').textContent = babyInfo.emoji || '👶';
  document.getElementById('baby-age-display').textContent = getBabyAge();
  document.getElementById('settings-name').value = babyInfo.name || '';
  document.getElementById('settings-birthdate').value = babyInfo.birthdate || '';

  const totalCouche = events.filter(e => e.type === 'couche').length;
  const totalRepas = events.filter(e => e.type === 'repas').length;
  const totalSommeil = events.filter(e => e.type === 'sommeil').reduce((a, e) => a + (e.duree || 0), 0);
  const totalBain = events.filter(e => e.type === 'bain').length;

  document.getElementById('global-stats').innerHTML = `
    <div class="info-row"><div class="info-row-left"><span class="info-row-emoji">👶</span><span class="info-row-label">Total couches<br></span></div><span class="info-row-value">${totalCouche}</span></div>
    <div class="info-row"><div class="info-row-left"><span class="info-row-emoji">🍼</span><span class="info-row-label">Total repas<br></span></div><span class="info-row-value">${totalRepas}</span></div>
    <div class="info-row"><div class="info-row-left"><span class="info-row-emoji">😴</span><span class="info-row-label">Total sommeil<br></span></div><span class="info-row-value">${formatDuration(totalSommeil)}</span></div>
    <div class="info-row"><div class="info-row-left"><span class="info-row-emoji">🛁</span><span class="info-row-label">Total bains<br></span></div><span class="info-row-value">${totalBain}</span></div>
    <div class="info-row"><div class="info-row-left"><span class="info-row-emoji">📊</span><span class="info-row-label">Total événements<br></span></div><span class="info-row-value">${events.length}</span></div>
  `;
}

function saveBabyInfo() {
  babyInfo.name = document.getElementById('settings-name').value;
  babyInfo.birthdate = document.getElementById('settings-birthdate').value;
  save();
  document.getElementById('baby-name-display').textContent = babyInfo.name || 'Mon Bébé';
  document.getElementById('baby-age-display').textContent = getBabyAge();
  document.getElementById('topbar-title').textContent = '🍼 ' + (babyInfo.name || 'Oscar');
  document.getElementById('nav-baby-name').textContent = babyInfo.name || 'Oscar';
  sendServerCommand({ action: 'saveBabyInfo', babyInfo });
}

function selectEmoji(em) {
  babyInfo.emoji = em;
  save();
  document.getElementById('baby-emoji-display').textContent = em;
  sendServerCommand({ action: 'saveBabyInfo', babyInfo });
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('event-time').value = now.toISOString().slice(0, 16);
  selectType(currentType);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  clearInterval(sleepTimerInterval);
  sleepTimerInterval = null;
  sleepStartTime = null;
  document.getElementById('sleep-start-btn').textContent = '▶ Démarrer';
  document.getElementById('sleep-start-btn').className = 'timer-btn';
  document.getElementById('sleep-modal-timer').textContent = '00:00';
}

function closeModalOutside(e, id) {
  if (e.target.id === id) closeModal(id);
}

function selectType(type) {
  currentType = type;
  document.querySelectorAll('#type-selector-group .toggle-btn').forEach(b => {
    b.classList.toggle('selected', b.textContent.toLowerCase().includes(type.toLowerCase().slice(0, 4)));
  });
  ['couche', 'repas', 'sommeil', 'medicament', 'vomis', 'autre'].forEach(t => {
    const el = document.getElementById('fields-' + t);
    if (el) el.style.display = t === type ? '' : 'none';
  });
  document.getElementById('modal-add-title').textContent = {
    couche: '👶 Couche', repas: '🍼 Repas', sommeil: '😴 Sommeil', bain: '🛁 Bain', medicament: '💊 Médicament', vomis: '🤮 Vomis', autre: '📝 Autre'
  }[type] || '➕ Ajouter';
}

function quickAdd(type) {
  currentType = type;
  openModal('modal-add');
  selectType(type);
}

function selectCoucheType(type) {
  currentCoucheType = type;
  document.querySelectorAll('[id^="ct-"]').forEach(b => b.classList.remove('selected'));
  document.getElementById('ct-' + type.replace(' ', '-')).classList.add('selected');
}

function selectRepasType(type) {
  currentRepasType = type;
  document.querySelectorAll('[id^="rt-"]').forEach(b => b.classList.remove('selected'));
  document.getElementById('rt-' + type).classList.add('selected');
  document.getElementById('repas-duree-group').style.display = (type !== 'biberon') ? '' : 'none';
  document.getElementById('repas-ml-group').style.display = (type === 'biberon' || type === 'mixte') ? '' : 'none';
}

function selectVomisType(type) {
  currentVomisType = type;
  document.querySelectorAll('[id^="vt-"]').forEach(b => b.classList.remove('selected'));
  document.getElementById('vt-' + type).classList.add('selected');
}

function toggleSleepTimer() {
  if (!sleepTimerInterval) {
    sleepStartTime = Date.now();
    sleepTimerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - sleepStartTime) / 1000);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      document.getElementById('sleep-modal-timer').textContent = `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }, 1000);
    document.getElementById('sleep-start-btn').textContent = '⏹ Arrêter';
    document.getElementById('sleep-start-btn').className = 'timer-btn stopped';
  } else {
    const min = Math.floor((Date.now() - sleepStartTime) / 60000);
    document.getElementById('sommeil-duree').value = min || 1;
    clearInterval(sleepTimerInterval);
    sleepTimerInterval = null;
    document.getElementById('sleep-start-btn').textContent = '▶ Redémarrer';
    document.getElementById('sleep-start-btn').className = 'timer-btn';
  }
}

async function saveEvent() {
  const time = document.getElementById('event-time').value;
  const note = document.getElementById('event-note').value;
  if (!time) { showToast('⚠️ Heure manquante'); return; }

  const e = { id: Date.now().toString(), type: currentType, time: new Date(time).toISOString(), note };

  if (currentType === 'couche') {
    e.coucheType = currentCoucheType;
  } else if (currentType === 'repas') {
    e.repasType = currentRepasType;
    e.duree = parseInt(document.getElementById('repas-duree').value) || null;
    e.ml = parseInt(document.getElementById('repas-ml').value) || null;
  } else if (currentType === 'sommeil') {
    const manualDur = parseInt(document.getElementById('sommeil-duree').value);
    const timerDur = sleepStartTime ? Math.floor((Date.now() - sleepStartTime) / 60000) : null;
    e.duree = manualDur || timerDur || null;

    if (sleepTimerInterval && !manualDur) {
      const result = await sendServerCommand({ action: 'sleepStart', start: new Date().toISOString() });
      if (!result) {
        sleepActive = { start: new Date().toISOString() };
        persistLocal();
        showToast('😴 Dodo démarré localement');
        renderHome();
      }
      closeModal('modal-add');
      return;
    }
  } else if (currentType === 'medicament') {
    e.medName = document.getElementById('med-name').value;
    e.medDose = parseInt(document.getElementById('med-dose').value) || null;
  } else if (currentType === 'vomis') {
    e.vomisType = currentVomisType;
    e.observation = document.getElementById('vomis-observation').value;
  } else if (currentType === 'autre') {
    e.desc = document.getElementById('autre-desc') ? document.getElementById('autre-desc').value : '';
  }

  const result = await sendServerCommand({ action: 'saveEvent', event: e });
  if (!result) {
    events.push(e);
    save();
    closeModal('modal-add');
    renderHome();
    showToast('🛈 Enregistré en local');
    return;
  }

  closeModal('modal-add');
}

async function deleteEvent(id, fromHistory) {
  if (!confirm('Supprimer cet événement ?')) return;
  const result = await sendServerCommand({ action: 'deleteEvent', id });
  if (!result) {
    events = events.filter(e => e.id !== id);
    save();
    if (fromHistory) renderHistory(); else renderHome();
    showToast('🗑 Supprimé localement');
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function updateThemeColor(mql) {
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeMeta) return;
  themeMeta.content = (mql && mql.matches) ? '#141216' : '#FFF8F5';
}

function init() {
  document.getElementById('topbar-title').textContent = '🍼 ' + (babyInfo.name || 'Oscar');
  document.getElementById('nav-baby-name').textContent = babyInfo.name || 'Oscar';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  updateThemeColor(prefersDark);
  if (prefersDark.addEventListener) {
    prefersDark.addEventListener('change', () => updateThemeColor(prefersDark));
  } else if (prefersDark.addListener) {
    prefersDark.addListener(() => updateThemeColor(prefersDark));
  }

  loadState();
  selectCoucheType('pipi');
  selectRepasType('sein');
}

init();
