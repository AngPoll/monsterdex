/* =============================================
   MonsterDex — Frontend Logic
   ============================================= */

// ---- DOM Refs ----
const searchForm    = document.getElementById('search-form');
const searchInput   = document.getElementById('search-input');
const btnCamera     = document.getElementById('btn-camera');
const btnUpload     = document.getElementById('btn-upload');
const fileInput     = document.getElementById('file-input');
const suggestionsEl = document.getElementById('suggestions');
const loadingEl     = document.getElementById('loading');
const loadingText   = document.getElementById('loading-text');
const errorEl       = document.getElementById('error-state');
const resultEl      = document.getElementById('result');
const cameraModal   = document.getElementById('camera-modal');
const cameraFeed    = document.getElementById('camera-feed');
const cameraCanvas  = document.getElementById('camera-canvas');
const cameraCapture = document.getElementById('camera-capture');
const cameraSwitch  = document.getElementById('camera-switch');
const cameraClose   = document.getElementById('camera-close');

// ---- State ----
let currentStream = null;
let facingMode = 'environment'; // back camera by default on mobile
let userImageDataUrl = null;    // holds the photo/upload for display in card

// ---- Loading messages ----
const LOADING_MSGS = [
  'Summoning from the depths…',
  'Consulting ancient tomes…',
  'The beast stirs…',
  'Deciphering forbidden scrolls…',
  'Scouring the darkness…',
  'Awakening the archives…',
  'Binding the creature's knowledge…'
];

// ============================
//   Event Listeners
// ============================

searchForm.addEventListener('submit', handleSearch);

btnCamera.addEventListener('click', openCamera);

btnUpload.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileUpload);

cameraCapture.addEventListener('click', capturePhoto);
cameraSwitch.addEventListener('click', switchCamera);
cameraClose.addEventListener('click', closeCamera);

// Suggestion buttons
suggestionsEl.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    searchInput.value = btn.dataset.monster;
    searchForm.dispatchEvent(new Event('submit'));
  });
});

// Close camera on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !cameraModal.classList.contains('hidden')) {
    closeCamera();
  }
});

// ============================
//   Search
// ============================

async function handleSearch(e) {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  userImageDataUrl = null; // text search — no user image
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
//   Camera
// ============================

async function openCamera() {
  cameraModal.classList.remove('hidden');
  try {
    await startCamera();
  } catch (err) {
    closeCamera();
    showError('Could not access camera. Please allow camera permissions or try uploading an image instead.');
  }
}

async function startCamera() {
  // Stop any existing stream
  stopCamera();

  const constraints = {
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
    audio: false
  };

  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  cameraFeed.srcObject = currentStream;
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
  cameraFeed.srcObject = null;
}

function closeCamera() {
  stopCamera();
  cameraModal.classList.add('hidden');
}

async function switchCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  try {
    await startCamera();
  } catch {
    // If switching fails, flip back
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
  }
}

async function capturePhoto() {
  const ctx = cameraCanvas.getContext('2d');
  cameraCanvas.width = cameraFeed.videoWidth;
  cameraCanvas.height = cameraFeed.videoHeight;
  ctx.drawImage(cameraFeed, 0, 0);

  closeCamera();

  cameraCanvas.toBlob(async blob => {
    if (!blob) {
      showError('Failed to capture photo. Please try again.');
      return;
    }
    // Save data URL for card display
    userImageDataUrl = cameraCanvas.toDataURL('image/jpeg', 0.85);
    await identifyMonster(blob);
  }, 'image/jpeg', 0.85);
}

// ============================
//   File Upload
// ============================

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Save data URL for card display
  userImageDataUrl = await fileToDataUrl(file);
  await identifyMonster(file);

  // Reset so the same file can be selected again
  fileInput.value = '';
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
//   Identify (shared by camera + upload)
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
  suggestionsEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  window.scrollTo({ top: loadingEl.offsetTop - 20, behavior: 'smooth' });
}

function hideLoading() {
  loadingEl.classList.add('hidden');
}

function showError(message, suggestion) {
  hideLoading();
  resultEl.classList.add('hidden');
  suggestionsEl.classList.remove('hidden');

  errorEl.innerHTML = `
    <div class="error-box">
      <div class="error-icon">😵</div>
      <div class="error-message">${escapeHtml(message)}</div>
      ${suggestion ? `<div class="error-suggestion">${escapeHtml(suggestion)}</div>` : ''}
      <button class="btn-retry" onclick="document.getElementById('search-input').focus()">Try Again</button>
    </div>
  `;
  errorEl.classList.remove('hidden');
  window.scrollTo({ top: errorEl.offsetTop - 20, behavior: 'smooth' });
}

