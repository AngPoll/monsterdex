/* =============================================
   MonsterDex v2 — Frontend Logic
   ============================================= */

// ---- DOM Refs ----
const searchForm    = document.getElementById('search-form');
const searchInput   = document.getElementById('search-input');
const btnCamera     = document.getElementById('btn-camera');
const btnUpload     = document.getElementById('btn-upload');
const fileInput     = document.getElementById('file-input');
const cameraInput   = document.getElementById('camera-input');
const suggestionsEl = document.getElementById('suggestions');
const loadingEl     = document.getElementById('loading');
const loadingText   = document.getElementById('loading-text');
const errorEl       = document.getElementById('error-state');
const resultEl      = document.getElementById('result');
const homepageEl    = document.getElementById('homepage');
const cameraModal   = document.getElementById('camera-modal');
const cameraClose   = document.getElementById('camera-close');
const identifyBtn   = document.getElementById('identify-btn');
const previewImg    = document.getElementById('preview-img');
const uploadArea    = document.getElementById('upload-area');
const pastSearchesEl    = document.getElementById('past-searches');
const pastSearchesList  = document.getElementById('past-searches-list');
const clearHistoryBtn   = document.getElementById('clear-history');

// ---- State ----
let userImageDataUrl = null;
let selectedFile = null;

// ---- Loading messages ----
const LOADING_MSGS = [
  'Summoning from the depths…',
  'Consulting ancient tomes…',
  'The beast stirs…',
  'Deciphering forbidden scrolls…',
  'Scouring the darkness…',
  'Awakening the archives…',
  'Binding the creature\'s knowledge…'
];

// ============================
//   Event Listeners
// ============================

searchForm.addEventListener('submit', handleSearch);

// Chips (span elements)
suggestionsEl.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    searchInput.value = chip.dataset.monster;
    searchForm.dispatchEvent(new Event('submit'));
  });
});

// Camera button — on mobile use native capture, else open modal
btnCamera.addEventListener('click', () => {
  if (isMobile()) {
    cameraInput.click();
  } else {
    openModal();
  }
});

cameraInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fileToDataUrl(file).then(url => { userImageDataUrl = url; });
  identifyMonster(file);
  cameraInput.value = '';
});

// Upload button opens modal
btnUpload.addEventListener('click', openModal);

// File input inside modal
fileInput.addEventListener('change', handleModalFile);

// Identify button in modal
identifyBtn.addEventListener('click', () => {
  if (selectedFile) {
    closeModal();
    identifyMonster(selectedFile);
  }
});

// Modal close
cameraClose.addEventListener('click', closeModal);

// Close modal on background click
cameraModal.addEventListener('click', (e) => {
  if (e.target === cameraModal) closeModal();
});

// Escape key closes modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && cameraModal.classList.contains('show')) closeModal();
});

// Clear history
clearHistoryBtn.addEventListener('click', clearHistory);

// Drag and drop on upload area
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.style.borderColor = '#c0392b'; });
uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = '#c0a882'; });
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.style.borderColor = '#c0a882';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    previewFile(file);
  }
});

// Load past searches on page load
renderPastSearches();

// ============================
//   Helpers
// ============================

function isMobile() {
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 0 && window.innerWidth < 800);
}

// ============================
//   Modal
// ============================

function openModal() {
  selectedFile = null;
  previewImg.style.display = 'none';
  previewImg.src = '';
  uploadArea.style.display = '';
  identifyBtn.style.display = 'none';
  cameraModal.classList.add('show');
}

function closeModal() {
  cameraModal.classList.remove('show');
  selectedFile = null;
  fileInput.value = '';
}

function handleModalFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  previewFile(file);
}

