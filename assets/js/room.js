/* =========================================================================
   SOUNDSPHERE — PHÒNG NGHE CÙNG (LISTEN / JAM ROOM)
   Hỗ trợ đồng bộ Realtime hai chiều giữa Web và Flutter Mobile App
   ========================================================================= */

const roomState = {
  roomId: null,
  isHost: false,
  unsubscribe: null,
  unsubscribeReactions: null,
  heartbeatTimer: null,
};

const ROOM_COLLECTION = "listenRooms";
const ROOM_HEARTBEAT_MS = 3000;
const ROOM_DRIFT_THRESHOLD = 1.0;
const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000;
const ROOM_LOCALSTORAGE_KEY = "soundsphere_active_room";

function saveRoomToLocalStorage(code, isHost) {
  try {
    localStorage.setItem(
      ROOM_LOCALSTORAGE_KEY,
      JSON.stringify({ code, isHost, savedAt: Date.now() }),
    );
  } catch (_) {}
}

function readRoomFromLocalStorage() {
  try {
    const raw = localStorage.getItem(ROOM_LOCALSTORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearRoomFromLocalStorage() {
  try {
    localStorage.removeItem(ROOM_LOCALSTORAGE_KEY);
  } catch (_) {}
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// =========================================================================
// MỞ / ĐÓNG MODAL
// =========================================================================

function openRoomModal() {
  const overlay = document.getElementById("roomOverlay");
  if (!overlay) return;
  overlay.classList.add("active");
  overlay.style.display = "flex";

  const user = window.auth && window.auth.currentUser;
  const loginReq = document.getElementById("roomLoginRequired");
  if (loginReq) loginReq.style.display = user ? "none" : "block";

  const btnCreate = document.getElementById("btnCreateRoom");
  const btnJoin = document.getElementById("btnJoinRoom");
  if (btnCreate) btnCreate.disabled = !user;
  if (btnJoin) btnJoin.disabled = !user;

  if (roomState.roomId) {
    showRoomInRoomUI();
  } else {
    document.getElementById("roomStateNotInRoom").style.display = "block";
    document.getElementById("roomStateInRoom").style.display = "none";
  }
}

function closeRoomModal() {
  const overlay = document.getElementById("roomOverlay");
  if (!overlay) return;
  overlay.classList.remove("active");
  overlay.style.display = "none";
}

// =========================================================================
// TẠO PHÒNG (HOST) & THAM GIA (GUEST)
// =========================================================================

async function createListenRoom() {
  const user = window.auth && window.auth.currentUser;
  if (!user) {
    showToast("Vui lòng đăng nhập để tạo phòng.", "error");
    return;
  }

  await waitForFirestoreInRoom();
  const code = generateRoomCode();
  const song = state.currentSong;

  try {
    const songData = song
      ? {
          docId: song.docId || String(song.id),
          id: song.id,
          title: song.title,
          artist: song.artist,
          genre: song.genre || "Pop",
          coverUrl: song.cover,
          audioUrl: song.src,
          lyrics: song.lyrics || "",
        }
      : null;

    await window.setDoc(window.doc(window.db, ROOM_COLLECTION, code), {
      hostUid: user.uid,
      hostId: user.uid,
      hostName: user.displayName || user.email || "Host",
      hostAvatar: user.photoURL || "",
      currentSongId: song ? song.id : null,
      songData: songData,
      isPlaying: !!state.isPlaying,
      position: audio.currentTime || 0,
      positionMs: Math.round((audio.currentTime || 0) * 1000),
      updatedAt: window.serverTimestamp(),
      updatedAtServer: window.serverTimestamp(),
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      membersCount: 1,
      members: {
        [user.uid]: {
          name: user.displayName || user.email || "Bạn",
          avatar: user.photoURL || "",
          joinedAt: Date.now(),
        },
      },
    });

    roomState.roomId = code;
    roomState.isHost = true;
    saveRoomToLocalStorage(code, true);
    attachRoomListener(code);
    attachReactionsListener(code);
    startHostHeartbeat();
    lockControlsForGuest(false);
    showRoomInRoomUI();
    showToast(`Đã tạo phòng ${code}!`, "success");
  } catch (e) {
    console.error(e);
    showToast("Không tạo được phòng: " + e.message, "error");
  }
}

async function joinListenRoom(codeRaw) {
  const user = window.auth && window.auth.currentUser;
  if (!user) {
    showToast("Vui lòng đăng nhập để tham gia phòng.", "error");
    if (typeof openAuthModal === "function") openAuthModal();
    return;
  }

  const code = (codeRaw || "").trim().toUpperCase();
  if (!code) {
    showToast("Vui lòng nhập mã phòng.", "error");
    return;
  }

  await waitForFirestoreInRoom();

  try {
    const roomRef = window.doc(window.db, ROOM_COLLECTION, code);
    const snap = await window.getDoc(roomRef);
    if (!snap.exists()) {
      showToast("Không tìm thấy phòng với mã này.", "error");
      clearRoomFromLocalStorage();
      return;
    }

    const data = snap.data();
    const lastActive = data.lastActiveAt || data.createdAt || 0;
    if (Date.now() - lastActive > ROOM_EXPIRY_MS) {
      showToast("Phòng này đã hết hạn.", "error");
      clearRoomFromLocalStorage();
      return;
    }

    if (data.hostUid === user.uid || data.hostId === user.uid) {
      roomState.roomId = code;
      roomState.isHost = true;
      saveRoomToLocalStorage(code, true);
      attachRoomListener(code);
      attachReactionsListener(code);
      startHostHeartbeat();
      lockControlsForGuest(false);
      showRoomInRoomUI();
      closeRoomModal();
      showToast(`Quay lại phòng ${code} — bạn là chủ phòng 🎧`, "success");
      return;
    }

    await window.updateDoc(roomRef, {
      membersCount: window.increment ? window.increment(1) : (data.membersCount || 1) + 1,
      [`members.${user.uid}`]: {
        name: user.displayName || user.email || "Khách",
        avatar: user.photoURL || "",
        joinedAt: Date.now(),
      },
    });

    roomState.roomId = code;
    roomState.isHost = false;
    saveRoomToLocalStorage(code, false);
    attachRoomListener(code);
    attachReactionsListener(code);
    lockControlsForGuest(true);
    showRoomInRoomUI();
    closeRoomModal();
    showToast(`Đã vào phòng ${code} — đang nghe cùng 🎧`, "success");
  } catch (e) {
    console.error(e);
    showToast("Không vào được phòng: " + e.message, "error");
  }
}

async function leaveListenRoom() {
  if (!roomState.roomId) return;
  const code = roomState.roomId;
  const wasHost = roomState.isHost;
  const user = window.auth && window.auth.currentUser;

  _cleanupListeners();
  stopHostHeartbeat();

  try {
    if (!wasHost && user) {
      const roomRef = window.doc(window.db, ROOM_COLLECTION, code);
      const snap = await window.getDoc(roomRef);
      if (snap.exists()) {
        const members = { ...(snap.data().members || {}) };
        delete members[user.uid];
        await window.updateDoc(roomRef, {
          members,
          membersCount: Math.max(1, (snap.data().membersCount || 2) - 1),
        });
      }
    }
  } catch (_) {}

  roomState.roomId = null;
  roomState.isHost = false;
  clearRoomFromLocalStorage();
  lockControlsForGuest(false);
  document.getElementById("roomActiveBanner").style.display = "none";
  closeRoomModal();
  showToast(wasHost ? "Đã rời phòng." : "Đã thoát phòng nghe cùng.", "info");
}

async function closeListenRoomAsHost() {
  if (!roomState.roomId || !roomState.isHost) return;
  if (!confirm("Đóng phòng nghe cùng? Mọi người sẽ bị ngắt kết nối.")) return;

  const code = roomState.roomId;
  _cleanupListeners();
  stopHostHeartbeat();

  try {
    await window.deleteDoc(window.doc(window.db, ROOM_COLLECTION, code));
  } catch (_) {}

  roomState.roomId = null;
  roomState.isHost = false;
  clearRoomFromLocalStorage();
  lockControlsForGuest(false);
  document.getElementById("roomActiveBanner").style.display = "none";
  closeRoomModal();
  showToast("Đã đóng phòng.", "info");
}

// =========================================================================
// REALTIME LISTENERS & TƯƠNG THÍCH HAI CHIỀU
// =========================================================================

function attachRoomListener(code) {
  const roomRef = window.doc(window.db, ROOM_COLLECTION, code);
  roomState.unsubscribe = window.onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) {
      if (!roomState.isHost) {
        showToast("Chủ phòng đã đóng phòng nghe cùng.", "info");
        forceLeaveLocally();
      }
      return;
    }
    const data = snap.data();
    updateRoomModalUI(data);
    updateRoomBanner(code, data);

    if (!roomState.isHost) {
      applyHostStateToGuest(data);
    }
  });
}

function attachReactionsListener(code) {
  if (roomState.unsubscribeReactions) {
    roomState.unsubscribeReactions();
  }
  const reactCol = window.collection(window.db, ROOM_COLLECTION, code, "reactions");
  const q = window.query(reactCol, window.where("timestamp", "!=", null));

  let initialLoad = true;
  roomState.unsubscribeReactions = window.onSnapshot(q, (snap) => {
    if (initialLoad) {
      initialLoad = false;
      return;
    }
    snap.docChanges().forEach((change) => {
      if (change.type === "added") {
        const emoji = change.doc.data().emoji;
        if (emoji) spawnFloatingEmoji(emoji);
      }
    });
  });
}

function _cleanupListeners() {
  if (roomState.unsubscribe) {
    roomState.unsubscribe();
    roomState.unsubscribe = null;
  }
  if (roomState.unsubscribeReactions) {
    roomState.unsubscribeReactions();
    roomState.unsubscribeReactions = null;
  }
}

function forceLeaveLocally() {
  _cleanupListeners();
  stopHostHeartbeat();
  roomState.roomId = null;
  roomState.isHost = false;
  clearRoomFromLocalStorage();
  lockControlsForGuest(false);
  const banner = document.getElementById("roomActiveBanner");
  if (banner) banner.style.display = "none";
  closeRoomModal();
}

async function broadcastHostState() {
  if (!roomState.roomId || !roomState.isHost) return;
  const song = state.currentSong;

  const songData = song
    ? {
        docId: song.docId || String(song.id),
        id: song.id,
        title: song.title,
        artist: song.artist,
        genre: song.genre || "Pop",
        coverUrl: song.cover,
        audioUrl: song.src,
        lyrics: song.lyrics || "",
      }
    : null;

  try {
    await window.updateDoc(window.doc(window.db, ROOM_COLLECTION, roomState.roomId), {
      currentSongId: song ? song.id : null,
      songData: songData,
      isPlaying: !!state.isPlaying,
      position: audio.currentTime || 0,
      positionMs: Math.round((audio.currentTime || 0) * 1000),
      updatedAt: window.serverTimestamp(),
      updatedAtServer: window.serverTimestamp(),
      lastActiveAt: Date.now(),
    });
  } catch (_) {}
}

function startHostHeartbeat() {
  stopHostHeartbeat();
  roomState.heartbeatTimer = setInterval(() => {
    if (roomState.roomId && roomState.isHost) broadcastHostState();
  }, ROOM_HEARTBEAT_MS);
}

function stopHostHeartbeat() {
  if (roomState.heartbeatTimer) {
    clearInterval(roomState.heartbeatTimer);
    roomState.heartbeatTimer = null;
  }
}

// Bù trễ và nạp nhạc trực tiếp từ dữ liệu bài hát của Host
function applyHostStateToGuest(data) {
  const songData = data.songData;
  const hostSongId = data.currentSongId || (songData ? songData.id : null);
  const guestSongId = state.currentSong ? state.currentSong.id : null;
  const isDiffSong = hostSongId !== null && hostSongId !== guestSongId;

  const ts = data.updatedAtServer || data.updatedAt;
  const serverNow = ts && ts.toMillis ? ts.toMillis() : Date.now();
  const elapsed = data.isPlaying ? (Date.now() - serverNow) / 1000 : 0;

  let basePos = data.position;
  if (basePos === undefined && data.positionMs !== undefined) {
    basePos = data.positionMs / 1000;
  }
  const expectedPosition = Math.max(0, (basePos || 0) + (elapsed > 0 && elapsed < 30 ? elapsed : 0));

  if (isDiffSong) {
    let targetIdx = (typeof defaultSongList !== "undefined" ? defaultSongList : []).findIndex(
      (s) => s.id === hostSongId || (songData && s.src === songData.audioUrl),
    );

    // Fallback: Nếu kho nhạc local chưa có, tự tạo bài từ songData gửi từ Mobile
    if (targetIdx === -1 && songData) {
      const virtualSong = {
        id: songData.id || Date.now(),
        docId: songData.docId || "",
        title: songData.title,
        artist: songData.artist,
        genre: songData.genre || "Pop",
        cover: songData.coverUrl,
        src: songData.audioUrl,
        lyrics: songData.lyrics || "",
      };
      songs.unshift(virtualSong);
      targetIdx = 0;
    }

    if (targetIdx !== -1) {
      loadSong(targetIdx, false);
      const onMetadataReady = () => {
        audio.removeEventListener("loadedmetadata", onMetadataReady);
        audio.currentTime = expectedPosition;
        if (data.isPlaying) {
          audio.play().catch(() => showAutoplayUnlockSnackbar());
        }
      };
      audio.addEventListener("loadedmetadata", onMetadataReady);
      return;
    }
  }

  // Đồng bộ Play / Pause & Tua lệch thời gian
  if (data.isPlaying && audio.paused) {
    audio.currentTime = expectedPosition;
    audio.play().catch(() => showAutoplayUnlockSnackbar());
  } else if (!data.isPlaying && !audio.paused) {
    audio.pause();
    state.isPlaying = false;
  } else if (data.isPlaying) {
    const drift = Math.abs(audio.currentTime - expectedPosition);
    if (drift > ROOM_DRIFT_THRESHOLD) {
      audio.currentTime = expectedPosition;
    }
  }
}

// =========================================================================
// REACTION EMOJI BAY LƠ LỬNG
// =========================================================================

async function sendRoomReaction(emoji) {
  if (!roomState.roomId) return;
  spawnFloatingEmoji(emoji);
  try {
    await window.addDoc(
      window.collection(window.db, ROOM_COLLECTION, roomState.roomId, "reactions"),
      {
        emoji: emoji,
        timestamp: window.serverTimestamp(),
      },
    );
  } catch (_) {}
}

function spawnFloatingEmoji(emoji) {
  const el = document.createElement("div");
  el.className = "floating-emoji";
  el.textContent = emoji;
  el.style.left = `${30 + Math.random() * 40}%`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function showAutoplayUnlockSnackbar() {
  if (document.getElementById("autoplayUnlockBtn")) return;
  const btn = document.createElement("div");
  btn.id = "autoplayUnlockBtn";
  btn.innerHTML = `<i class="fa-solid fa-volume-high"></i> Nhấn để bật âm thanh phòng nghe`;
  btn.onclick = () => {
    audio.play();
    btn.remove();
  };
  document.body.appendChild(btn);
}

// Khóa phím điều khiển khi là Guest
function lockControlsForGuest(shouldLock) {
  const controlSelectors = [
    "#playIconBtn",
    "#fsPlayBtn",
    ".btn-play-hero",
    '[onclick="prevSong()"]',
    '[onclick="nextSong()"]',
    "#progressBar",
    "#fsProgressBar",
  ];

  controlSelectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((node) => {
      node.disabled = shouldLock;
      node.style.opacity = shouldLock ? "0.35" : "";
      node.style.pointerEvents = shouldLock ? "none" : "";
    });
  });
}

