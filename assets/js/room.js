/* =========================================================================
   SOUNDSPHERE — NGHE CÙNG (LISTEN ROOM)
   Tạo/tham gia phòng nghe nhạc chung realtime. Host điều khiển play/pause/
   next/prev/seek, đồng bộ cho mọi người trong phòng qua Firestore onSnapshot.
   Guest chỉ nghe theo, tự chỉnh âm lượng riêng không ảnh hưởng ai khác.

   File này load SAU main.js (cùng global scope, không phải module) nên có
   thể dùng trực tiếp các biến/hàm đã khai báo trong main.js: audio, state,
   songs, defaultSongList, loadSong(), togglePlay(), nextSong(), prevSong(),
   showToast(), formatTime()...
   ========================================================================= */

// --- STATE CỦA PHÒNG (không đụng vào state của main.js để tránh xung đột) ---
const roomState = {
  roomId: null, // mã phòng hiện tại (null = không trong phòng nào)
  isHost: false,
  unsubscribe: null, // hàm hủy lắng nghe onSnapshot khi rời phòng
  heartbeatTimer: null, // gửi vị trí phát định kỳ (host)
  lastAppliedServerTime: 0, // tránh áp dụng lại snapshot cũ/trùng
  suppressNextSeekEcho: false, // tránh vòng lặp khi guest set audio.currentTime
  guestSyncRaf: null, // requestAnimationFrame loop để guest tự hiệu chỉnh vị trí
};

const ROOM_HEARTBEAT_MS = 3000; // host gửi vị trí định kỳ mỗi 3s
const ROOM_DRIFT_THRESHOLD = 0.3; // lệch quá 0.3s thì guest tự nhảy lại đúng vị trí
const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000; // phòng tự hết hạn sau 24h không hoạt động
const ROOM_LOCALSTORAGE_KEY = "soundsphere_active_room";

// --- LƯU/ĐỌC/XÓA THÔNG TIN PHÒNG ĐANG THAM GIA VÀO LOCALSTORAGE ---
// Mục đích: khi host (hoặc guest) tắt tab/đóng trình duyệt rồi mở lại web,
// ta cần biết họ vừa ở trong phòng nào và với vai trò gì, để tự động "nhận
// lại" quyền điều khiển (nếu là host) hoặc tiếp tục nghe cùng (nếu là guest)
// — KHÔNG cần phải tạo phòng mới hay nhập lại mã phòng bằng tay.
function saveRoomToLocalStorage(code, isHost) {
  try {
    localStorage.setItem(
      ROOM_LOCALSTORAGE_KEY,
      JSON.stringify({ code, isHost, savedAt: Date.now() }),
    );
  } catch (e) {
    console.warn("Không lưu được trạng thái phòng vào localStorage:", e.message);
  }
}