function previewFile(file) {
  selectedFile = file;
  fileToDataUrl(file).then(url => {
    userImageDataUrl = url;
    previewImg.src = url;
    previewImg.style.display = 'block';
    uploadArea.style.display = 'none';
    identifyBtn.style.display = '';
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================
//   Search
// ============================

async function handleSearch(e) {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  userImageDataUrl = null;
  showLoading();

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      showError(errData?.error || `Server error (${res.status}). Please try again.`);
      return;
    }

    const data = await res.json();
    if (data.error && !data.name) {
      showError(data.error, data.suggestion);
    } else {
      showResult(data);
    }
  } catch (err) {
    console.error('Search failed:', err);
    showError('Failed to connect to MonsterDex. Please check your connection and try again.');
  }
}

// ============================
//   Identify (camera + upload)
// ============================

async function identifyMonster(blob) {
  showLoading('Scanning creature…');

  const formData = new FormData();
  formData.append('image', blob, 'monster.jpg');

  try {
    const res = await fetch('/api/identify', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      showError(errData?.error || `Server error (${res.status}). Please try again.`);
      return;
    }

    const data = await res.json();
    if (data.error && !data.name) {
      showError(data.error, data.suggestion);
    } else {
      showResult(data);
    }
  } catch (err) {
    console.error('Identify failed:', err);
    showError('Failed to connect to MonsterDex. Please check your connection and try again.');
  }
}

// ============================
//   UI State Helpers
// ============================

function showLoading(msg) {
  loadingText.textContent = msg || LOADING_MSGS[Math.floor(Math.random() * LOADING_MSGS.length)];
  errorEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  homepageEl.style.display = 'none';
  loadingEl.classList.remove('hidden');
  window.scrollTo({ top: loadingEl.offsetTop - 20, behavior: 'smooth' });
}

function hideLoading() {
  loadingEl.classList.add('hidden');
}

function showError(message, suggestion) {
  hideLoading();
  resultEl.classList.add('hidden');
  homepageEl.style.display = '';

  errorEl.innerHTML = `
    😵 ${escapeHtml(message)}
    ${suggestion ? `<br><small>${escapeHtml(suggestion)}</small>` : ''}
  `;
  errorEl.classList.remove('hidden');
  window.scrollTo({ top: errorEl.offsetTop - 20, behavior: 'smooth' });
}

async function showResult(monster) {
  hideLoading();
  errorEl.classList.add('hidden');
  homepageEl.style.display = 'none';

  saveToHistory(monster);

  // Determine image: user photo > server > Wikipedia
  let imageUrl = null;
  let imageCredit = null;

  if (userImageDataUrl) {
    imageUrl = userImageDataUrl;
    imageCredit = 'Your captured image';
  } else if (monster._imageUrl) {
    imageUrl = monster._imageUrl;
    imageCredit = monster._imageCredit || null;
  } else {
    const wikiImg = await fetchWikipediaImage(monster.name);
    if (wikiImg) {
      imageUrl = wikiImg.url;
      imageCredit = wikiImg.credit;
    }
  }

  resultEl.innerHTML = renderMonsterCard(monster, imageUrl, imageCredit);
  resultEl.classList.remove('hidden');
  renderPastSearches();
  window.scrollTo({ top: resultEl.offsetTop - 20, behavior: 'smooth' });
}

function goBack() {
  resultEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  homepageEl.style.display = '';
  searchInput.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.goBack = goBack;

// ============================
//   Wikipedia Image Fetch
// ============================

async function fetchWikipediaImage(monsterName) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(monsterName)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.originalimage?.source) return { url: data.originalimage.source, credit: `Wikipedia — ${data.title}` };
    if (data.thumbnail?.source) return { url: data.thumbnail.source, credit: `Wikipedia — ${data.title}` };
    return null;
  } catch { return null; }
}

// ============================
//   Render Monster Card (v2 retro style)
// ============================