function wrapWithRoomBroadcast(fn) {
  return function (...args) {
    const result = fn.apply(this, args);
    if (roomState.roomId && roomState.isHost) {
      setTimeout(broadcastHostState, 80);
    }
    return result;
  };
}
if (typeof playSong === "function") playSong = wrapWithRoomBroadcast(playSong);

[
  "#playIconBtn",
  "#fsPlayBtn",
  ".btn-play-hero",
  '[onclick="prevSong()"]',
  '[onclick="nextSong()"]',
].forEach((sel) => {
  document.querySelectorAll(sel).forEach((node) => {
    node.addEventListener("click", () => {
      if (roomState.roomId && roomState.isHost) setTimeout(broadcastHostState, 80);
    });
  });
});

["progressBar", "fsProgressBar"].forEach((id) => {
  const elNode = document.getElementById(id);
  if (elNode) {
    elNode.addEventListener("change", () => {
      if (roomState.roomId && roomState.isHost) setTimeout(broadcastHostState, 80);
    });
  }
});

function waitForFirestoreInRoom(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.db && window.doc && window.setDoc && window.onSnapshot) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error("Firestore chưa sẵn sàng"));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

function showRoomInRoomUI() {
  document.getElementById("roomStateNotInRoom").style.display = "none";
  document.getElementById("roomStateInRoom").style.display = "block";
  document.getElementById("roomCodeDisplay").textContent = roomState.roomId || "";
  document.getElementById("roomHostBadge").style.display = roomState.isHost ? "block" : "none";
  document.getElementById("roomGuestBadge").style.display = roomState.isHost ? "none" : "block";
  document.getElementById("btnCloseRoom").style.display = roomState.isHost ? "block" : "none";
}

