/* Date Night Decider v3.1.2 remediation · P2P / WebRTC */
'use strict';

let p1Deck = [], p2Deck = [], p1Likes = [], p2Likes = [];
let swipePlayer = 1, swipeIndex = 0, draftItems = [], draftTurn = 1;
let peer = null, conn = null, remoteRoomId = null, myPlayerNum = 1, currentRoomPeerId = null;
let remoteSubmitSent = false;
let guestRoundId = null;
let pendingCompleteEntry = null;
let remotePartnerLikes = null;
let remoteGuestProgressLikes = [];
let remoteGuestSwipeIndex = 0;
let remoteMatchResolved = false;
let p2HeartbeatTimer = null;
let connectionState = 'disconnected';
let isDragging = false, startX = 0, currentX = 0, startTime = 0;
let swipeCardEl = null;
let turnRelayUnavailable = true;
let turnFallbackNoticeShown = false;
let lastPongAt = 0;
let connectionRecoveryTimer = null;
let connectionRecoveryAttempts = 0;

/* Configure a self-hosted PeerJS broker here before public release. Empty host uses the PeerJS public default. */
const PEER_SIGNALING_CONFIG = {
  host: '',
  port: 443,
  path: '/peerjs',
  secure: true,
  key: 'peerjs'
};

/* Obtain short-lived relay configuration from a deployed app backend. Static GitHub Pages has no /api endpoint by default. */
async function fetchEphemeralIceServers() {
  try {
    const response = await fetch(new URL('./api/get-ice-servers', window.location.href).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresInSeconds: 300 })
    });
    if (!response.ok) throw new Error(`ICE fetch failed with status ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.iceServers) || !data.iceServers.some(server => server && server.urls)) {
      throw new Error('ICE endpoint response did not include valid iceServers.');
    }
    turnRelayUnavailable = !data.iceServers.some(server => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some(url => typeof url === 'string' && /^turns?:/i.test(url));
    });
    if (turnRelayUnavailable && !turnFallbackNoticeShown) {
      turnFallbackNoticeShown = true;
      showToast('TURN relay is not configured. Live sync is best-effort and may fail on some LTE/5G or restrictive networks.', 6500);
    }
    return data.iceServers;
  } catch (error) {
    turnRelayUnavailable = true;
    if (!turnFallbackNoticeShown) {
      turnFallbackNoticeShown = true;
      showToast('TURN relay endpoint is unavailable. Live sync will use public STUN only and may fail on some mobile networks.', 6500);
    }
    console.warn('TURN relay config unavailable; falling back to public STUN:', error);
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }
}

let PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
  }
};

function buildPeerOptions() {
  const options = { ...PEER_OPTIONS, config: { ...PEER_OPTIONS.config } };
  if (PEER_SIGNALING_CONFIG.host) {
    options.host = PEER_SIGNALING_CONFIG.host;
    options.port = PEER_SIGNALING_CONFIG.port;
    options.path = PEER_SIGNALING_CONFIG.path;
    options.secure = PEER_SIGNALING_CONFIG.secure;
    options.key = PEER_SIGNALING_CONFIG.key;
  }
  return options;
}

function normalizeRoomCode(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
}

function generateRoomCode() {
  try {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return createUniqueId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 32);
  }
}

function roomPeerId(code) {
  return `datenight-${code}`;
}

function copyInviteLink() {
  if (!remoteRoomId || myPlayerNum !== 1 || !peer || !peer.open) {
    showToast('Start a live room and wait until the room is ready before copying its invite link.');
    return;
  }

  const invite = new URL(window.location.pathname, window.location.origin);
  invite.searchParams.set('room', remoteRoomId);
  const link = invite.href;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link)
      .then(() => showToast('Invite link copied to clipboard!'))
      .catch(() => showToast('Link ready: ' + link));
  } else {
    showToast('Link ready: ' + link);
  }
}

async function startP2PServer(presetCode = null) {
  if (!presetCode) {
    openLiveRoomModal('host');
    return;
  }
  const raw = presetCode;
  if (!raw) return;
  const code = normalizeRoomCode(raw);
  if (code.length < 12) {
    showToast('Use a room code at least 12 characters long.');
    return;
  }

  if (typeof window.Peer !== 'function') { showToast('PeerJS did not load. Check your connection and reload.'); return; }
  
  // Securely fetch dynamic ephemeral ICE servers before starting PeerJS session
  const dynamicIceServers = await fetchEphemeralIceServers();
  PEER_OPTIONS.config.iceServers = dynamicIceServers;

  cleanupPeerConnection();
  remoteRoomId = code;
  myPlayerNum = 1;
  currentRoomPeerId = roomPeerId(code);
  connectionState = 'creating';
  resetRemoteRound();
  try {
    peer = new Peer(currentRoomPeerId, buildPeerOptions());

    peer.on('disconnected', () => {
      connectionState = 'disconnected';
      try { peer.reconnect(); } catch (_) {}
    });

    peer.on('open', () => {
      connectionState = 'waiting';
      showToast(`Room “${code}” is ready as Player 1. Share your invite link!`);
      updateConnectionBanner();
    });
    
    peer.on('connection', incoming => {
      if (conn && conn.open) {
        incoming.close();
        showToast('A partner is already connected to this room.');
        return;
      }
      connectionState = 'connecting';
      conn = incoming;
      setupConnectionHandlers(conn);
      conn.on('open', () => {
        connectionRecoveryAttempts = 0;
        connectionState = 'connected';
        sendRoomState();
        startHeartbeat();
        showToast('Partner connected. The live room is synchronized.');
        updateSwipeCard();
      });
    });

    peer.on('error', error => {
      connectionState = 'disconnected';
      if (error.type === 'network' || error.type === 'socket-closed') {
        try { peer.reconnect(); } catch (_) {}
      } else if (error.type === 'unavailable-id') {
        showToast('That room code is already in use. Choose a different code.');
      } else {
        showToast(`Room error: ${error.type || 'Connection failed'}`);
      }
      updateConnectionBanner();
    });
  } catch (error) {
    connectionState = 'disconnected';
    cleanupPeerConnection();
    showToast('Could not start live room.');
  }
}

async function joinP2PServer(presetCode = null) {
  if (!presetCode) {
    openLiveRoomModal('join');
    return;
  }
  const raw = presetCode;
  if (!raw) return;
  const code = normalizeRoomCode(raw);
  if (code.length < 12) {
    showToast('Enter a room code at least 12 characters long.');
    return;
  }

  if (typeof window.Peer !== 'function') { showToast('PeerJS did not load. Check your connection and reload.'); return; }

  // Securely fetch dynamic ephemeral ICE servers before joining PeerJS session
  const dynamicIceServers = await fetchEphemeralIceServers();
  PEER_OPTIONS.config.iceServers = dynamicIceServers;

  cleanupPeerConnection();
  remoteRoomId = code;
  myPlayerNum = 2;
  currentRoomPeerId = roomPeerId(code);
  connectionState = 'connecting';
  try {
    peer = new Peer(buildPeerOptions());

    peer.on('disconnected', () => {
      connectionState = 'disconnected';
      try { peer.reconnect(); } catch (_) {}
    });

    peer.on('open', () => {
      conn = peer.connect(currentRoomPeerId, { reliable: true });
      setupConnectionHandlers(conn);
      conn.on('open', () => {
        connectionRecoveryAttempts = 0;
        connectionState = 'connected';
        showToast(`Connected to room “${code}” as Player 2. Waiting for host's shared deck…`);
        startHeartbeat();
        updateSwipeCard();
      });
    });

    peer.on('error', error => {
      connectionState = 'disconnected';
      if (error.type === 'network' || error.type === 'socket-closed') {
        try { peer.reconnect(); } catch (_) {}
      } else {
        showToast(`Join error: ${error.type || 'Could not connect'}`);
      }
      updateConnectionBanner();
    });
  } catch (error) {
    connectionState = 'disconnected';
    cleanupPeerConnection();
    showToast('Could not join live room.');
  }
}