function readRoomFromLocalStorage() {
  try {
    const raw = localStorage.getItem(ROOM_LOCALSTORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearRoomFromLocalStorage() {
  try {
    localStorage.removeItem(ROOM_LOCALSTORAGE_KEY);
  } catch (e) {
    /* bỏ qua nếu localStorage không khả dụng */
  }
}

// --- TẠO MÃ PHÒNG NGẪU NHIÊN (6 ký tự, dễ đọc, không nhầm O/0, I/1) ---
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
  overlay.classList.add("active");
  overlay.style.display = "flex";

  const user = window.auth && window.auth.currentUser;
  document.getElementById("roomLoginRequired").style.display = user ? "none" : "block";
  document.getElementById("btnCreateRoom").disabled = !user;
  document.getElementById("btnJoinRoom").disabled = !user;

  if (roomState.roomId) {
    showRoomInRoomUI();
  } else {
    document.getElementById("roomStateNotInRoom").style.display = "block";
    document.getElementById("roomStateInRoom").style.display = "none";
  }
}

function closeRoomModal() {
  const overlay = document.getElementById("roomOverlay");
  overlay.classList.remove("active");
  overlay.style.display = "none";
}

// =========================================================================
// TẠO PHÒNG (trở thành Host)
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
    await window.setDoc(window.doc(window.db, "listenRooms", code), {
      hostUid: user.uid,
      hostName: user.displayName || user.email || "Host",
      hostAvatar: user.photoURL || "",
      currentSongId: song ? song.id : null,
      isPlaying: !!state.isPlaying,
      position: audio.currentTime || 0,
      updatedAtServer: window.serverTimestamp(),
      createdAt: Date.now(),
      lastActiveAt: Date.now(), // cập nhật mỗi lần host có hoạt động — dùng để tính hết hạn 24h
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
    startHostHeartbeat();
    lockControlsForGuest(false); // host vẫn điều khiển bình thường
    showRoomInRoomUI();
    showToast(`Đã tạo phòng ${code}!`, "success");
  } catch (e) {
    console.error(e);
    showToast("Không tạo được phòng: " + e.message, "error");
  }
}

// =========================================================================
// THAM GIA PHÒNG (trở thành Guest)
// =========================================================================

async function joinListenRoom(codeRaw) {
  const user = window.auth && window.auth.currentUser;
  if (!user) {
    showToast("Vui lòng đăng nhập để tham gia phòng.", "error");
    return;
  }

  const code = (codeRaw || "").trim().toUpperCase();
  if (!code) {
    showToast("Vui lòng nhập mã phòng.", "error");
    return;
  }

  await waitForFirestoreInRoom();

  try {
    const roomRef = window.doc(window.db, "listenRooms", code);
    const snap = await window.getDoc(roomRef);
    if (!snap.exists()) {
      showToast("Không tìm thấy phòng với mã này.", "error");
      clearRoomFromLocalStorage();
      return;
    }

    const data = snap.data();

    // Phòng không hoạt động quá 24h (host tắt tab lâu, không quay lại) thì
    // coi như đã hết hạn — dọn luôn để không tồn tại vĩnh viễn trong Firestore.
    const lastActive = data.lastActiveAt || data.createdAt || 0;
    if (Date.now() - lastActive > ROOM_EXPIRY_MS) {
      showToast("Phòng này đã hết hạn (không hoạt động quá 24 giờ).", "error");
      clearRoomFromLocalStorage();
      try {
        await window.deleteDoc(roomRef);
      } catch (e) {
        /* không bắt buộc phải xóa thành công ngay, để Rules tự quyết định quyền xóa */
      }
      return;
    }

    // QUAN TRỌNG: nếu chính host quay lại phòng của mình (vd: vừa tắt tab,
    // mở lại web) — KHÔNG coi đây là lỗi, mà tự động trả lại quyền host cho
    // họ, để họ tiếp tục điều khiển đúng phòng đang mở thay vì bị kẹt ngoài.
    if (data.hostUid === user.uid) {
      roomState.roomId = code;
      roomState.isHost = true;
      saveRoomToLocalStorage(code, true);
      attachRoomListener(code);
      startHostHeartbeat();
      lockControlsForGuest(false);
      showRoomInRoomUI();
      closeRoomModal();
      showToast(`Đã quay lại phòng ${code} — bạn vẫn là chủ phòng.`, "success");
      return;
    }

    // Thêm mình vào danh sách thành viên (vô hại nếu đã có sẵn — ghi đè cùng giá trị)
    await window.updateDoc(roomRef, {
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
    lockControlsForGuest(true);
    showRoomInRoomUI();
    closeRoomModal();
    showToast(`Đã vào phòng ${code} — đang nghe cùng chủ phòng 🎧`, "success");
  } catch (e) {
    console.error(e);
    showToast("Không vào được phòng: " + e.message, "error");
  }
}

// =========================================================================
// RỜI PHÒNG (tạm thời — phòng vẫn tồn tại, host có thể quay lại sau)
// =========================================================================
//
// Áp dụng cho cả host và guest: chỉ dừng việc lắng nghe/điều khiển ở phía
// trình duyệt hiện tại, KHÔNG xóa phòng khỏi Firestore. Người khác trong
// phòng (nếu là guest rời) hoặc chính host (nếu host rời) đều có thể quay
// lại bằng cách tham gia lại đúng mã phòng — xem tryRestoreRoomFromLocalStorage
// và logic "host quay lại phòng của mình" trong joinListenRoom().
//
// Lưu ý: nếu HOST rời phòng kiểu này (không phải đóng phòng), nhạc vẫn tiếp
// tục phát cho các guest khác đúng như trạng thái cuối cùng host đã gửi lên
// (vì document phòng không bị xóa) — đúng hành vi mong muốn khi host chỉ
// tắt tab tạm thời chứ không có ý định kết thúc buổi nghe chung.
async function leaveListenRoom() {
  if (!roomState.roomId) return;

  const code = roomState.roomId;
  const wasHost = roomState.isHost;
  const user = window.auth && window.auth.currentUser;

  if (roomState.unsubscribe) {
    roomState.unsubscribe();
    roomState.unsubscribe = null;
  }
  stopHostHeartbeat();
  stopGuestSyncLoop();

  try {
    if (!wasHost && user) {
      // Guest rời phòng = xóa mình khỏi danh sách thành viên. Host rời theo
      // kiểu "tạm thời" thì KHÔNG xóa gì cả — vẫn giữ nguyên members và toàn
      // bộ trạng thái phát nhạc để guest khác tiếp tục nghe bình thường.
      const roomRef = window.doc(window.db, "listenRooms", code);
      const snap = await window.getDoc(roomRef);
      if (snap.exists()) {
        const members = { ...(snap.data().members || {}) };
        delete members[user.uid];
        await window.updateDoc(roomRef, { members });
      }
    }
  } catch (e) {
    console.error("Lỗi khi rời phòng:", e);
    // Không chặn việc rời phòng phía client dù ghi Firestore lỗi
  }

  roomState.roomId = null;
  roomState.isHost = false;
  clearRoomFromLocalStorage();
  lockControlsForGuest(false);
  document.getElementById("roomActiveBanner").style.display = "none";
  closeRoomModal();
  showToast(
    wasHost
      ? "Đã rời phòng — phòng vẫn mở, bạn có thể quay lại điều khiển bất cứ lúc nào trong 24h tới."
      : "Đã rời phòng.",
    "info",
  );
}

// =========================================================================
// ĐÓNG PHÒNG (chủ động, chỉ host) — xóa hẳn phòng, không ai nghe được nữa
// =========================================================================

async function closeListenRoomAsHost() {
  if (!roomState.roomId || !roomState.isHost) return;

  if (!confirm("Đóng phòng nghe cùng? Mọi người trong phòng sẽ bị ngắt kết nối và không thể vào lại bằng mã này nữa.")) {
    return;
  }

  const code = roomState.roomId;

  if (roomState.unsubscribe) {
    roomState.unsubscribe();
    roomState.unsubscribe = null;
  }
  stopHostHeartbeat();
  stopGuestSyncLoop();

  try {
    await window.deleteDoc(window.doc(window.db, "listenRooms", code));
  } catch (e) {
    console.error("Lỗi khi đóng phòng:", e);
    showToast("Lỗi khi đóng phòng: " + e.message, "error");
  }

  roomState.roomId = null;
  roomState.isHost = false;
  clearRoomFromLocalStorage();
  lockControlsForGuest(false);
  document.getElementById("roomActiveBanner").style.display = "none";
  closeRoomModal();
  showToast("Đã đóng phòng.", "info");
}

// =========================================================================
// LẮNG NGHE REALTIME TRẠNG THÁI PHÒNG
// =========================================================================

function attachRoomListener(code) {
  const roomRef = window.doc(window.db, "listenRooms", code);
  roomState.unsubscribe = window.onSnapshot(
    roomRef,
    (snap) => {
      if (!snap.exists()) {
        // Phòng đã bị host đóng
        if (!roomState.isHost) {
          showToast("Chủ phòng đã đóng phòng nghe cùng.", "info");
          forceLeaveLocallyWithoutWrite();
        }
        return;
      }
      const data = snap.data();
      updateRoomModalUI(data);
      updateRoomBanner(code, data);

      // Chỉ guest mới tự đồng bộ theo trạng thái host gửi lên
      if (!roomState.isHost) {
        applyHostStateToGuest(data);
      }
    },
    (error) => {
      console.error("Lỗi lắng nghe phòng:", error);
    },
  );
}

// Dùng khi phòng đã biến mất phía server (host đóng) — dọn state phía client
// mà không cố ghi gì lên Firestore nữa (vì document không còn tồn tại).
function forceLeaveLocallyWithoutWrite() {
  if (roomState.unsubscribe) {
    roomState.unsubscribe();
    roomState.unsubscribe = null;
  }
  stopGuestSyncLoop();
  stopHostHeartbeat();
  roomState.roomId = null;
  roomState.isHost = false;
  clearRoomFromLocalStorage();
  lockControlsForGuest(false);
  document.getElementById("roomActiveBanner").style.display = "none";
  closeRoomModal();
}

// =========================================================================
// HOST: GỬI TRẠNG THÁI LÊN FIRESTORE
// =========================================================================

// Gọi mỗi khi host có hành động chủ động (play/pause/next/prev/seek/đổi bài)
async function broadcastHostState() {
  if (!roomState.roomId || !roomState.isHost) return;
  const song = state.currentSong;

  try {
    await window.updateDoc(window.doc(window.db, "listenRooms", roomState.roomId), {
      currentSongId: song ? song.id : null,
      isPlaying: !!state.isPlaying,
      position: audio.currentTime || 0,
      updatedAtServer: window.serverTimestamp(),
      lastActiveAt: Date.now(), // host còn hoạt động -> reset đồng hồ hết hạn 24h
    });
  } catch (e) {
    console.warn("Không gửi được trạng thái phòng:", e.message);
  }
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

// =========================================================================
// GUEST: ÁP DỤNG TRẠNG THÁI TỪ HOST (kèm bù trừ độ trễ mạng)
// =========================================================================

function applyHostStateToGuest(data) {
  // Đổi bài nếu host đang phát bài khác với bài hiện tại của guest
  const hostSongId = data.currentSongId;
  const guestSongId = state.currentSong ? state.currentSong.id : null;
  const isChangingSong = hostSongId !== null && hostSongId !== guestSongId;

  // Tính vị trí thực tế hiện tại của host (bù độ trễ mạng/giữa lúc cập nhật)
  const serverNow = data.updatedAtServer && data.updatedAtServer.toMillis
    ? data.updatedAtServer.toMillis()
    : Date.now();
  const elapsedSinceUpdate = data.isPlaying ? (Date.now() - serverNow) / 1000 : 0;
  const expectedPosition = Math.max(0, (data.position || 0) + elapsedSinceUpdate);

  if (isChangingSong) {
    const idx = (typeof defaultSongList !== "undefined" ? defaultSongList : []).findIndex(
      (s) => s.id === hostSongId,
    );
    if (idx !== -1) {
      // Tạm thời chèn bài hát của host vào đầu danh sách đang nghe của guest,
      // để loadSong() có thể tìm thấy và phát đúng bài — không phá vỡ playlist
      // gốc của guest, chỉ mượn dữ liệu bài hát để hiển thị + phát đúng nội dung.
      const hostSong = defaultSongList[idx];
      const existingIdx = songs.findIndex((s) => s.id === hostSong.id);
      let targetIdx = existingIdx;
      if (existingIdx === -1) {
        songs.unshift(hostSong);
        targetIdx = 0;
      }

      loadSong(targetIdx, false); // false = không tự audio.play() ngay, kiểm soát thủ công dưới đây

      // audio.src vừa đổi là bất đồng bộ — phải đợi loadedmetadata mới set
      // currentTime chính xác được (set ngay có thể bị trình duyệt bỏ qua).
      const onMetadataReady = () => {
        audio.removeEventListener("loadedmetadata", onMetadataReady);
        audio.currentTime = expectedPosition;
        if (data.isPlaying) {
          audio.play().then(() => {
            state.isPlaying = true;
            if (typeof updateMediaSession === "function") updateMediaSession();
          }).catch(() => {});
        }
      };
      audio.addEventListener("loadedmetadata", onMetadataReady);
      startGuestSyncLoop();
      return; // đã xử lý xong nhánh đổi bài, không chạy tiếp logic play/pause bên dưới
    }
  }

  // Đồng bộ play/pause theo host (trường hợp KHÔNG đổi bài — chỉ đổi trạng thái phát)
  if (data.isPlaying && audio.paused) {
    audio.currentTime = expectedPosition;
    audio.play().then(() => {
      state.isPlaying = true;
      if (typeof updateMediaSession === "function") updateMediaSession();
    }).catch(() => {});
  } else if (!data.isPlaying && !audio.paused) {
    audio.pause();
    state.isPlaying = false;
  } else if (data.isPlaying) {
    // Đang phát cả 2 bên — chỉ hiệu chỉnh nếu lệch quá ngưỡng cho phép
    const drift = Math.abs(audio.currentTime - expectedPosition);
    if (drift > ROOM_DRIFT_THRESHOLD) {
      audio.currentTime = expectedPosition;
    }
  }

  startGuestSyncLoop(); // tiếp tục tự hiệu chỉnh liên tục giữa các lần snapshot
}

// Giữa 2 lần cập nhật từ Firestore (heartbeat mỗi 3s), guest vẫn cần kiểm tra
// liên tục để bù trôi dạt nhỏ (clock drift) — dùng requestAnimationFrame nhẹ nhàng.
function startGuestSyncLoop() {
  if (roomState.guestSyncRaf) return; // đã chạy rồi, không cần khởi động lại
  const tick = () => {
    if (!roomState.roomId || roomState.isHost) {
      roomState.guestSyncRaf = null;
      return;
    }
    roomState.guestSyncRaf = requestAnimationFrame(tick);
  };
  roomState.guestSyncRaf = requestAnimationFrame(tick);
}

function stopGuestSyncLoop() {
  if (roomState.guestSyncRaf) {
    cancelAnimationFrame(roomState.guestSyncRaf);
    roomState.guestSyncRaf = null;
  }
}

// =========================================================================
// CHẶN ĐIỀU KHIỂN CHO GUEST (chỉ khóa play/pause/next/prev/seek — KHÔNG khóa âm lượng)
// =========================================================================

function lockControlsForGuest(shouldLock) {
  // Danh sách selector các nút điều khiển PHÁT NHẠC cần khóa cho guest — dùng
  // selector theo đúng onclick gốc để KHÔNG vô tình khóa các nút khác dùng
  // chung class .btn-control (lời bài hát, pomodoro, hẹn giờ, trợ giúp...).
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
      if (shouldLock) {
        node.dataset.roomLockedDisabled = node.disabled ? "1" : "0";
        node.disabled = true;
        node.style.opacity = "0.4";
        node.style.cursor = "not-allowed";
        node.style.pointerEvents = "none";
      } else {
        node.disabled = node.dataset.roomLockedDisabled === "1";
        node.style.opacity = "";
        node.style.cursor = "";
        node.style.pointerEvents = "";
        delete node.dataset.roomLockedDisabled;
      }
    });
  });
}

// =========================================================================
// HOOK VÀO CÁC HÀNH ĐỘNG ĐIỀU KHIỂN CỦA HOST
// =========================================================================
//
// LƯU Ý KỸ THUẬT: main.js gắn các nút điều khiển theo nhiều cách khác nhau:
//   1. Nút tĩnh cố định trong HTML, dùng onclick="..." (vd: nút prev/next,
//      #playIconBtn) — onclick tra cứu tên biến tại thời điểm click nên gán
//      lại biến toàn cục VẪN có tác dụng, nhưng ta chọn cách an toàn hơn:
//      gắn listener bổ sung trực tiếp lên node (xem dưới).
//   2. Nút tĩnh gắn qua addEventListener (vd: fsElements.playBtn) — tham
//      chiếu hàm đã bị "đóng băng" lúc gắn, gán lại biến toàn cục sau đó sẽ
//      KHÔNG có tác dụng với những listener này. Phải gắn listener bổ sung.
//   3. Các dòng bài hát trong danh sách (renderList()) — render lại liên
//      tục bằng innerHTML với onclick="playSong(i, 'all')" được tạo MỚI mỗi
//      lần render. Không thể gắn listener bổ sung 1 lần vì DOM bị thay liên
//      tục — đây là trường hợp BẮT BUỘC phải gán lại biến toàn cục `playSong`
//      để mọi lần render sau đều tự động gọi đúng bản đã wrap.
//
// Vì (3) chỉ áp dụng cho playSong, ta CHỈ wrap playSong bằng reassignment,
// còn togglePlay/nextSong/prevSong dùng listener bổ sung (tránh double-fire
// vì các nút đó là tĩnh, không render lại).

function wrapWithRoomBroadcast(fn) {
  return function (...args) {
    const result = fn.apply(this, args);
    if (roomState.roomId && roomState.isHost) {
      setTimeout(broadcastHostState, 50);
    }
    return result;
  };
}
if (typeof playSong === "function") playSong = wrapWithRoomBroadcast(playSong);

// Listener bổ sung cho các nút tĩnh cố định (không render lại) — không dùng
// chung cơ chế reassignment với playSong để tránh gọi broadcast 2 lần.
function attachSupplementaryBroadcastListener(selector) {
  document.querySelectorAll(selector).forEach((node) => {
    node.addEventListener("click", () => {
      if (roomState.roomId && roomState.isHost) {
        setTimeout(broadcastHostState, 50);
      }
    });
  });
}
[
  "#playIconBtn",
  "#fsPlayBtn",
  ".btn-play-hero",
  '[onclick="prevSong()"]',
  '[onclick="nextSong()"]',
].forEach(attachSupplementaryBroadcastListener);

// Riêng việc tua (seek) qua thanh progress bar không gọi qua 1 hàm cố định mà
// là sự kiện "change" trực tiếp trên input — thêm 1 listener bổ sung (không
// thay listener cũ trong main.js) để host broadcast sau khi tua xong.
["progressBar", "fsProgressBar"].forEach((id) => {
  const elNode = document.getElementById(id);
  if (elNode) {
    elNode.addEventListener("change", () => {
      if (roomState.roomId && roomState.isHost) {
        setTimeout(broadcastHostState, 50);
      }
    });
  }
});

// =========================================================================
// CHỜ FIRESTORE SẴN SÀNG (tương tự waitForFirestore trong main.js, viết
// riêng 1 bản ở đây để room.js không phụ thuộc thứ tự khai báo của main.js)
// =========================================================================

function waitForFirestoreInRoom(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.db && window.doc && window.setDoc && window.onSnapshot) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error("Firestore chưa khởi tạo kịp thời gian chờ"));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

