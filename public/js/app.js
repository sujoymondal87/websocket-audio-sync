// app.js — Leader + Follower logic

const WS_URL = window.location.protocol === 'https:'
  ? `wss://${window.location.host}`
  : `ws://${window.location.host}`;

// ── State ──
let role = null;
let roomId = null;
let currentBlock = null;
let isPlaying = false;
let isMuted = false;
let syncClient = null;
let audioUnlocked = false;
let lastSeq = -1;

// ── DOM refs ──
const $ = id => document.getElementById(id);
const homeScreen = $('homeScreen');
const app = $('app');
const audioEl = $('audioEl');
const blockTabs = $('blockTabs');
const mediaContainer = $('mediaContainer');
const blockTitle = $('blockTitle');
const blockText = $('blockText');
const playBtn = $('playBtn');
const progressBar = $('progressBar');
const progressFill = $('progressFill');
const currentTimeEl = $('currentTime');
const totalTimeEl = $('totalTime');
const muteBtn = $('muteBtn');
const overlayMuteBtn = $('overlayMuteBtn');
const followerOverlay = $('followerOverlay');
const syncFlash = $('syncFlash');
const eventLog = $('eventLog');
const roleBadge = $('roleBadge');
const roomCodeBadge = $('roomCodeBadge');
const followerCount = $('followerCount');
const seqNum = $('seqNum');
const latencyStat = $('latencyStat');
const latencyMs = $('latencyMs');
const connectionBadge = $('connectionBadge');

// ── Utility ──
function generateCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function formatTime(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function logEvent(type, body) {
  const now = new Date().toLocaleTimeString('en', { hour12: false });
  const row = document.createElement('div');
  row.className = 'event-row';
  row.innerHTML = `<span class="event-time">${now}</span><span class="event-type">${type}</span><span class="event-body">${body}</span>`;
  eventLog.prepend(row);
  if (eventLog.children.length > 50) eventLog.removeChild(eventLog.lastChild);
}

function showSyncFlash(label = '⚡ synced') {
  syncFlash.textContent = label;
  syncFlash.classList.add('show');
  setTimeout(() => syncFlash.classList.remove('show'), 1200);
}

// ── iOS audio unlock ──
document.addEventListener('touchstart', unlockAudio, { once: true });
document.addEventListener('click', unlockAudio, { once: true });

function unlockAudio() {
  if (audioUnlocked) return;
  audioEl.play().catch(() => {});
  audioEl.pause();
  audioUnlocked = true;
}

// ── Home screen ──
$('createRoomBtn').onclick = () => {
  const code = generateCode();
  $('generatedCode').textContent = code;
  $('leaderCodeDisplay').style.display = 'block';
  $('createRoomBtn').style.display = 'none';
  $('enterAsLeaderBtn').dataset.code = code;
};

$('enterAsLeaderBtn').onclick = (e) => {
  const code = e.target.dataset.code;
  startApp('leader', code);
};

$('joinAsFollowerBtn').onclick = () => {
  const code = $('followerCodeInput').value.trim().toUpperCase();
  if (code.length < 2) return;
  startApp('follower', code);
};

$('followerCodeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('joinAsFollowerBtn').click();
});

// ── Start app ──
function startApp(r, code) {
  role = r;
  roomId = code;

  homeScreen.style.display = 'none';
  app.classList.add('visible');

  roleBadge.textContent = role === 'leader' ? '🎙 Leader' : '🎧 Follower';
  roleBadge.className = `badge badge-${role}`;
  roomCodeBadge.textContent = roomId;

  if (role === 'follower') {
    followerOverlay.classList.add('visible');
    playBtn.disabled = true;
    latencyStat.style.display = 'flex';
  }

  buildTabs();
  initWS();
}

// ── Build block tabs ──
function buildTabs() {
  blockTabs.innerHTML = '';
  TOUR_DATA.forEach(block => {
    const tab = document.createElement('div');
    tab.className = 'block-tab';
    tab.dataset.id = block.id;
    tab.innerHTML = `<span class="stop-num">${block.stop}</span>${block.title}`;
    tab.onclick = () => {
      if (role !== 'leader') return;
      selectBlock(block.id, true); // true = broadcast
    };
    blockTabs.appendChild(tab);
  });
}