function startHeartbeat() {
  if (p2HeartbeatTimer) window.clearInterval(p2HeartbeatTimer);
  lastPongAt = Date.now();
  p2HeartbeatTimer = window.setInterval(() => {
    if (!conn || !conn.open) return;
    sendP2PMessage({ type: 'PING', timestamp: Date.now() });
    if (Date.now() - lastPongAt > 30000) {
      console.warn('Live room heartbeat timed out; attempting reconnection.');
      try { conn.close(); } catch (_) {}
    }
  }, 10000);
}

function leaveLiveRoom() {
  if (!remoteRoomId) {
    showToast('You are not currently in a live room.');
    return;
  }
  showConfirmModal('Leave Live Room?', 'Are you sure you want to leave the live couple room and return to local play mode?', 'Live Sync', () => {
    cleanupPeerConnection();
    refreshDecks();
    initMatcher();
    showToast('Returned to local play mode.');
  });
}

function cleanupPeerConnection() {
  if (connectionRecoveryTimer) {
    window.clearTimeout(connectionRecoveryTimer);
    connectionRecoveryTimer = null;
  }
  connectionRecoveryAttempts = 0;
  if (p2HeartbeatTimer) {
    window.clearInterval(p2HeartbeatTimer);
    p2HeartbeatTimer = null;
  }
  try { if (conn) conn.close(); } catch (_) {}
  try { if (peer) peer.destroy(); } catch (_) {}
  conn = null;
  peer = null;
  remoteRoomId = null;
  currentRoomPeerId = null;
  myPlayerNum = 1;
  remoteSubmitSent = false;
  remotePartnerLikes = null;
  remoteGuestProgressLikes = [];
  remoteGuestSwipeIndex = 0;
  remoteMatchResolved = false;
  connectionState = 'disconnected';
  guestRoundId = null;
  pendingCompleteEntry = null;

  const completeButton = getEl('completeDateBtn');
  if (completeButton) completeButton.disabled = !window.currentWinner;

  updateSwipeCard();
}