// =========================================================================
// CẬP NHẬT UI (modal, banner, danh sách thành viên)
// =========================================================================

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
  document.getElementById("roomMemberCount").textContent = memberEntries.length;

  const listEl = document.getElementById("roomMemberList");
  listEl.innerHTML = memberEntries
    .map(([uid, m]) => {
      const isHostMember = uid === data.hostUid;
      const avatar = m.avatar
        ? `<img src="${m.avatar}" style="width:26px;height:26px;border-radius:50%;object-fit:cover" />`
        : `<div style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:11px">${(m.name || "?")[0].toUpperCase()}</div>`;
      return `
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#ddd">
          ${avatar}
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.name || "Người dùng"}</span>
          ${isHostMember ? '<i class="fa-solid fa-crown" style="color:#ffd700;font-size:11px"></i>' : ""}
        </div>`;
    })
    .join("");
}

function updateRoomBanner(code, data) {
  const banner = document.getElementById("roomActiveBanner");
  const textEl = document.getElementById("roomActiveBannerText");
  banner.style.display = "flex";
  textEl.textContent = roomState.isHost
    ? `Đang chia sẻ phòng ${code} (${Object.keys(data.members || {}).length} người nghe)`
    : `Đang nghe cùng phòng ${code}`;
}

// =========================================================================
// COPY LINK MỜI
// =========================================================================