// ── Select block ──
function selectBlock(blockId, broadcast = false) {
  const block = TOUR_DATA.find(b => b.id === blockId);
  if (!block) return;

  currentBlock = block;

  // Update tabs
  document.querySelectorAll('.block-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.id === blockId);
  });

  // Update content
  blockTitle.textContent = block.title;
  blockText.textContent = block.text;

  // Media
  renderMedia(block);

  // Audio
  stopAudio();
  if (block.audio_url && block.media_type !== 'video') {
    audioEl.src = block.audio_url;
    audioEl.load();
    playBtn.disabled = false;
  } else {
    playBtn.disabled = true;
  }
  updateProgress();

  if (broadcast && role === 'leader') {
    syncClient.sendSceneChange(blockId);
    logEvent('scene_change', `→ Stop ${block.stop}: ${block.title}`);
  }
}

// ── Render media ──
function renderMedia(block) {
  mediaContainer.innerHTML = '';
  if (block.media_type === 'video') {
    const video = document.createElement('video');
    video.src = block.media_url;
    video.controls = role === 'leader';
    video.playsInline = true;
    video.muted = isMuted;
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    // Leader: seeking/play/pause syncs to followers
    if (role === 'leader') {
      video.addEventListener('play', () => {
        syncClient.sendAudioCommand('play', block.id, video.currentTime);
        isPlaying = true;
        logEvent('play', `video pos=${video.currentTime.toFixed(1)}s`);
      });
      video.addEventListener('pause', () => {
        syncClient.sendAudioCommand('pause', block.id, video.currentTime);
        isPlaying = false;
        logEvent('pause', `video pos=${video.currentTime.toFixed(1)}s`);
      });
      video.addEventListener('seeked', () => {
        syncClient.sendAudioCommand('seek', block.id, video.currentTime);
        logEvent('seek', `video → ${video.currentTime.toFixed(1)}s`);
      });
    }
    mediaContainer.appendChild(video);
  } else if (block.media_type === 'image') {
    const img = document.createElement('img');
    img.src = block.media_url;
    img.alt = block.title;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    mediaContainer.appendChild(img);
  } else {
    mediaContainer.innerHTML = '<div class="media-placeholder">Audio only</div>';
  }
}

// ── Audio controls (leader only for play/pause/seek) ──
playBtn.onclick = () => {
  if (role !== 'leader') return;
  if (isPlaying) {
    audioEl.pause();
  } else {
    audioEl.play().catch(() => {});
  }
};

audioEl.addEventListener('play', () => {
  isPlaying = true;
  playBtn.textContent = '⏸';
  if (role === 'leader' && currentBlock) {
    syncClient.sendAudioCommand('play', currentBlock.id, audioEl.currentTime);
    logEvent('play', `audio pos=${audioEl.currentTime.toFixed(1)}s`);
  }
});

audioEl.addEventListener('pause', () => {
  isPlaying = false;
  playBtn.textContent = '▶';
  if (role === 'leader' && currentBlock) {
    syncClient.sendAudioCommand('pause', currentBlock.id, audioEl.currentTime);
    logEvent('pause', `audio pos=${audioEl.currentTime.toFixed(1)}s`);
  }
});

audioEl.addEventListener('timeupdate', updateProgress);
audioEl.addEventListener('loadedmetadata', updateProgress);

// Seek on progress bar click (leader only)
progressBar.addEventListener('click', (e) => {
  if (role !== 'leader') return;
  const rect = progressBar.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const seekTo = ratio * (audioEl.duration || 0);
  audioEl.currentTime = seekTo;
  if (role === 'leader' && currentBlock) {
    syncClient.sendAudioCommand('seek', currentBlock.id, seekTo);
    logEvent('seek', `audio → ${seekTo.toFixed(1)}s`);
  }
});

function updateProgress() {
  const duration = audioEl.duration || 0;
  const current = audioEl.currentTime || 0;
  const pct = duration > 0 ? (current / duration) * 100 : 0;
  progressFill.style.width = `${pct}%`;
  currentTimeEl.textContent = formatTime(current);
  totalTimeEl.textContent = formatTime(duration);
}

function stopAudio() {
  audioEl.pause();
  audioEl.currentTime = 0;
  isPlaying = false;
  playBtn.textContent = '▶';
}

// ── Mute ──
function toggleMute() {
  isMuted = !isMuted;
  audioEl.muted = isMuted;
  muteBtn.textContent = isMuted ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', isMuted);
  overlayMuteBtn.textContent = isMuted ? '🔇 Muted' : '🔊 Unmuted';
  overlayMuteBtn.classList.toggle('muted', isMuted);
  // Also mute any video
  const video = mediaContainer.querySelector('video');
  if (video) video.muted = isMuted;
}