function renderMonsterCard(m, imageUrl, imageCredit) {
  const skulls = '💀'.repeat(Math.min(Math.max(m.dangerLevel || 3, 1), 5));
  const akaText = Array.isArray(m.aka) && m.aka.length > 0
    ? `Also known as: ${m.aka.join(', ')}`
    : '';

  // Image section
  let imageSection;
  if (imageUrl) {
    imageSection = `
      <div class="result-img-wrap">
        <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(m.name)}" class="result-img"
             onerror="this.parentElement.innerHTML='<div class=result-img-placeholder><span>${m.emoji || '👹'}</span></div>'">
        <div class="result-img-overlay"></div>
      </div>`;
  } else {
    imageSection = `
      <div class="result-img-placeholder">
        <span>${m.emoji || '👹'}</span>
      </div>`;
  }

  // Stats — handle both object ({str:'High'}) and array ([{label:'Str',value:'High'}]) formats
  let statsHtml = '';
  if (m.stats) {
    if (Array.isArray(m.stats)) {
      statsHtml = m.stats.map(s => `
        <div class="rstat-block">
          <div class="rstat-label">${escapeHtml(s.label)}</div>
          <div class="rstat-value">${escapeHtml(s.value)}</div>
        </div>`).join('');
    } else {
      statsHtml = Object.entries(m.stats).map(([key, val]) => `
        <div class="rstat-block">
          <div class="rstat-label">${escapeHtml(formatLabel(key))}</div>
          <div class="rstat-value">${escapeHtml(val)}</div>
        </div>`).join('');
    }
  }

  // Abilities — handle both {name,description} and {text} formats
  const abilitiesHtml = Array.isArray(m.abilities) ? m.abilities.map(a => {
    const text = a.text || (a.name ? `<strong>${escapeHtml(a.name)}</strong> — ${escapeHtml(a.description)}` : escapeHtml(String(a)));
    const icon = a.icon || '⚡';
    return `<div class="rability"><span class="icon">${icon}</span><span>${a.text ? escapeHtml(a.text) : text}</span></div>`;
  }).join('') : '';

  // Weaknesses
  const weaknessesHtml = Array.isArray(m.weaknesses) ? m.weaknesses.map(w =>
    `<span class="rweak">${escapeHtml(w)}</span>`
  ).join('') : '';

  // Appearances
  const appearancesHtml = Array.isArray(m.appearances) ? m.appearances.map(a =>
    `<div class="rappear">${escapeHtml(a)}</div>`
  ).join('') : '';

  // Lore text (our API uses "lore", v2 used "description") — render bullet points
  const loreText = m.lore || m.description || 'No lore available.';
  const loreHtml = escapeHtml(loreText).replace(/•/g, '<br>•');

  // Identified banner
  const identifiedHtml = m._identified ? `
    <div class="identified-banner">
      📷 Identified as <strong>&nbsp;${escapeHtml(m._identifiedAs || m.name)}&nbsp;</strong> from your image
    </div>` : '';

  return `
    <div class="result-card">
      ${imageSection}

      <div class="result-header">
        <div class="result-name">${escapeHtml(m.name)}</div>
        ${akaText ? `<div class="result-aka">${escapeHtml(akaText)}</div>` : ''}
        <div class="result-badges">
          <span class="rbadge rbadge-origin">${escapeHtml(m.origin || 'Unknown')}</span>
          <span class="rbadge rbadge-type">${escapeHtml(m.type || 'Unknown')}</span>
          <span class="rbadge rbadge-danger">${skulls} ${escapeHtml(m.dangerLabel || 'Unknown')}</span>
        </div>
      </div>

      <div class="result-body">
        ${identifiedHtml}

        <div>
          <div class="rsection">📖 Origins &amp; Lore</div>
          <div class="rdesc">${loreHtml}</div>
        </div>

        ${statsHtml ? `
        <div>
          <div class="rsection">📊 Monster Profile</div>
          <div class="rstat-grid">${statsHtml}</div>
        </div>` : ''}

        ${abilitiesHtml ? `
        <div>
          <div class="rsection">⚡ Abilities &amp; Powers</div>
          <div class="rabilities">${abilitiesHtml}</div>
        </div>` : ''}

        ${weaknessesHtml ? `
        <div>
          <div class="rsection">🛡️ Weaknesses</div>
          <div class="rweaknesses">${weaknessesHtml}</div>
        </div>` : ''}

        ${appearancesHtml ? `
        <div>
          <div class="rsection">🎬 Famous Appearances</div>
          <div class="rappearances">${appearancesHtml}</div>
        </div>` : ''}

        ${m.funFact ? `
        <div class="rfunfact">
          <strong>💀 Did you know?</strong>
          ${escapeHtml(m.funFact)}
        </div>` : ''}
      </div>
    </div>

    <button class="back-btn" onclick="goBack()">← BACK TO FIELD GUIDE</button>
  `;
}

// ============================
//   Utilities
// ============================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatLabel(camelCase) {
  return camelCase
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// ============================
//   Past Searches (localStorage)
// ============================

const HISTORY_KEY = 'monsterdex_history';
const MAX_HISTORY = 30;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

function getHistory() {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    // Filter out entries older than 30 days
    const now = Date.now();
    const fresh = all.filter(m => m.timestamp && (now - m.timestamp) < THIRTY_DAYS);
    // Clean up expired entries
    if (fresh.length !== all.length) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(fresh));
    }
    return fresh;
  }
  catch { return []; }
}

function saveToHistory(monster) {
  const history = getHistory();
  const filtered = history.filter(m => m.name.toLowerCase() !== monster.name.toLowerCase());

  filtered.unshift({
    name: monster.name,
    emoji: monster.emoji || '👹',
    origin: monster.origin || '',
    dangerLevel: monster.dangerLevel || 3,
    type: monster.type || '',
    timestamp: Date.now()
  });

  localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, MAX_HISTORY)));
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderPastSearches();
}

function renderPastSearches() {
  const history = getHistory();

  if (history.length === 0) {
    pastSearchesEl.classList.add('hidden');
    return;
  }

  pastSearchesEl.classList.remove('hidden');

  pastSearchesList.innerHTML = history.map(m => {
    const skulls = '💀'.repeat(Math.min(Math.max(m.dangerLevel || 3, 1), 5));
    return `
      <div class="card" data-monster="${escapeAttr(m.name)}" role="button" tabindex="0">
        <div class="card-top">
          <span class="card-emoji">${m.emoji || '👹'}</span>
          <div class="card-badges">
            <span class="badge badge-type">${escapeHtml(m.type)}</span>
          </div>
        </div>
        <div class="card-name">${escapeHtml(m.name)}</div>
        <div class="card-origin">${escapeHtml(m.origin)}</div>
        <div class="card-divider"></div>
        <div class="card-danger-row">
          <span class="danger-label">Danger:</span>
          <span class="skulls">${skulls}</span>
        </div>
      </div>`;
  }).join('');

  // Click handlers
  pastSearchesList.querySelectorAll('.card').forEach(card => {
    const handler = () => {
      searchInput.value = card.dataset.monster;
      searchForm.dispatchEvent(new Event('submit'));
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}