function sendP2PMessage(payload) {
  if (!conn || !conn.open) return false;
  try { conn.send(payload); return true; }
  catch (error) { console.error('Could not send live-room message:', error); return false; }
}

function sendRoomState() {
  if (!remoteRoomId || myPlayerNum !== 1 || !conn || !conn.open) return;

  const budgetFilterEl = getEl('budgetFilter');
  sendP2PMessage({
    type: 'SYNC_STATE',
    matcherDeck: p1Deck,
    roundState: {
      swipeIndex,
      swipePlayer,
      likedIds: p1Likes.map(item => item.id),
      matchResolved: Boolean(remoteMatchResolved)
    },
    guestProgress: {
      swipeIndex: remoteGuestSwipeIndex,
      likedIds: remoteGuestProgressLikes.map(item => item.id)
    },
    draftState: draftItems.length ? { items: draftItems, turn: draftTurn } : null,
    winner: window.currentWinner ? sanitizeCard(window.currentWinner) : null,
    hostFilters: {
      categories: [...document.querySelectorAll('.category-choice:checked')].map(input => input.value),
      packs: [...selectedPacks],
      budget: budgetFilterEl ? budgetFilterEl.value : 'all'
    }
  });
}

function tryResolveRemoteMatch() {
  if (!remoteRoomId || myPlayerNum !== 1) return false;
  if (remoteMatchResolved) return false;
  if (!Array.isArray(remotePartnerLikes)) return false;
  if (swipeIndex < p1Deck.length) return false;

  const partnerLikeIds = new Set(remotePartnerLikes.filter(item => item && item.id).map(item => item.id));
  const mutual = p1Likes.filter(item => partnerLikeIds.has(item.id));

  remoteMatchResolved = true;
  handleMatchOutcome(mutual);
  return true;
}