async function showResult(monster) {
  hideLoading();
  errorEl.classList.add('hidden');
  suggestionsEl.classList.remove('hidden');

  // Try to fetch a Wikipedia image (only for text searches)
  let imageUrl = null;
  let imageCredit = null;

  if (userImageDataUrl) {
    imageUrl = userImageDataUrl;
    imageCredit = 'Your captured image';
  } else {
    const wikiImg = await fetchWikipediaImage(monster.name);
    if (wikiImg) {
      imageUrl = wikiImg.url;
      imageCredit = wikiImg.credit;
    }
  }

  resultEl.innerHTML = renderMonsterCard(monster, imageUrl, imageCredit);
  resultEl.classList.remove('hidden');
  window.scrollTo({ top: resultEl.offsetTop - 20, behavior: 'smooth' });
}

// ============================
//   Wikipedia Image Fetch
// ============================

async function fetchWikipediaImage(monsterName) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(monsterName)}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.originalimage?.source) {
      return {
        url: data.originalimage.source,
        credit: `Wikipedia — ${data.title}`
      };
    }
    if (data.thumbnail?.source) {
      return {
        url: data.thumbnail.source,
        credit: `Wikipedia — ${data.title}`
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ============================
//   Render Monster Card
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
      <div class="card-img-wrap">
        <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(m.name)}" class="monster-img"
             onerror="this.parentElement.outerHTML = renderPlaceholder('${escapeAttr(m.emoji || '👹')}')">
        <div class="img-overlay"></div>
        ${imageCredit ? `<div class="img-credit">${escapeHtml(imageCredit)}</div>` : ''}
      </div>
    `;
  } else {
    imageSection = `
      <div class="card-img-placeholder">
        <span>${m.emoji || '👹'}</span>
        <div class="img-overlay"></div>
      </div>
    `;
  }

  // Stats
  const statsHtml = m.stats ? Object.entries(m.stats).map(([key, val]) => `
    <div class="stat-block">
      <div class="stat-label">${escapeHtml(formatLabel(key))}</div>
      <div class="stat-value">${escapeHtml(val)}</div>
    </div>
  `).join('') : '';

  // Abilities
  const abilitiesHtml = Array.isArray(m.abilities) ? m.abilities.map(a => `
    <div class="ability-item">
      <span class="icon">${a.icon || '⚡'}</span>
      <span><strong>${escapeHtml(a.name)}</strong> — ${escapeHtml(a.description)}</span>
    </div>
  `).join('') : '';

  // Weaknesses
  const weaknessesHtml = Array.isArray(m.weaknesses) ? m.weaknesses.map(w => `
    <span class="weakness-tag">${escapeHtml(w)}</span>
  `).join('') : '';

  // Appearances
  const appearancesHtml = Array.isArray(m.appearances) ? m.appearances.map(a => `
    <div class="appearance-item">${escapeHtml(a)}</div>
  `).join('') : '';

  // Identified banner (for camera/upload results)
  const identifiedHtml = m._identified ? `
    <div class="identified-banner">
      📷 Identified as <strong>&nbsp;${escapeHtml(m._identifiedAs || m.name)}&nbsp;</strong> from your image
    </div>
  ` : '';

  return `
    <div class="result-card">
      ${imageSection}

      <div class="card-header">
        <div class="monster-name">${escapeHtml(m.name)}</div>
        ${akaText ? `<div class="monster-aka">${escapeHtml(akaText)}</div>` : ''}
        <div class="badge-row">
          <span class="badge badge-origin">${escapeHtml(m.origin || 'Unknown Origin')}</span>
          <span class="badge badge-type">${escapeHtml(m.type || 'Unknown Type')}</span>
          <span class="badge badge-danger">${skulls} ${escapeHtml(m.dangerLabel || 'Unknown')}</span>
        </div>
        <span class="card-header-emoji">${m.emoji || '👹'}</span>
      </div>

      <div class="card-body">
        ${identifiedHtml}

        <div>
          <div class="section-label">📖 Origins & Lore</div>
          <div class="description-text">${escapeHtml(m.lore || 'No lore available.')}</div>
        </div>

        ${statsHtml ? `
        <div>
          <div class="section-label">📊 Monster Profile</div>
          <div class="stat-grid">${statsHtml}</div>
        </div>
        ` : ''}

        ${abilitiesHtml ? `
        <div>
          <div class="section-label">⚡ Abilities & Powers</div>
          <div class="abilities-list">${abilitiesHtml}</div>
        </div>
        ` : ''}

        ${weaknessesHtml ? `
        <div>
          <div class="section-label">🛡️ Weaknesses</div>
          <div class="weaknesses-list">${weaknessesHtml}</div>
        </div>
        ` : ''}

        ${appearancesHtml ? `
        <div>
          <div class="section-label">🎬 Famous Appearances</div>
          <div class="appearances-list">${appearancesHtml}</div>
        </div>
        ` : ''}

        ${m.funFact ? `
        <div class="fun-fact-box">
          <span class="fun-fact-label">💀 Did you know?</span>
          ${escapeHtml(m.funFact)}
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Fallback for broken images — called via onerror
function renderPlaceholder(emoji) {
  return `<div class="card-img-placeholder"><span>${emoji}</span><div class="img-overlay"></div></div>`;
}
// Make available globally for onerror inline handler
window.renderPlaceholder = renderPlaceholder;

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