muteBtn.onclick = toggleMute;
overlayMuteBtn.onclick = toggleMute;

// ── WebSocket ──
function initWS() {
  syncClient = new SyncClient({
    url: WS_URL,
    onOpen: () => {
      connectionBadge.textContent = '● connected';
      connectionBadge.className = 'badge badge-online';
      logEvent('connected', `as ${role} to room ${roomId}`);
      // Wait for welcome before joining
    },
    onClose: () => {
      connectionBadge.textContent = '● disconnected';
      connectionBadge.className = 'badge badge-offline';
      logEvent('disconnected', 'reconnecting...');
    },
    onMessage: handleMessage,
  });
  syncClient.connect();
}

function handleMessage(msg) {
  switch (msg.type) {

    case 'welcome':
      syncClient.joinRoom(roomId, role);
      break;

    case 'room_joined':
      updateRoomState(msg.roomState);
      logEvent('room_joined', `${role} in room ${roomId}`);
      if (role === 'leader' && TOUR_DATA.length > 0) {
        selectBlock(TOUR_DATA[0].id, false);
      }
      // Follower: if room has existing state, apply it
      if (role === 'follower' && msg.roomState?.currentBlockId) {
        selectBlock(msg.roomState.currentBlockId, false);
      }
      break;

    case 'member_update':
      updateRoomState(msg.roomState);
      break;

    case 'relay':
      handleRelay(msg);
      break;

    case 'error':
      logEvent('error', msg.message);
      break;
  }
}

function updateRoomState(state) {
  if (!state) return;
  followerCount.textContent = state.followerCount ?? '—';
  seqNum.textContent = state.seq ?? '—';
}

function handleRelay(msg) {
  // Ignore stale messages
  if (msg.seq !== undefined && msg.seq <= lastSeq) return;
  if (msg.seq !== undefined) lastSeq = msg.seq;

  seqNum.textContent = msg.seq ?? '—';

  if (msg.type === 'relay' && msg.scene_change !== undefined) {
    // shouldn't happen — relay preserves original type fields
  }

  // Scene change
  if (msg.originalType === 'scene_change') {
    if (role === 'follower') {
      const delay = syncClient.scheduleAt(msg.executeAtServerMs, () => {
        selectBlock(msg.blockId, false);
        followerOverlay.classList.remove('visible');
        showSyncFlash('⚡ scene sync');
      });
      logEvent('scene_change', `Stop ${TOUR_DATA.find(b=>b.id===msg.blockId)?.stop} · delay=${delay}ms`);
      latencyMs.textContent = `${delay}ms`;
    }
    return;
  }

  // Audio command
  if (msg.command) {
    if (role === 'follower') {
      const delay = syncClient.scheduleAt(msg.executeAtServerMs, () => {
        applyAudioCommand(msg);
        showSyncFlash(`⚡ ${msg.command}`);
        followerOverlay.classList.remove('visible');
      });
      logEvent(msg.command, `block=${msg.blockId} pos=${msg.positionSec?.toFixed(1)}s delay=${delay}ms`);
      latencyMs.textContent = `${delay}ms`;
    } else {
      // Leader gets ack
      logEvent(`ack:${msg.command}`, `seq=${msg.seq}`);
    }
  }
}

function applyAudioCommand(cmd) {
  if (!currentBlock || currentBlock.id !== cmd.blockId) {
    selectBlock(cmd.blockId, false);
  }

  const video = mediaContainer.querySelector('video');

  if (cmd.command === 'play') {
    if (video) {
      video.currentTime = cmd.positionSec || 0;
      video.play().catch(() => {});
    } else {
      audioEl.currentTime = cmd.positionSec || 0;
      audioEl.play().catch(() => {});
    }
    isPlaying = true;
    playBtn.textContent = '⏸';
  } else if (cmd.command === 'pause') {
    if (video) video.pause();
    else audioEl.pause();
    isPlaying = false;
    playBtn.textContent = '▶';
  } else if (cmd.command === 'seek') {
    if (video) video.currentTime = cmd.positionSec || 0;
    else audioEl.currentTime = cmd.positionSec || 0;
  } else if (cmd.command === 'stop') {
    if (video) { video.pause(); video.currentTime = 0; }
    else stopAudio();
  }
}