function setupConnectionHandlers(thisConn) {
  if (!thisConn) return;

  thisConn.on('data', message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'PING') {
      sendP2PMessage({ type: 'PONG', timestamp: Date.now() });
      return;
    }
    if (message.type === 'PONG') {
      lastPongAt = Date.now();
      return;
    }

    if (message.type === 'REQUEST_STATE' && myPlayerNum === 1) {
      sendRoomState();
      return;
    }

    if (message.type === 'SWIPE_PROGRESS') {
      if (myPlayerNum === 1 && message.player === 2) {
        const ids = new Set(Array.isArray(message.likedIds) ? message.likedIds.filter(id => typeof id === 'string') : []);
        remoteGuestProgressLikes = p1Deck.filter(card => ids.has(card.id));
        remoteGuestSwipeIndex = Number.isInteger(message.swipeIndex) ? Math.max(0, Math.min(message.swipeIndex, p1Deck.length)) : remoteGuestSwipeIndex;
      }
      return;
    }

    if (message.type === 'SYNC_STATE' && myPlayerNum === 2) {
      if (!Array.isArray(message.matcherDeck)) return;

      const sharedDeck = sanitizeCardDeck(message.matcherDeck);
      p1Deck = [...sharedDeck];
      p2Deck = [...sharedDeck];

      p1Likes = [];
      p2Likes = [];
      swipeIndex = 0;
      swipePlayer = 1;
      remoteSubmitSent = false;
      remotePartnerLikes = null;
      remoteMatchResolved = false;
      if (message.roundState && typeof message.roundState === 'object') {
        const likeIds = new Set(Array.isArray(message.roundState.likedIds) ? message.roundState.likedIds.filter(id => typeof id === 'string') : []);
        p1Likes = sharedDeck.filter(card => likeIds.has(card.id));
        remoteMatchResolved = Boolean(message.roundState.matchResolved);
      }
      const guestProgress = message.guestProgress && typeof message.guestProgress === 'object' ? message.guestProgress : { swipeIndex: 0, likedIds: [] };
      const guestLikeIds = new Set(Array.isArray(guestProgress.likedIds) ? guestProgress.likedIds.filter(id => typeof id === 'string') : []);
      p2Likes = sharedDeck.filter(card => guestLikeIds.has(card.id));
      swipeIndex = Number.isInteger(guestProgress.swipeIndex) ? Math.max(0, Math.min(guestProgress.swipeIndex, sharedDeck.length)) : 0;
      swipePlayer = 2;
      draftItems = message.draftState && Array.isArray(message.draftState.items)
        ? message.draftState.items.map(raw => { const item = sanitizeCard(raw); return item ? { ...item, banned: Boolean(raw && raw.banned) } : null; }).filter(Boolean)
        : [];
      draftTurn = message.draftState && message.draftState.turn === 2 ? 2 : 1;
      window.currentWinner = message.winner ? sanitizeCard(message.winner) : null;

      const decisionModal = getEl('decisionModal');
      const votingModal = getEl('votingModal');
      if (decisionModal) decisionModal.classList.remove('show');
      if (votingModal) votingModal.classList.remove('show');

      if (message.hostFilters && typeof message.hostFilters === 'object') {
        const hostFilters = message.hostFilters;
        if (Array.isArray(hostFilters.categories)) {
          const categorySet = new Set(
            hostFilters.categories.filter(value => DEFAULT_CATEGORIES.includes(value))
          );
          document.querySelectorAll('.category-choice').forEach(input => {
            input.checked = categorySet.has(input.value);
          });
        }
        if (Array.isArray(hostFilters.packs)) {
          selectedPacks = [...new Set(hostFilters.packs.filter(value =>
            value === 'starter' || Object.prototype.hasOwnProperty.call(expansionDecks, value)
          ))];
          renderPackChoices();
        }
        if (['all', 'free', 'paid'].includes(hostFilters.budget)) {
          const budgetEl = getEl('budgetFilter');
          if (budgetEl) budgetEl.value = hostFilters.budget;
        }
      }

      updateSwipeCard();
      if (window.currentWinner) {
        showModal('Live Room Resumed', window.currentWinner.title, window.currentWinner.detail);
      } else if (draftItems.length) {
        renderDraftGrid();
        const draftModal = getEl('votingModal');
        if (draftModal) draftModal.classList.add('show');
      }
      return;
    }

    if (message.type === 'NEW_ROUND' && myPlayerNum === 2) {
      const decisionModal = getEl('decisionModal');
      const votingModal = getEl('votingModal');
      if (decisionModal) decisionModal.classList.remove('show');
      if (votingModal) votingModal.classList.remove('show');
      window.currentWinner = null;
      remoteSubmitSent = false;
      return;
    }

    if (message.type === 'SUBMIT_SWIPES' && myPlayerNum === 1) {
      remotePartnerLikes = sanitizeCardDeck(message.likedCards);
      remoteGuestProgressLikes = [...remotePartnerLikes];
      remoteGuestSwipeIndex = p1Deck.length;
      tryResolveRemoteMatch();
      updateSwipeCard();
      return;
    }

    if (message.type === 'MATCH_WINNER' && myPlayerNum === 2) {
      const winnerId = limitText(message.winnerId, 80);
      const winner = p2Deck.find(item => item.id === winnerId) || fullDeck.find(item => item.id === winnerId);
      if (winner) {
        const votingModal = getEl('votingModal');
        if (votingModal) votingModal.classList.remove('show');
        window.currentWinner = winner;
        showModal('It’s a Match!', winner.title, winner.detail);
      }
      return;
    }

    if (message.type === 'NO_MUTUAL_MATCHES' && myPlayerNum === 2) {
      showNoMutualMatches();
      return;
    }

    if (message.type === 'REQUEST_NEW_ROUND' && myPlayerNum === 1) {
      restartMatcherAfterNoMatch();
      return;
    }

    if (message.type === 'REQUEST_FILTER_CHANGE' && myPlayerNum === 1) {
      const votingModal = getEl('votingModal');
      if (votingModal) votingModal.classList.remove('show');
      const actions = getEl('noMatchesActions');
      if (actions) actions.hidden = true;
      const picker = getEl('categoryPicker');
      if (picker) picker.open = true;
      const summary = getEl('categorySummary');
      if (summary) summary.focus();
      showToast('Your partner requested a pack/category change. Adjust filters to restart the round.');
      return;
    }

    if (message.type === 'MUTUAL_DRAFT_START' && myPlayerNum === 2) {
      draftItems = sanitizeCardDeck(message.draftItems).map(item => ({
        ...item,
        banned: item.banned === true
      }));
      draftTurn = Number(message.draftTurn) === 2 ? 2 : 1;
      const actions = getEl('noMatchesActions');
      if (actions) actions.hidden = true;
      const eyebrow = getEl('votingEyebrow');
      const title = getEl('votingModalTitle');
      if (eyebrow) eyebrow.textContent = 'Mutual Match Draft';
      if (title) title.textContent = 'Take Turns Eliminating';
      renderDraftGrid();
      const modal = getEl('votingModal');
      if (modal) modal.classList.add('show');
      return;
    }

    if (message.type === 'BAN_REQUEST' && myPlayerNum === 1) {
      if (draftTurn === 2 && Number.isInteger(message.index)) executeBan(message.index);
      return;
    }

    if (message.type === 'DRAFT_STATE' && myPlayerNum === 2) {
      draftItems = sanitizeCardDeck(message.draftItems).map(item => ({
        ...item,
        banned: item.banned === true
      }));
      draftTurn = Number(message.draftTurn) === 2 ? 2 : 1;
      renderDraftGrid();
      const remaining = draftItems.filter(item => !item.banned);
      if (remaining.length === 1) {
        window.currentWinner = remaining[0];
        const votingModal = getEl('votingModal');
        if (votingModal) votingModal.classList.remove('show');
        showModal('Winner by Elimination!', remaining[0].title, remaining[0].detail);
      }
      return;
    }

    if (message.type === 'COMPLETE_DATE_REQUEST' && myPlayerNum === 1) {
      const incomingEntry = sanitizeHistoryEntry(message.entry);
      if (!incomingEntry) {
        sendP2PMessage({
          type: 'COMPLETE_DATE_ACK',
          syncId: limitText(message.entry?.syncId, 120),
          ok: false
        });
        return;
      }

      const alreadySaved = dateHistory.some(record => record.syncId === incomingEntry.syncId);
      if (alreadySaved) {
        sendP2PMessage({ type: 'COMPLETE_DATE_ACK', syncId: incomingEntry.syncId, ok: true });
        return;
      }

      persistHistoryEntry(incomingEntry, true)
        .then(saved => {
          const ok = Boolean(saved);
          sendP2PMessage({ type: 'COMPLETE_DATE_ACK', syncId: incomingEntry.syncId, ok });
          if (ok) closeModal();
        })
        .catch(error => {
          console.error('Could not save partner-completed date:', error);
          sendP2PMessage({ type: 'COMPLETE_DATE_ACK', syncId: incomingEntry.syncId, ok: false });
        });

      return;
    }

    if (message.type === 'COMPLETE_DATE_ACK' && myPlayerNum === 2) {
      if (!pendingCompleteEntry || message.syncId !== pendingCompleteEntry.syncId) return;

      const entry = pendingCompleteEntry;
      pendingCompleteEntry = null;

      const completeButton = getEl('completeDateBtn');
      if (completeButton) completeButton.disabled = !window.currentWinner;

      if (message.ok === true) {
        persistHistoryEntry(entry, false)
          .then(() => {
            closeModal();
            showToast('Date completion confirmed and saved.');
          })
          .catch(error => {
            console.error('Could not save the confirmed date locally:', error);
          });
      } else {
        showToast('The host could not confirm the save.');
      }

      return;
    }

    if (message.type === 'HISTORY_ENTRY' && myPlayerNum === 2 && message.entry) {
      receiveHistoryEntry(message.entry).catch(error => console.error('Could not receive history entry:', error));
    }
  });

  thisConn.on('open', () => {
    conn = thisConn;
    connectionRecoveryAttempts = 0;
    connectionState = 'connected';
    if (myPlayerNum === 2 && pendingCompleteEntry) {
      sendP2PMessage({ type: 'COMPLETE_DATE_REQUEST', entry: pendingCompleteEntry });
    }
    updateSwipeCard();
  });

  thisConn.on('close', () => {
    if (thisConn !== conn) return;
    conn = null;
    connectionState = 'disconnected';
    remoteSubmitSent = false;
    updateSwipeCard();
    if (!remoteRoomId) return;
    if (connectionRecoveryTimer) window.clearTimeout(connectionRecoveryTimer);
    if (connectionRecoveryAttempts >= 5) {
      showToast('Live room could not reconnect. Your local swipe state is preserved; retry the room when both devices are online.');
      updateConnectionBanner();
      return;
    }
    connectionRecoveryAttempts++;
    const attemptNumber = connectionRecoveryAttempts;
    connectionRecoveryTimer = window.setTimeout(() => {
      connectionRecoveryTimer = null;
      if (!remoteRoomId || conn && conn.open || !peer || peer.destroyed) return;
      try {
        if (peer.disconnected && typeof peer.reconnect === 'function') peer.reconnect();
        if (myPlayerNum === 2) {
          const newConn = peer.connect(currentRoomPeerId, { reliable: true });
          conn = newConn;
          setupConnectionHandlers(newConn);
          newConn.on('open', () => {
            connectionRecoveryAttempts = 0;
            connectionState = 'connected';
            showToast('Reconnected to the live room. Syncing progress…');
            sendP2PMessage({ type: 'REQUEST_STATE' });
            if (pendingCompleteEntry) sendP2PMessage({ type: 'COMPLETE_DATE_REQUEST', entry: pendingCompleteEntry });
            startHeartbeat();
            updateSwipeCard();
          });
        }
        /* The host remains available on its existing Peer ID; its peer connection handler accepts the guest again. */
      } catch (error) {
        console.warn('Room reconnection attempt failed:', error);
        connectionState = 'disconnected';
        updateConnectionBanner();
      }
    }, Math.min(1000 * attemptNumber, 5000));
    showToast('Connection lost. Attempting to resume the live room…');
  });
}