function copyRoomInviteLink() {
  if (!roomState.roomId) return;
  const url = `${window.location.origin}${window.location.pathname}?room=${roomState.roomId}`;
  navigator.clipboard
    .writeText(url)
    .then(() => showToast("Đã copy link mời vào clipboard!", "success"))
    .catch(() => showToast("Không copy được, hãy thử lại.", "error"));
}

// --- Tự động vào phòng nếu URL có ?room=XXXXXX (mở từ link mời) ---
function checkRoomCodeInUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("room");
  if (code) {
    // Đợi người dùng đăng nhập xong rồi mới tự vào phòng, tránh việc gọi
    // joinListenRoom() khi window.auth.currentUser chưa kịp khởi tạo.
    const tryJoin = () => {
      if (window.auth && window.auth.currentUser) {
        joinListenRoom(code);
      } else {
        setTimeout(tryJoin, 500);
      }
    };
    setTimeout(tryJoin, 1000);
    return true; // có mã phòng trong URL — không cần khôi phục từ localStorage nữa
  }
  return false;
}

// --- TỰ ĐỘNG KHÔI PHỤC PHÒNG ĐANG THAM GIA SAU KHI TẮT TAB/MỞ LẠI WEB ---
// Nếu trước đó người dùng đang ở trong 1 phòng (host hoặc guest) mà tắt tab,
// localStorage vẫn còn ghi lại mã phòng đó. Khi mở lại web, ta tự động gọi
// lại joinListenRoom() với đúng mã đó — nếu là host, hàm này sẽ tự nhận diện
// và trả lại quyền điều khiển (xem logic trong joinListenRoom). Nếu phòng đã
// bị đóng hoặc hết hạn, joinListenRoom() tự báo lỗi và ta dọn localStorage.
function tryRestoreRoomFromLocalStorage() {
  const saved = readRoomFromLocalStorage();
  if (!saved || !saved.code) return;

  const tryRestore = () => {
    if (window.auth && window.auth.currentUser) {
      joinListenRoom(saved.code);
    } else if (window.auth) {
      // Đã có window.auth nhưng chưa xác định được user (có thể là khách,
      // chưa đăng nhập) — không tự ý mở modal, chỉ dọn dẹp localStorage nếu
      // sau một khoảng thời gian hợp lý vẫn không có user đăng nhập.
      setTimeout(() => {
        if (!window.auth.currentUser) clearRoomFromLocalStorage();
      }, 5000);
    } else {
      setTimeout(tryRestore, 500);
    }
  };
  setTimeout(tryRestore, 1000);
}