function updateRoomModalUI(data) {
  const members = data.members || {};
  const memberEntries = Object.entries(members);
  const countEl = document.getElementById("roomMemberCount");
  if (countEl) countEl.textContent = memberEntries.length || data.membersCount || 1;

  const listEl = document.getElementById("roomMemberList");
  if (!listEl) return;
  listEl.innerHTML = memberEntries
    .map(([uid, m]) => {
      const isHostMember = uid === data.hostUid || uid === data.hostId;
      const safeName = escapeHtmlMain(m.name || "Khách");
      return `
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#ddd">
          <i class="fa-solid fa-user" style="font-size:11px;opacity:0.7"></i>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeName}</span>
          ${isHostMember ? '<i class="fa-solid fa-crown" style="color:#ffd700;font-size:11px"></i>' : ""}
        </div>`;
    })
    .join("");
}

function updateRoomBanner(code, data) {
  const banner = document.getElementById("roomActiveBanner");
  const textEl = document.getElementById("roomActiveBannerText");
  if (!banner || !textEl) return;
  banner.style.display = "flex";
  const count = Object.keys(data.members || {}).length || data.membersCount || 1;
  textEl.textContent = roomState.isHost
    ? `Phòng #${code} (${count} người)`
    : `Đang nghe cùng #${code}`;
}