// =========================================================================
// GẮN SỰ KIỆN CHO CÁC NÚT TRONG MODAL
// =========================================================================

document.addEventListener("DOMContentLoaded", () => {
  const btnCreate = document.getElementById("btnCreateRoom");
  const btnJoin = document.getElementById("btnJoinRoom");
  const btnLeave = document.getElementById("btnLeaveRoom");
  const btnCloseRoom = document.getElementById("btnCloseRoom");
  const btnCopy = document.getElementById("btnCopyRoomLink");
  const joinInput = document.getElementById("joinRoomCodeInput");

  if (btnCreate) btnCreate.addEventListener("click", createListenRoom);
  if (btnJoin)
    btnJoin.addEventListener("click", () => joinListenRoom(joinInput ? joinInput.value : ""));
  if (joinInput) {
    joinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinListenRoom(joinInput.value);
    });
  }
  if (btnLeave) btnLeave.addEventListener("click", leaveListenRoom);
  if (btnCloseRoom) btnCloseRoom.addEventListener("click", closeListenRoomAsHost);
  if (btnCopy) btnCopy.addEventListener("click", copyRoomInviteLink);

  const hasUrlRoomCode = checkRoomCodeInUrl();
  if (!hasUrlRoomCode) {
    tryRestoreRoomFromLocalStorage();
  }
});