function copyRoomInviteLink() {
  if (!roomState.roomId) return;
  const url = `${window.location.origin}${window.location.pathname}?room=${roomState.roomId}`;
  navigator.clipboard.writeText(url).then(() => showToast("Đã copy link mời!", "success"));
}

function checkRoomCodeInUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("room");
  if (code) {
    const tryJoin = () => {
      if (window.auth && window.auth.currentUser) {
        joinListenRoom(code);
      } else if (window.auth) {
        openRoomModal();
        const input = document.getElementById("joinRoomCodeInput");
        if (input) input.value = code;
      } else {
        setTimeout(tryJoin, 400);
      }
    };
    setTimeout(tryJoin, 600);
    return true;
  }
  return false;
}

function tryRestoreRoomFromLocalStorage() {
  const saved = readRoomFromLocalStorage();
  if (!saved || !saved.code) return;
  const tryRestore = () => {
    if (window.auth && window.auth.currentUser) {
      joinListenRoom(saved.code);
    } else {
      setTimeout(tryRestore, 600);
    }
  };
  setTimeout(tryRestore, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  const btnCreate = document.getElementById("btnCreateRoom");
  const btnJoin = document.getElementById("btnJoinRoom");
  const btnLeave = document.getElementById("btnLeaveRoom");
  const btnCloseRoom = document.getElementById("btnCloseRoom");
  const btnCopy = document.getElementById("btnCopyRoomLink");
  const joinInput = document.getElementById("joinRoomCodeInput");

  if (btnCreate) btnCreate.addEventListener("click", createListenRoom);
  if (btnJoin) btnJoin.addEventListener("click", () => joinListenRoom(joinInput ? joinInput.value : ""));
  if (joinInput) {
    joinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinListenRoom(joinInput.value);
    });
  }
  if (btnLeave) btnLeave.addEventListener("click", leaveListenRoom);
  if (btnCloseRoom) btnCloseRoom.addEventListener("click", closeListenRoomAsHost);
  if (btnCopy) btnCopy.addEventListener("click", copyRoomInviteLink);

  if (!checkRoomCodeInUrl()) {
    tryRestoreRoomFromLocalStorage();
  }
});
