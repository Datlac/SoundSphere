/* =========================================================================
   SOUNDSPHERE FINAL LOGIC (FIXED)
   ========================================================================= */
// --- KHAI BÁO BIẾN TOÀN CỤC MỚI ---
let defaultSongList = []; // Sẽ được nạp từ file JSON
let songs = [];
let currentFavorites = [];
let userPlaylists = []; // Thêm biến này
let searchTimeout;
const processingSongs = new Set();

let state = {
  isPlaying: false,
  currentSongIndex: 0,
  currentSong: null,
  isShuffled: false,
  repeatMode: 0,
  likedSongs: new Set(),
  lastVolume: 0.8,
  playbackContext: "all",
};
const audio = document.getElementById("audioPlayer");
const el = {
  list: document.getElementById("songList"),
  disc: document.getElementById("discWrapper"),
  currentCover: document.getElementById("currentCover"),
  currentTitle: document.getElementById("currentTitle"),
  currentArtist: document.getElementById("currentArtist"),
  mainLikeBtn: document.getElementById("mainLikeBtn"),
  timeCurrentMain: document.getElementById("timeCurrentMain"),
  timeDurationMain: document.getElementById("timeDurationMain"),
  footerTitle: document.getElementById("footerTitle"),
  footerArtist: document.getElementById("footerArtist"),
  footerCover: document.getElementById("footerCover"),
  playIcon: document.getElementById("playIcon"),
  progressBar: document.getElementById("progressBar"),
  progressFill: document.getElementById("progressFill"),
  currentTime: document.getElementById("currentTime"),
  duration: document.getElementById("duration"),
  deck: document.getElementById("controlDeck"),
  likeBtn: document.getElementById("footerLikeBtn"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  repeatBtn: document.getElementById("repeatBtn"),
  fsShuffleBtn: document.getElementById("fsShuffleBtn"),
  fsRepeatBtn: document.getElementById("fsRepeatBtn"),
  volSlider: document.getElementById("volumeSlider"),
  volFill: document.getElementById("volumeFill"),
  volIcon: document.getElementById("volumeIcon"),
};
// ==================== ANTI-ZOOM LOGIC (TRIỆT ĐỂ CHO IOS) ====================

// 1. Chặn zoom khi chụm 2 ngón tay (Pinch to Zoom)
document.addEventListener(
  "touchstart",
  function (event) {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  },
  { passive: false },
);

// 2. Chặn zoom khi chạm 2 lần liên tiếp (Double Tap Zoom)
let lastTouchTime = 0;
document.addEventListener(
  "touchend",
  function (event) {
    const now = new Date().getTime();
    if (now - lastTouchTime <= 300) {
      event.preventDefault();
    }
    lastTouchTime = now;
  },
  false,
);

// 3. Chặn zoom bằng phím tắt Ctrl + (+/-) và con lăn trên trình duyệt PC
document.addEventListener("keydown", function (event) {
  if (
    event.ctrlKey &&
    (event.key === "+" || event.key === "-" || event.key === "0")
  ) {
    event.preventDefault();
  }
});

document.addEventListener(
  "wheel",
  function (event) {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  },
  { passive: false },
);
// --- CẤU HÌNH NGUỒN DỮ LIỆU BÀI HÁT ---
// "firestore" = đọc từ Firebase Firestore (mặc định, dùng cùng project Firebase đã cấu hình ở index.html)
// "sheet"     = đọc từ Google Sheets CSV (cách cũ, giữ lại để dự phòng)
const SONGS_SOURCE = "firestore";

// Link Google Sheet cũ (chỉ dùng nếu SONGS_SOURCE = "sheet")
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRDjDXPZObPjphvDJycrtP73Unuij6IPAkA4rdjuouYqLjsXNu1ujxI2_-MGFpysxaCWVJNabfw9jrA/pub?output=csv";

// Đợi cho tới khi window.db (Firestore) sẵn sàng (được khởi tạo ở script module cuối index.html)
function waitForFirestore(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.db && window.collection && window.getDocs) {
        resolve(window.db);
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error("Firestore chưa khởi tạo kịp thời gian chờ"));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

// --- HÀM TẢI NHẠC TỪ FIRESTORE (collection "songs") ---
async function loadSongsFromFirestore() {
  await waitForFirestore();

  const snap = await window.getDocs(window.collection(window.db, "songs"));
  const data = [];
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    data.push({
      // ID dùng cho lyricsDatabase và logic toàn site: ưu tiên id số nếu có, fallback sang doc id
      id:
        d.id !== undefined && d.id !== null && d.id !== ""
          ? Number(d.id) || d.id
          : docSnap.id,
      docId: docSnap.id,
      title: d.title || "Không rõ tên",
      artist: d.artist || "Không rõ ca sĩ",
      genre: d.genre || "Pop",
      cover: d.coverUrl || d.cover || "",
      src: d.audioUrl || d.src || "",
      lyrics: d.lyrics || "",
      createdAt: d.createdAt || 0,
    });
  });

  // Đăng ký lyrics động vào lyricsDatabase (nếu bài hát có lời lưu trong Firestore)
  if (typeof lyricsDatabase !== "undefined") {
    data.forEach((song) => {
      if (song.lyrics) lyricsDatabase[song.id] = song.lyrics;
    });
  }

  // Sắp xếp theo thời gian thêm mới nhất lên đầu (nếu có createdAt)
  data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return data;
}

// --- HÀM TẢI NHẠC TỪ GOOGLE SHEETS (cách cũ, dự phòng) ---
async function loadSongsFromSheet() {
  if (SHEET_CSV_URL.includes("Dán Link")) {
    throw new Error("Chưa dán link Google Sheet!");
  }
  const response = await fetch(SHEET_CSV_URL);
  if (!response.ok) throw new Error("Không thể tải Google Sheet");
  const csvText = await response.text();
  return csvToJSON(csvText);
}

// --- HÀM TẢI NHẠC (ĐIỀU PHỐI THEO SONGS_SOURCE) ---
async function loadSongsData() {
  try {
    const data =
      SONGS_SOURCE === "firestore"
        ? await loadSongsFromFirestore()
        : await loadSongsFromSheet();

    defaultSongList = data;
    songs = [...defaultSongList];

    console.log(
      `✅ Đã tải ${songs.length} bài hát từ ${SONGS_SOURCE === "firestore" ? "Firestore" : "Google Sheets"}.`,
    );
    init(); // Chạy web
  } catch (error) {
    console.error("Lỗi tải nhạc:", error);
    showToast("Lỗi tải danh sách nhạc: " + error.message, "error");
    defaultSongList = [];
    songs = [];
    init();
  }
}

// Hàm hỗ trợ: Biến CSV thành JSON (Không cần sửa hàm này)
function csvToJSON(csvText) {
  const lines = csvText.split("\n");
  const result = [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    // Xử lý tách dấu phẩy thông minh (tránh lỗi nếu tên bài hát có dấu phẩy)
    const obj = {};
    const currentline = parseCSVLine(lines[i]);

    for (let j = 0; j < headers.length; j++) {
      let val = currentline[j];
      // Làm sạch dữ liệu
      if (val) val = val.trim().replace(/"/g, "");

      // Ép kiểu ID sang số
      if (headers[j] === "id") val = parseInt(val) || Date.now() + i;

      obj[headers[j]] = val;
    }
    result.push(obj);
  }
  return result;
}

// Hàm tách dòng CSV chuẩn (xử lý dấu phẩy trong ngoặc kép)
function parseCSVLine(text) {
  const re_valid =
    /^\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*(?:,\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*)*$/;
  const re_value =
    /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;

  if (!re_valid.test(text)) return text.split(","); // Fallback đơn giản

  const a = [];
  text.replace(re_value, function (m0, m1, m2, m3) {
    if (m1 !== undefined) a.push(m1.replace(/\\'/g, "'"));
    else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"'));
    else if (m3 !== undefined) a.push(m3);
    return "";
  });
  if (/,\s*$/.test(text)) a.push("");
  return a;
}

document.addEventListener("DOMContentLoaded", () => {
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }
  window.scrollTo(0, 0);

  // GỌI HÀM TẢI NHẠC THAY VÌ GỌI INIT TRỰC TIẾP
  loadSongsData();

  initLanguage();
  initStreamQuality();
});

// === HÀM TRỘN MẢNG (Shuffle) ===
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function init() {
  renderSkeleton();
  checkSharedUrl();
  monitorAuthState();
  // 2. Giả lập delay nhỏ (hoặc xử lý logic nặng) để người dùng thấy hiệu ứng
  setTimeout(() => {
    // CẤU HÌNH THỜI GIAN (Ví dụ: 10 giây để test, sau này sửa thành 30 * 60 * 1000)
    const RESET_TIME = 10 * 1000;

    const now = Date.now();
    const lastVisit = localStorage.getItem("ss_last_visit");
    const savedOrder = localStorage.getItem("ss_saved_playlist");
    const savedShuffleState = localStorage.getItem("ss_is_shuffled");
    autoCleanHistory();
    let oldList = [];
    try {
      oldList = JSON.parse(savedOrder) || [];
    } catch (e) {}

    // KIỂM TRA ĐIỀU KIỆN ĐỂ KHÔI PHỤC LIST CŨ
    const isExpired = !lastVisit || now - lastVisit > RESET_TIME;
    const isSongCountChanged = oldList.length !== songs.length;
    checkSharedUrl();

    if (savedOrder && !isExpired && !isSongCountChanged) {
      console.log("♻️ Khôi phục phiên làm việc cũ...");
      songs = oldList;
      // Khôi phục trạng thái nút shuffle của phiên trước
      state.isShuffled = savedShuffleState === "true";
    } else {
      console.log("✨ Tạo danh sách phát MỚI (Random)...");

      // --- SỬA LỖI TẠI ĐÂY: Luôn trộn bài khi tạo phiên mới ---
      songs = getRandomSongsForExplore();
      state.isShuffled = false;
      // -------------------------------------------------------

      // Lưu danh sách mới và trạng thái vào bộ nhớ
      localStorage.setItem("ss_saved_playlist", JSON.stringify(songs));
      localStorage.setItem("ss_is_shuffled", "false");
    }

    // Cập nhật thời gian truy cập
    localStorage.setItem("ss_last_visit", now);

    // Cập nhật giao diện nút Shuffle
    if (el.shuffleBtn) {
      el.shuffleBtn.classList.toggle("active", state.isShuffled);
    }
    // THÊM: Đồng bộ nút Fullscreen
    if (el.fsShuffleBtn)
      el.fsShuffleBtn.classList.toggle("active", state.isShuffled);

    songs = getRandomSongsForExplore(); // Đảm bảo nạp 10 bài gợi ý trước
    renderList();
    // Chỉ load bài hát nhưng KHÔNG gọi audio.play() ngầm
    loadSong(state.currentSongIndex, false);
    audio.volume = state.lastVolume;
    setVolumeUI(state.lastVolume);
    setupEvents();
    loadAllDurations();
    setTimeout(() => {
      el.disc.classList.remove("buffering");
      document
        .querySelector(".footer-cover-wrapper")
        ?.classList.remove("buffering");
    }, 500);
  }, 300); // Delay 300ms cho mượt
  // Gán sự kiện click cho đĩa nhạc ở Right Panel (chỉ click được khi ở Landscape)
  const rightPanelDisc = document.getElementById("discWrapper");
  if (rightPanelDisc) {
    rightPanelDisc.style.cursor = "pointer";
    rightPanelDisc.onclick = function () {
      // Chỉ mở khi đang ở chế độ xoay ngang (chiều cao < 500px)
      if (window.innerHeight < 500) {
        toggleLyricsPage();
      } else {
        // Nếu ở chế độ dọc/PC thì toggle play như bình thường hoặc mở Fullscreen
        togglePlay();
      }
    };
  }
  // --- ĐOẠN CODE MỚI ĐÃ TỐI ƯU ---

  const searchInput = document.querySelector(".search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const keyword = e.target.value.trim();

      // 1. Xóa bộ đếm thời gian cũ nếu bạn vẫn đang gõ
      clearTimeout(searchTimeout);

      // 2. Thiết lập bộ đếm mới: Chỉ chạy hàm tìm kiếm sau khi ngừng gõ 300ms
      searchTimeout = setTimeout(() => {
        console.log("🔍 Đang lọc dữ liệu cho:", keyword);
        handleSearch(keyword);
      }, 300);
    });
  }
  showMainPlaylist();
}

function renderList() {
  const navFav = document.getElementById("navFavorite");
  const titleEl = document.getElementById("playlistTitle");

  // LOGIC KIỂM TRA MỚI:
  // Chỉ vẽ Tim nếu Sidebar "Yêu thích" đang sáng
  // HOẶC Tiêu đề đang HIỆN và có chữ "Yêu thích"
  const currentTitle = titleEl ? titleEl.textContent : "";
  const isFavMode =
    (navFav && navFav.classList.contains("active")) ||
    (titleEl &&
      titleEl.style.display !== "none" &&
      (currentTitle.includes("Bài hát yêu thích") ||
        currentTitle.includes("Favorite Songs")));

  if (isFavMode) {
    updateFavoriteList(); // Bắt buộc vẽ danh sách Tim
    return; // Dừng lại ngay
  }

  // --- LOGIC VẼ DANH SÁCH THƯỜNG ---
  // Dùng danh sách từ Firebase nếu có, hoặc rỗng
  const listToUse =
    typeof currentFavorites !== "undefined" ? currentFavorites : [];

  if (songs.length === 0) {
    el.list.innerHTML = `<div style="text-align:center; padding:40px; color:#666;">Danh sách trống</div>`;
    return;
  }

  el.list.innerHTML = songs
    .map((s, i) => {
      const isActive = state.currentSong && s.id === state.currentSong.id;
      const isLiked = listToUse.includes(s.id);
      const duration = s.duration || "--:--";

      let indexContent = `<span class="song-index">${i + 1}</span>`;
      if (isActive && state.isPlaying) {
        indexContent = `<div class="playing-gif"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>`;
      } else if (isActive) {
        indexContent = `<i class="fa-solid fa-play" style="color:var(--neon-primary); font-size:12px;"></i>`;
      }

      return `
        <div class="song-item ${isActive ? "active" : ""}" id="song-${i}" onclick="playSong(${i}, 'all')">
             <div class="song-index-wrapper">${indexContent}</div>
             <div class="song-info">
                 <div class="song-title" style="color: ${isActive ? "var(--neon-primary)" : "white"}">${s.title}</div>
                 <div class="song-artist">${s.artist}</div>
             </div>
             <div style="display:flex; align-items:center; justify-content:center;">
                 <button class="btn-heart-list heart-btn ${isLiked ? "liked" : ""}" 
                    data-id="${s.id}" 
                    onclick="event.stopPropagation(); toggleFavorite(${s.id})">
                    <i class="${isLiked ? "fa-solid" : "fa-regular"} fa-heart"></i>
                </button>
             </div>
             <div class="song-duration" id="dur-${i}">${duration}</div>
        </div>`;
    })
    .join("");
}

function loadSong(i, play = true) {
  if (!songs[i] && state.currentSong) {
    const foundIdx = songs.findIndex((s) => s.id === state.currentSong.id);
    if (foundIdx !== -1) i = foundIdx;
  }
  state.currentSongIndex = i;

  state.currentSong = songs[i];
  const song = state.currentSong;
  if (!song) {
    console.error("Không tìm thấy bài hát tại index:", i);
    return;
  }
  el.currentTitle.innerText = el.footerTitle.innerText = song.title;
  el.currentArtist.innerText = el.footerArtist.innerText = song.artist;
  el.currentCover.src = el.footerCover.src = song.cover;

  const discImg = el.disc.querySelector(".disc-img");
  discImg.style.animation = "none";
  discImg.style.transform = "rotate(0deg) scale(1)";
  el.disc.classList.remove("playing");
  void discImg.offsetWidth;
  discImg.style.animation = "rotate 24s linear infinite paused";

  const fsCover = document.getElementById("fsCover");
  const fsDiscWrapper = document.getElementById("fsDiscWrapper");

  if (fsCover && fsDiscWrapper) {
    // A. Đổi ảnh và chữ
    fsCover.src = song.cover;
    document.getElementById("fsBackdrop").style.backgroundImage =
      `url('${song.cover}')`;
    document.getElementById("fsTitle").innerText = song.title;
    document.getElementById("fsArtist").innerText = song.artist;

    // B. Reset hoạt ảnh đĩa quay Fullscreen (cho đồng bộ)
    fsCover.style.animation = "none";
    fsCover.style.transform = "rotate(0deg)";
    fsDiscWrapper.classList.remove("playing");

    void fsCover.offsetWidth; // Trigger reflow

    fsCover.style.animation = "rotate 20s linear infinite paused";
  }

  audio.src = song.src;
  const isLiked = (
    typeof currentFavorites !== "undefined" ? currentFavorites : []
  ).includes(song.id);
  updateLikeStatusUI(song.id, isLiked);
  el.timeCurrentMain.innerText = "0:00";
  el.timeDurationMain.innerText = song.duration || "0:00";
  updateActiveSongUI(i);

  if (play) {
    audio
      .play()
      .then(() => {
        state.isPlaying = true;
        addToHistory(song); // Lưu vào lịch sử ngay khi phát
        schedulePlayCountIncrement(song); // Đếm lượt nghe sau 5s nếu vẫn đang nghe bài này
        el.playIcon.className = "fa-solid fa-pause";
        el.disc.classList.add("playing");
        el.deck.classList.add("playing");
        renderList();
        updateMediaSession();
      })
      .catch(() => {
        el.playIcon.className = "fa-solid fa-play";
        state.isPlaying = false;
      });
  } else {
    el.playIcon.className = "fa-solid fa-play";
    state.isPlaying = false;
    updateMediaSession();
  }
}

function syncLandscapePlayButton() {
  const btn = document.getElementById("lyricsPlayBtn");
  if (!btn) return;

  if (state.isPlaying) {
    btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
  } else {
    btn.innerHTML = '<i class="fa-solid fa-play" style="margin-left:4px"></i>';
  }
}

function togglePlay() {
  if (!audio.src) return showToast("Chưa chọn bài!", "error");
  if (audio.paused) {
    audio.play().then(() => {
      state.isPlaying = true;
      el.playIcon.className = "fa-solid fa-pause";
      el.disc.classList.add("playing");
      el.deck.classList.add("playing");
      renderList();
      if ("mediaSession" in navigator)
        navigator.mediaSession.playbackState = "playing";
    });
  } else {
    audio.pause();
    state.isPlaying = false;
    el.playIcon.className = "fa-solid fa-play";
    el.disc.classList.remove("playing");
    el.deck.classList.remove("playing");
    renderList();
    if ("mediaSession" in navigator)
      navigator.mediaSession.playbackState = "paused";
  }
}

function playSong(i, context = "all") {
  // Cập nhật ngữ cảnh phát nhạc mới
  state.playbackContext = context;

  // Nếu đang nghe bài này rồi thì chỉ toggle play/pause
  if (i === state.currentSongIndex && state.isPlaying) {
    togglePlay();
    return;
  }

  loadSong(i, true);
}

// === HÀM HỖ TRỢ: LẤY DANH SÁCH BÀI HÁT THEO NGỮ CẢNH (ĐÃ FIX) ===
function getPlaybackList() {
  if (state.playbackContext === "favorites") {
    // SỬA: Lấy danh sách từ biến Firebase (currentFavorites) thay vì state.likedSongs cũ
    const listToUse =
      typeof currentFavorites !== "undefined" ? currentFavorites : [];

    // Trả về số thứ tự (index) của các bài có trong danh sách yêu thích
    return songs
      .map((s, i) => i)
      .filter((i) => listToUse.includes(songs[i].id));
  }
  // Mặc định trả về toàn bộ index [0, 1, 2, ...]
  return songs.map((s, i) => i);
}

function nextSong() {
  const playbackList = getPlaybackList();

  // Nếu danh sách rỗng (ví dụ bỏ thích hết rồi)
  if (playbackList.length === 0) return;

  let nextIndex;

  // LOGIC 1: TRỘN BÀI (SHUFFLE)
  if (state.isShuffled) {
    // Chọn ngẫu nhiên 1 bài trong danh sách hiện tại (trừ bài đang hát)
    const available = playbackList.filter((i) => i !== state.currentSongIndex);
    if (available.length > 0) {
      nextIndex = available[Math.floor(Math.random() * available.length)];
    } else {
      nextIndex = playbackList[0]; // Nếu chỉ có 1 bài thì hát lại bài đó
    }
  }
  // LOGIC 2: TUẦN TỰ (SEQUENTIAL)
  else {
    // Tìm vị trí của bài hiện tại trong danh sách phát
    const currentPos = playbackList.indexOf(state.currentSongIndex);

    // Bài tiếp theo
    let nextPos = currentPos + 1;

    // Xử lý vòng lặp
    if (nextPos >= playbackList.length) {
      nextPos = 0; // <--- SỬA THÀNH DÒNG NÀY (Luôn quay về bài đầu tiên)
    }
    nextIndex = playbackList[nextPos];
  }

  // Nếu không tìm thấy bài nào hợp lệ (trường hợp lỗi), quay về playlist chính
  if (nextIndex === undefined) {
    state.playbackContext = "all";
    nextIndex = (state.currentSongIndex + 1) % songs.length;
  }

  loadSong(nextIndex, true);
}

function prevSong() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  const playbackList = getPlaybackList();
  if (playbackList.length === 0) return;

  let prevIndex;

  if (state.isShuffled) {
    const available = playbackList.filter((i) => i !== state.currentSongIndex);
    if (available.length > 0) {
      prevIndex = available[Math.floor(Math.random() * available.length)];
    } else {
      prevIndex = playbackList[0];
    }
  } else {
    const currentPos = playbackList.indexOf(state.currentSongIndex);
    let prevPos = currentPos - 1;

    if (prevPos < 0) prevPos = playbackList.length - 1;
    prevIndex = playbackList[prevPos];
  }

  if (prevIndex === undefined) {
    state.playbackContext = "all";
    prevIndex = (state.currentSongIndex - 1 + songs.length) % songs.length;
  }

  loadSong(prevIndex, true);
}

audio.addEventListener("timeupdate", () => {
  const currTimeStr = formatTime(audio.currentTime);
  if (el.timeCurrentMain) el.timeCurrentMain.innerText = currTimeStr;

  // CHỈ cập nhật thanh trượt nếu người dùng KHÔNG đang kéo (isDragging = false)
  if (!isDragging) {
    const pct = (audio.currentTime / (audio.duration || 1)) * 100;
    if (el.progressBar) {
      el.progressBar.value = audio.currentTime;
      el.progressFill.style.width = `${pct}%`;
      el.currentTime.innerText = currTimeStr;
    }

    // Cập nhật cho cả màn hình Fullscreen nếu đang mở
    const fsFill = document.getElementById("fsProgressFill");
    const fsCurr = document.getElementById("fsCurrentTime");
    if (fsFill) fsFill.style.width = `${pct}%`;
    if (fsCurr) fsCurr.innerText = currTimeStr;
  }

  if (typeof syncLyrics === "function") syncLyrics();
});
audio.addEventListener("loadedmetadata", () => {
  const durStr = formatTime(audio.duration);
  el.progressBar.max = audio.duration;
  el.duration.innerText = durStr;
  if (el.timeDurationMain) el.timeDurationMain.innerText = durStr;
});
audio.addEventListener("ended", () => {
  if (state.repeatMode === 2) {
    audio.currentTime = 0;
    audio.play();
  } else nextSong();
});

let isDragging = false;
el.progressBar.addEventListener("mousedown", () => (isDragging = true));
el.progressBar.addEventListener("touchstart", () => (isDragging = true));
el.progressBar.addEventListener("input", () => {
  const pct = (el.progressBar.value / el.progressBar.max) * 100;
  el.progressFill.style.width = `${pct}%`;
  el.currentTime.innerText = formatTime(el.progressBar.value);
});
el.progressBar.addEventListener("change", () => {
  isDragging = false;
  audio.currentTime = el.progressBar.value;
  if (!state.isPlaying) togglePlay();
});
function seekSong() {}

function toggleShuffle() {
  state.isShuffled = !state.isShuffled;
  el.shuffleBtn.classList.toggle("active", state.isShuffled);
  if (el.fsShuffleBtn)
    el.fsShuffleBtn.classList.toggle("active", state.isShuffled);
  // --- THÊM DÒNG NÀY ĐỂ LƯU TRẠNG THÁI ---
  localStorage.setItem("ss_is_shuffled", state.isShuffled);
  // ---------------------------------------

  showToast(
    state.isShuffled ? "Đã BẬT trộn bài" : "Đã TẮT trộn bài",
    state.isShuffled ? "success" : "off",
    '<i class="fa-solid fa-shuffle"></i>',
  );
}

function toggleRepeat() {
  // 1. Thay đổi trạng thái: 0 (Tắt) -> 1 (All) -> 2 (One) -> 0
  state.repeatMode = (state.repeatMode + 1) % 3;

  // 2. Cập nhật giao diện (Gọi hàm phụ trợ cho cả 2 nút)
  updateRepeatUI(el.repeatBtn); // Cập nhật nút Footer
  if (el.fsRepeatBtn) updateRepeatUI(el.fsRepeatBtn); // Cập nhật nút Fullscreen (nếu có)

  // 3. Hiển thị thông báo (Toast)
  if (state.repeatMode === 0) {
    showToast(
      "Đã TẮT lặp lại",
      "off",
      '<i class="fa-solid fa-repeat" style="color:#ff4757;"></i>',
    );
  } else if (state.repeatMode === 1) {
    showToast(
      "Lặp toàn bộ danh sách",
      "success",
      '<i class="fa-solid fa-repeat"></i>',
    );
  } else {
    showToast("Lặp 1 bài", "success", '<i class="fa-solid fa-repeat"></i>');
  }
}

// Hàm này chuyên dùng để vẽ lại nút Repeat (Footer hoặc Fullscreen) dựa theo state
function updateRepeatUI(btn) {
  if (!btn) return;

  // 1. Reset về trạng thái mặc định (Tắt)
  btn.classList.remove("active", "repeat-one");
  const icon = btn.querySelector("i");
  if (icon) icon.className = "fa-solid fa-repeat"; // Trả về icon gốc

  // 2. Thêm class dựa theo chế độ hiện tại
  if (state.repeatMode === 1) {
    // Chế độ: Lặp danh sách (Sáng đèn)
    btn.classList.add("active");
  } else if (state.repeatMode === 2) {
    // Chế độ: Lặp 1 bài (Sáng đèn + Có số 1)
    btn.classList.add("active", "repeat-one");
  }
}
function setVolume() {
  const v = el.volSlider.value;
  audio.volume = v;
  setVolumeUI(v);
  if (v > 0) state.lastVolume = v;
}
function toggleMute() {
  if (audio.volume > 0) {
    state.lastVolume = audio.volume;
    audio.volume = 0;
    setVolumeUI(0);
  } else {
    let target = state.lastVolume > 0 ? state.lastVolume : 0.8;
    audio.volume = target;
    setVolumeUI(target);
  }
}
function setVolumeUI(v) {
  el.volSlider.value = v;
  el.volFill.style.width = `${v * 100}%`;
  if (v == 0) el.volIcon.className = "fa-solid fa-volume-xmark";
  else if (v < 0.5) el.volIcon.className = "fa-solid fa-volume-low";
  else el.volIcon.className = "fa-solid fa-volume-high";
}

// --- COPY ĐÈ VÀO 2 HÀM CŨ ---

// --- SỬA LẠI: Gọi hàm Firebase thay vì hàm cũ ---
function toggleFooterLike() {
  if (state.currentSongIndex >= 0 && songs[state.currentSongIndex]) {
    toggleFavorite(songs[state.currentSongIndex].id);
  }
}

function toggleMainLike() {
  if (state.currentSongIndex >= 0 && songs[state.currentSongIndex]) {
    toggleFavorite(songs[state.currentSongIndex].id);
  }
}
function toggleLikeInList(id) {
  const song = songs.find((s) => s.id === id);
  if (song) toggleLikeState(id, song.title);
}

function toggleLikeState(id, title) {
  const wasLiked = state.likedSongs.has(id);
  const isLiked = !wasLiked;
  if (isLiked) {
    state.likedSongs.add(id);
    showToast(
      `Đã thêm “${title}” vào yêu thích`,
      "success",
      '<i class="fa-solid fa-heart"></i>',
    );
  } else {
    state.likedSongs.delete(id);
    showToast(
      `Đã bỏ thích “${title}”`,
      "off",
      '<i class="fa-regular fa-heart"></i>',
    );
  }

  if (songs[state.currentSongIndex].id === id) updateLikeStatusUI(id, isLiked);
  document
    .querySelectorAll(`.btn-heart-list[data-id="${id}"]`)
    .forEach((btn) => {
      btn.classList.toggle("liked", isLiked);
      btn.querySelector("i").className = isLiked
        ? "fa-solid fa-heart"
        : "fa-regular fa-heart";
    });
  if (
    document
      .getElementById("playlistTitle")
      ?.innerText.includes("Bài hát yêu thích")
  )
    updateFavoriteList();
}

function updateLikeStatusUI(id, isLiked) {
  // Chỉ cập nhật nếu các nút này tồn tại
  if (el.likeBtn) {
    el.likeBtn.classList.toggle("liked", isLiked);
    const icon = el.likeBtn.querySelector("i");
    if (icon)
      icon.className = isLiked ? "fa-solid fa-heart" : "fa-regular fa-heart";
  }

  if (el.mainLikeBtn) {
    el.mainLikeBtn.classList.toggle("liked", isLiked);
    const icon = el.mainLikeBtn.querySelector("i");
    if (icon)
      icon.className = isLiked ? "fa-solid fa-heart" : "fa-regular fa-heart";
  }
}

function loadAllDurations() {
  songs.forEach((s, i) => {
    if (!s.duration) {
      const t = new Audio(s.src);
      t.addEventListener("loadedmetadata", () => {
        s.duration = formatTime(t.duration);
        const d = document.getElementById(`dur-${i}`);
        if (d) d.innerText = s.duration;
      });
    }
  });
}
function formatTime(s) {
  if (isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" + sec : sec}`;
}
function showToast(msg, type = "info", icon = "") {
  const c = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `${icon} <span>${msg}</span>`;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 400);
  }, 2000);
}
function setupProgressEvents(progressBar, progressFill, timeDisplay) {
  if (!progressBar) return;

  progressBar.addEventListener("mousedown", () => {
    isDragging = true;
  });
  progressBar.addEventListener(
    "touchstart",
    () => {
      isDragging = true;
    },
    { passive: true },
  );

  progressBar.addEventListener("input", () => {
    const val = progressBar.value;
    const max = progressBar.max || 1;
    const pct = (val / max) * 100;
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (timeDisplay) timeDisplay.innerText = formatTime(val);
  });

  progressBar.addEventListener("change", () => {
    isDragging = false;
    audio.currentTime = progressBar.value;
    // Nếu nhạc đang dừng thì phát tiếp khi người dùng tua
    if (audio.paused && state.isPlaying) audio.play();
  });
}
function setupEvents() {
  // A. XỬ LÝ BÀN PHÍM
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    const nonRepeatKeys = ["Space", "KeyL", "KeyK", "KeyS", "KeyR", "KeyM"];
    if (e.repeat && nonRepeatKeys.includes(e.code)) return;

    // Lấy từ điển ngôn ngữ hiện tại
    const t = translations[currentLang];

    switch (e.code) {
      case "Space":
        e.preventDefault();
        togglePlay();
        setTimeout(() => {
          if (state.isPlaying) {
            showToast(
              t.toast_playing,
              "success",
              '<i class="fa-solid fa-play"></i>',
            );
          } else {
            showToast(
              t.toast_paused,
              "info",
              '<i class="fa-solid fa-pause"></i>',
            );
          }
        }, 50);
        break;

      case "KeyL": // Next
        nextSong();
        showToast(
          t.toast_next,
          "success",
          '<i class="fa-solid fa-forward-step"></i>',
        );
        break;

      case "KeyK": // Prev
        prevSong();
        showToast(
          t.toast_prev,
          "success",
          '<i class="fa-solid fa-backward-step"></i>',
        );
        break;

      case "ArrowUp": // Tăng Volume
        e.preventDefault();
        let newVolUp = Math.min(1, audio.volume + 0.1);
        audio.volume = newVolUp;
        setVolumeUI(newVolUp);
        showToast(
          `${t.toast_vol}: ${Math.round(newVolUp * 100)}%`,
          "info",
          '<i class="fa-solid fa-volume-high"></i>',
        );
        break;

      case "ArrowDown": // Giảm Volume
        e.preventDefault();
        let newVolDown = Math.max(0, audio.volume - 0.1);
        audio.volume = newVolDown;
        setVolumeUI(newVolDown);

        let volIcon = "fa-volume-low";
        if (newVolDown === 0) volIcon = "fa-volume-xmark";
        else if (newVolDown > 0.5) volIcon = "fa-volume-high";

        showToast(
          `${t.toast_vol}: ${Math.round(newVolDown * 100)}%`,
          "info",
          `<i class="fa-solid ${volIcon}"></i>`,
        );
        break;

      case "KeyM": // Mute
        toggleMute();
        setTimeout(() => {
          const isMuted = audio.volume === 0;
          if (isMuted) {
            showToast(
              t.toast_muted,
              "off",
              '<i class="fa-solid fa-volume-xmark"></i>',
            );
          } else {
            showToast(
              t.toast_unmuted,
              "success",
              '<i class="fa-solid fa-volume-high"></i>',
            );
          }
        }, 50);
        break;

      case "KeyS": // Shuffle
        toggleShuffle();
        break;

      case "KeyR": // Repeat
        toggleRepeat();
        break;
    }
  });

  // B. CÁC SỰ KIỆN KHÁC (GIỮ NGUYÊN)
  audio.addEventListener("playing", () => {
    el.disc?.classList.remove("buffering");
    document
      .querySelector(".footer-cover-wrapper")
      ?.classList.remove("buffering");
  });

  audio.addEventListener("loadstart", () => {
    if (state.isPlaying) {
      el.disc?.classList.add("buffering");
      document
        .querySelector(".footer-cover-wrapper")
        ?.classList.add("buffering");
    }
  });

  audio.addEventListener("loadeddata", () => {
    el.disc?.classList.remove("buffering");
    document
      .querySelector(".footer-cover-wrapper")
      ?.classList.remove("buffering");
  });

  audio.addEventListener("error", () => {
    el.disc?.classList.remove("buffering");
    document
      .querySelector(".footer-cover-wrapper")
      ?.classList.remove("buffering");
  });

  document.addEventListener("dragstart", (e) => {
    if (e.target.tagName === "IMG") {
      e.preventDefault();
    }
  });
  setupBackToTop();
}

function updateFavoriteList() {
  // SỬA: Lấy danh sách ID từ Firebase thay vì state.likedSongs
  const listToUse =
    typeof currentFavorites !== "undefined" ? currentFavorites : [];

  const favSongs = defaultSongList.filter((s) =>
    currentFavorites.includes(s.id),
  );

  // SỬA ĐOẠN NÀY: Dùng translations[...] thay vì chữ cứng
  if (favSongs.length === 0) {
    // Sửa currentLanguage -> currentLang
    const emptyText =
      translations[currentLang]?.empty_fav_text ||
      "Chưa có bài hát nào được yêu thích";

    el.list.innerHTML = `
      <div style="text-align:center; padding:80px 20px; color:var(--text-dim);">
        <i class="fa-regular fa-heart" style="font-size:64px; margin-bottom:20px; opacity:0.3;"></i>
        <div style="font-size:16px;">${emptyText}</div>
      </div>`;
    return;
  }

  el.list.innerHTML = favSongs
    .map((s, displayIdx) => {
      const originalIndex = songs.findIndex((song) => song.id === s.id);
      const isActive = originalIndex === state.currentSongIndex;
      let indexContent = `<span class="song-index">${displayIdx + 1}</span>`;

      if (isActive && state.isPlaying)
        indexContent = `<div class="playing-gif"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>`;
      else if (isActive)
        indexContent = `<i class="fa-solid fa-play" style="color:var(--neon-primary); font-size:12px;"></i>`;

      return `
        <div class="song-item ${
          isActive ? "active" : ""
        }" onclick="playSong(${originalIndex}, 'favorites')">
           <div class="song-index-wrapper">${indexContent}</div>
           <div class="song-info">
               <div class="song-title" style="color: ${
                 isActive ? "var(--neon-primary)" : "white"
               }">${s.title}</div>
               <div class="song-artist">${s.artist}</div>
           </div>
           <div style="display:flex; align-items:center; justify-content:center;">
               <button class="btn-heart-list heart-btn liked" 
                       data-id="${s.id}" 
                       onclick="event.stopPropagation(); toggleFavorite(${
                         s.id
                       })">
                   <i class="fa-solid fa-heart"></i>
               </button>
           </div>
           <div class="song-duration">${s.duration || "--:--"}</div>
        </div>`;
    })
    .join("");
}

// === LOGIC CHUYỂN TRANG (Main / Settings) ===

// 3. GÁN SỰ KIỆN CLICK CHO TỪNG NÚT TRÊN SIDEBAR
const navItems = document.querySelectorAll(".nav-item");

// Nút Khám phá (Vị trí đầu tiên)
if (navItems[0]) {
  navItems[0].onclick = showMainPlaylist;
}

// Nút Yêu thích (Tìm theo ID navFavorite)
const navFav = document.getElementById("navFavorite");
if (navFav) {
  navFav.onclick = showFavoritePlaylist;
}

// Nút Cài đặt (Nút cuối cùng)
if (navItems.length > 0) {
  navItems[navItems.length - 1].onclick = showSettingsPage;
}
function toggleMobileSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("mobileOverlay");
  sidebar.classList.toggle("active");
  overlay.classList.toggle("active");
}
document.querySelectorAll(".sidebar .nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    if (window.innerWidth <= 768) toggleMobileSidebar();
  });
});
document
  .getElementById("mobileOverlay")
  .addEventListener("click", toggleMobileSidebar);

// ==================== SMART SWIPE LOGIC (FIXED DOUBLE SKIP) ====================
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
const minSwipeDistance = 50;
let lastSwipeTime = 0; // Biến lưu thời gian vuốt lần cuối

const swipeTargets = [
  document.getElementById("controlDeck"),
  document.getElementById("discWrapper"),

  document.getElementById("fsDiscWrapper"),
  document.querySelector(".fs-content"),
  document.querySelector(".footer-info"),
  document.querySelector(".right-panel"),
];

swipeTargets.forEach((target) => {
  if (!target) return;

  target.addEventListener(
    "touchstart",
    (e) => {
      if (
        e.target.closest(".mobile-header") ||
        e.target.closest(".search-container")
      ) {
        touchStartX = null; // Hủy bỏ thao tác vuốt ngay lập tức
        return;
      }
      // 1. Chặn nếu chạm vào các thành phần tương tác đặc biệt
      if (
        e.target.closest(".banner-slider") ||
        e.target.closest(".search-container") ||
        e.target.closest(".charts-3d-container") ||
        e.target.closest(".planets-orbit")
      ) {
        touchStartX = null; // Vô hiệu hóa lần chạm này
        return;
      }
      // 1. Chặn nếu chạm vào thanh trượt (input range)
      if (e.target.tagName === "INPUT" && e.target.type === "range") {
        touchStartX = null;
        return;
      }

      // ==================================================================
      // --- THÊM ĐOẠN NÀY: GIỚI HẠN VUỐT KHI XOAY NGANG (LANDSCAPE) ---
      // ==================================================================
      const isLandscape =
        window.innerHeight < 500 && window.innerWidth > window.innerHeight;

      if (isLandscape) {
        // Kiểm tra xem người dùng có đang chạm vào Right Panel hay không
        const inRightPanel = e.target.closest(".right-panel");

        // Kiểm tra xem có đang ở màn hình Fullscreen (Player/Lyrics) không (để không chặn nhầm)
        const inFullScreen =
          e.target.closest(".fs-content") ||
          e.target.closest(".lyrics-fs-content");

        // Nếu KHÔNG PHẢI Right Panel và KHÔNG PHẢI Fullscreen -> CHẶN
        if (!inRightPanel && !inFullScreen) {
          touchStartX = null;
          return;
        }
      }

      const touch = e.changedTouches[0];
      touchStartX = touch.screenX;
      touchStartY = touch.clientY;

      // 2. Safe Area: Chặn nếu chạm quá thấp (gần thanh Home iPhone)
      if (touchStartY > window.innerHeight - 40) {
        touchStartX = null;
      }
    },
    { passive: true },
  );

  target.addEventListener(
    "touchend",
    (e) => {
      if (touchStartX === null) return;
      touchEndX = e.changedTouches[0].screenX;
      handleSwipeGesture();
    },
    { passive: true },
  );
});

function handleSwipeGesture() {
  if (touchStartX === null) return;

  // --- FIX QUAN TRỌNG: COOLDOWN 500ms ---
  // Ngăn chặn sự kiện chạy 2 lần do Bubbling hoặc vuốt quá nhanh
  const now = Date.now();
  if (now - lastSwipeTime < 500) {
    return;
  }
  // --------------------------------------

  const distance = touchStartX - touchEndX;

  // Vuốt sang trái (Next)
  if (distance > minSwipeDistance) {
    lastSwipeTime = now; // Cập nhật thời gian thực thi
    nextSong();

    const btn = document.querySelector(".fa-forward-step")?.parentElement;
    if (btn) {
      btn.classList.add("active");
      setTimeout(() => btn.classList.remove("active"), 200);
    }
    showToast(
      "Đã vuốt: Bài tiếp theo",
      "success",
      '<i class="fa-solid fa-forward"></i>',
    );
  }

  // Vuốt sang phải (Prev)
  else if (distance < -minSwipeDistance) {
    lastSwipeTime = now; // Cập nhật thời gian thực thi
    prevSong();

    const btn = document.querySelector(".fa-backward-step")?.parentElement;
    if (btn) {
      btn.classList.add("active");
      setTimeout(() => btn.classList.remove("active"), 200);
    }
    showToast(
      "Đã vuốt: Bài trước đó",
      "success",
      '<i class="fa-solid fa-backward"></i>',
    );
  }
}

// === LOGIC FULL SCREEN PLAYER (FIXED) ===
const fsOverlay = document.getElementById("fullScreenPlayer");
const fsElements = {
  cover: document.getElementById("fsCover"),
  backdrop: document.getElementById("fsBackdrop"),
  title: document.getElementById("fsTitle"),
  artist: document.getElementById("fsArtist"),
  playBtn: document.getElementById("fsPlayBtn"),
  discWrapper: document.getElementById("fsDiscWrapper"),
  currentTime: document.getElementById("fsCurrentTime"),
  duration: document.getElementById("fsDuration"),
  progressFill: document.getElementById("fsProgressFill"),
};

fsElements.playBtn.addEventListener("click", togglePlay);
const footerImgWrapper = document.querySelector(".footer-cover-wrapper");
if (footerImgWrapper) {
  footerImgWrapper.style.cursor = "pointer";
  footerImgWrapper.addEventListener("click", openFullScreen);
}

function openFullScreen() {
  if (window.innerWidth > 1024) return; // Chỉ chạy trên Mobile/Tablet
  document.body.classList.add("player-hidden");

  // 1. Thêm class này để CSS biết là đang Fullscreen -> Ẩn Player Bar đi
  document.body.classList.add("fullscreen-active");
  // Preload backdrop để giảm lag
  const song = state.currentSong || songs[state.currentSongIndex];
  const preloadImg = new Image();
  preloadImg.src = song.cover;
  preloadImg.onload = () => {
    updateFullScreenUI();
    requestAnimationFrame(() => fsOverlay.classList.add("active")); // ← Thêm: Tăng tốc animation bằng RAF
  };
}

// --- CẬP NHẬT HÀM closeFullScreen ---
function closeFullScreen() {
  const fsOverlay = document.getElementById("fullScreenPlayer");
  document.body.classList.remove("player-hidden");
  // 1. Gỡ class để hiện lại Player Bar
  document.body.classList.remove("fullscreen-active");

  requestAnimationFrame(() => fsOverlay.classList.remove("active"));
}

function updateFullScreenUI() {
  const song = state.currentSong || songs[state.currentSongIndex];
  fsElements.cover.src = song.cover;
  fsElements.backdrop.style.backgroundImage = `url('${song.cover}')`;
  fsElements.title.innerText = song.title;
  fsElements.artist.innerText = song.artist;
  fsElements.duration.innerText = formatTime(audio.duration || 0);

  // Sync play/pause ban đầu
  syncFsPlayState();

  // Hook realtime: setInterval nhẹ (mỗi 300ms) chỉ khi full-screen mở
  const fsSyncInterval = setInterval(syncFsPlayState, 300);

  // Clear interval khi close full-screen
  fsOverlay.addEventListener(
    "transitionend",
    () => {
      if (!fsOverlay.classList.contains("active")) {
        clearInterval(fsSyncInterval);
      }
    },
    { once: true },
  ); // Chỉ listen 1 lần
}

// Hàm sync play state cho full-screen
function syncFsPlayState() {
  if (state.isPlaying) {
    fsElements.playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    fsElements.discWrapper.classList.add("playing");
  } else {
    fsElements.playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    fsElements.discWrapper.classList.remove("playing");
  }
}

audio.addEventListener("timeupdate", () => {
  if (!fsOverlay.classList.contains("active")) return;
  const curr = audio.currentTime;
  const dur = audio.duration || 1;
  const pct = (curr / dur) * 100;
  fsElements.currentTime.innerText = formatTime(curr);
  fsElements.progressFill.style.width = `${pct}%`;

  // Thêm: Sync play state nếu cần (dự phòng)
  syncFsPlayState();
});

// Thêm event play/pause để sync ngay lập tức
audio.addEventListener("play", syncFsPlayState);
syncLandscapePlayButton();
audio.addEventListener("pause", syncFsPlayState);
syncLandscapePlayButton();
// === LOGIC LYRICS ===
function toggleLyrics() {
  const overlay = document.getElementById("lyricsOverlay");
  const btn = document.getElementById("lyricsBtn");
  const isActive = overlay.classList.toggle("active");
  btn.classList.toggle("active", isActive);

  if (isActive) loadLyrics();
}

// Hàm loadLyrics thông minh (Hybrid: Local + Online)
async function loadLyrics() {
  // Ưu tiên lấy từ state.currentSong, nếu không có mới lấy từ list
  const song = state.currentSong || songs[state.currentSongIndex];
  const content = document.getElementById("lyricsContent");

  // Hiện trạng thái đang tải
  content.innerHTML =
    '<div style="margin-top:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Đang tìm lời bài hát...</div>';

  // BƯỚC 1: Kiểm tra trong file lyrics.js (Local) trước
  // (Ưu tiên lời bạn tự nhập vì nó chính xác nhất)
  if (lyricsDatabase[song.id]) {
    console.log("Đã lấy lyrics từ Local Database");
    content.innerText = lyricsDatabase[song.id];
    return;
  }

  // BƯỚC 2: Nếu Local không có, gọi API LRCLIB (Online)
  try {
    console.log("Đang tìm lyrics online cho:", song.title);

    // Gọi API
    const response = await fetch(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
        song.artist,
      )}&track_name=${encodeURIComponent(song.title)}&duration=${
        audio.duration
      }`,
    );

    if (!response.ok) throw new Error("Not found");

    const data = await response.json();

    // LRCLIB trả về 2 loại: plainLyrics (lời thường) và syncedLyrics (lời chạy karaoke)
    // Ở đây mình lấy plainLyrics cho đơn giản
    if (data.plainLyrics) {
      content.innerText = data.plainLyrics;
    } else {
      throw new Error("No plain lyrics");
    }
  } catch (error) {
    console.error("Lỗi tìm lyrics:", error);
    // Nếu tìm không thấy cả trên mạng
    content.innerHTML =
      '<span style="color: #666; font-style: italic;">(Không tìm thấy lời bài hát này)</span>';
  }
}

// Tự động cập nhật lời khi đổi bài (nếu bảng lyrics đang mở)
audio.addEventListener("play", () => {
  if (document.getElementById("lyricsOverlay").classList.contains("active")) {
    loadLyrics();
  }
});
// === LOGIC LYRICS FULL SCREEN ===
const lyricsPage = document.getElementById("lyricsFullScreen");
const lyricsUI = {
  backdrop: document.getElementById("lyricsBackdrop"),
  cover: document.getElementById("lyricsCover"),
  title: document.getElementById("lyricsTitle"),
  artist: document.getElementById("lyricsArtist"),
  container: document.getElementById("lyricsTextContainer"),
};

// Hàm mở trang Lyrics (Gán vào nút Lyrics ở Footer)
// Tìm nút có id="lyricsBtn" và sửa onclick="openLyricsPage()"
// CẬP NHẬT HÀM toggleLyricsPage
async function toggleLyricsPage() {
  const lyricsPage = document.getElementById("lyricsFullScreen");
  const btn = document.getElementById("lyricsBtn");

  // Kiểm tra xem đang mở hay đóng
  const isActive = lyricsPage.classList.contains("active");

  if (isActive) {
    // === TRƯỜNG HỢP ĐÓNG ===
    lyricsPage.classList.remove("active");
    if (btn) btn.classList.remove("active");

    // [QUAN TRỌNG] Gỡ class khỏi body để HIỆN LẠI thanh Player Bar
    document.body.classList.remove("lyrics-active");
  } else {
    // === TRƯỜNG HỢP MỞ ===
    const song = state.currentSong || songs[state.currentSongIndex];

    if (lyricsUI.cover) lyricsUI.cover.src = song.cover;
    if (lyricsUI.backdrop)
      lyricsUI.backdrop.style.backgroundImage = `url('${song.cover}')`;
    if (lyricsUI.title) lyricsUI.title.innerText = song.title;
    if (lyricsUI.artist) lyricsUI.artist.innerText = song.artist;

    // 2. [QUAN TRỌNG] Thêm class vào body để ẨN thanh Player Bar (chỉ khi xoay ngang)
    document.body.classList.add("lyrics-active");

    // 3. Kích hoạt hiệu ứng mở
    lyricsPage.classList.add("active");
    if (btn) btn.classList.add("active");

    // 4. Đồng bộ nút Play (nếu hàm này tồn tại)
    if (typeof syncLandscapePlayButton === "function") {
      syncLandscapePlayButton();
    }

    // 5. Tải lời bài hát
    await fetchAndRenderLyrics(song);
  }
}

function closeLyricsPage() {
  const lyricsPage = document.getElementById("lyricsFullScreen");
  const btn = document.getElementById("lyricsBtn");

  // 1. Ẩn giao diện Lyrics Fullscreen
  if (lyricsPage) lyricsPage.classList.remove("active");

  // 2. Tắt trạng thái active của nút Lyrics ở Footer (nếu có)
  if (btn) btn.classList.remove("active");

  // 3. QUAN TRỌNG: Gỡ class khỏi body để HIỆN LẠI thanh Player Bar (Control Deck)
  document.body.classList.remove("lyrics-active");
}
// ======================================================
// === LOGIC LYRICS KARAOKE (FINAL VERSION) ===
// ======================================================

let lyricsData = []; // Mảng chứa lời: [{time: 12.5, text: "Alo 123"}, ...]
let activeLineIndex = -1; // Dòng đang hát

// 1. HÀM PHÂN TÍCH FILE LRC (Convert [00:12.50] -> Giây)
function parseLRC(lrcString) {
  const lines = lrcString.split("\n");
  const result = [];
  const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  lines.forEach((line) => {
    const match = line.match(timeReg);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = parseInt(match[3].padEnd(3, "0"));
      const time = min * 60 + sec + ms / 1000;
      const text = line.replace(timeReg, "").trim();
      if (text) result.push({ time, text });
    }
  });
  return result;
}

// 2. CÁC HÀM HỖ TRỢ TÌM KIẾM TÊN
function removeVietnameseTones(str) {
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  str = str.replace(/đ/g, "d");
  str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
  str = str.replace(/È|É|Ẹ|Ẻ|Ễ/g, "E");
  str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
  str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
  str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
  str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
  str = str.replace(/Đ/g, "D");
  str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, "");
  return str;
}

function cleanSongTitle(title) {
  return title
    .replace(/\(.*\)/g, "")
    .replace(/\[.*\]/g, "")
    .replace(/-.*$/g, "")
    .replace(/feat\..*/i, "")
    .replace(/ft\..*/i, "")
    .trim();
}

// 3. HÀM TẢI LYRICS (TÌM KIẾM + ƯU TIÊN SYNC)
async function fetchAndRenderLyrics(song) {
  lyricsUI.container.innerHTML =
    '<div class="lyrics-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Đang tìm lời bài hát...</div>';

  lyricsData = []; // Reset dữ liệu cũ
  activeLineIndex = -1;

  let rawLyrics = "";
  let isSynced = false;

  // --- BƯỚC 1: TRA CỨU LOCAL ---
  if (typeof lyricsDatabase !== "undefined" && lyricsDatabase[song.id]) {
    rawLyrics = lyricsDatabase[song.id];
    isSynced = /\[\d{2}:\d{2}/.test(rawLyrics); // Kiểm tra xem có phải file LRC không
  }
  // --- BƯỚC 2: TÌM ONLINE (ULTIMATE SEARCH) ---
  else {
    // Tạo danh sách từ khóa: [Gốc, Sạch, Không dấu, Viết liền]
    const queries = [];
    queries.push(song.title);

    const cleaned = cleanSongTitle(song.title);
    if (cleaned !== song.title) queries.push(cleaned);

    const unaccented = removeVietnameseTones(cleaned);
    if (unaccented !== cleaned) queries.push(unaccented);

    const compact = unaccented.replace(/\s+/g, "").toLowerCase();
    if (compact !== unaccented.toLowerCase()) queries.push(compact);

    // Vòng lặp tìm kiếm
    for (const q of queries) {
      if (rawLyrics) break; // Tìm thấy rồi thì thôi
      try {
        console.log(`Đang tìm lyrics với từ khóa: "${q}"`);
        const res = await fetch(
          `https://lrclib.net/api/search?q=${encodeURIComponent(
            song.artist + " " + q,
          )}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            // Lấy kết quả đầu tiên. Ưu tiên syncedLyrics nếu có, không thì lấy plainLyrics
            const item = data[0];
            if (item.syncedLyrics) {
              rawLyrics = item.syncedLyrics;
              isSynced = true;
            } else if (item.plainLyrics) {
              rawLyrics = item.plainLyrics;
              isSynced = false;
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  // --- BƯỚC 3: HIỂN THỊ RA MÀN HÌNH ---
  if (rawLyrics) {
    if (isSynced) {
      // Nếu là lời Karaoke (LRC)
      lyricsData = parseLRC(rawLyrics);
      const html = lyricsData
        .map(
          (line, index) =>
            `<div class="lyrics-line" id="line-${index}" onclick="seekToLine(${line.time})">${line.text}</div>`,
        )
        .join("");
      // Thêm padding dưới đáy để dòng cuối cùng cuộn được lên giữa
      lyricsUI.container.innerHTML = `<div style="padding-bottom: 50vh;">${html}</div>`;
    } else {
      // Nếu là lời thường (Plain text)
      const lines = rawLyrics.split("\n");
      lyricsUI.container.innerHTML = lines
        .map(
          (line) =>
            `<div class="lyrics-line" style="cursor:default;">${
              line || "<br>"
            }</div>`,
        )
        .join("");
    }
  } else {
    lyricsUI.container.innerHTML = `
                <div class="lyrics-placeholder">
                    Không tìm thấy lời bài hát.<br>
                    <span style="font-size: 13px; opacity: 0.6">(Đã thử tìm mọi cách nhưng thất bại)</span>
                </div>`;
  }
}

// 4. HÀM ĐỒNG BỘ (SYNC) KHI NHẠC CHẠY
// 4. HÀM ĐỒNG BỘ (SYNC) - ĐÃ SỬA LỖI GIẬT HEADER
function syncLyrics() {
  if (!lyricsData.length || !lyricsPage.classList.contains("active")) return;

  const currentTime = audio.currentTime;
  // Tìm dòng lời gần nhất với thời gian hiện tại
  let idx = lyricsData.findIndex((line) => line.time > currentTime) - 1;

  if (idx === -2) idx = lyricsData.length - 1; // Xử lý dòng cuối

  if (idx !== activeLineIndex) {
    // Bỏ active dòng cũ
    if (activeLineIndex !== -1) {
      const oldLine = document.getElementById(`line-${activeLineIndex}`);
      if (oldLine) oldLine.classList.remove("active");
    }

    // Active dòng mới
    activeLineIndex = idx;
    if (activeLineIndex !== -1) {
      const newLine = document.getElementById(`line-${activeLineIndex}`);
      if (newLine) {
        newLine.classList.add("active");

        // --- THAY ĐỔI QUAN TRỌNG Ở ĐÂY ---
        // Thay vì dùng scrollIntoView (gây giật), ta tính toán vị trí và cuộn nhẹ nhàng
        const container = lyricsUI.container;

        // Tính toán để dòng chữ nằm giữa màn hình
        // Vị trí dòng chữ - (Chiều cao khung / 2) + (Chiều cao dòng chữ / 2)
        const scrollPosition =
          newLine.offsetTop -
          container.clientHeight / 2 +
          newLine.clientHeight / 2 -
          40;

        // Cuộn nhẹ nhàng
        container.scrollTo({
          top: scrollPosition,
          behavior: "smooth",
        });
        // ----------------------------------
      }
    }
  }
}

// 5. TÍNH NĂNG TUA KHI BẤM VÀO LỜI
function seekToLine(time) {
  audio.currentTime = time;
  if (!state.isPlaying) togglePlay();
}

// 6. GẮN SỰ KIỆN SYNC VÀO AUDIO (Tìm đoạn audio.addEventListener('timeupdate') cũ và thêm vào)
audio.addEventListener("timeupdate", () => {
  // ... Các code cũ giữ nguyên ...

  // GỌI HÀM SYNC Ở ĐÂY
  syncLyrics();
});

// === CÁC HÀM UI CŨ ===
function toggleLyrics() {
  const overlay = document.getElementById("lyricsOverlay");
  // Kiểm tra xem overlay cũ có tồn tại không, nếu không thì dùng overlay mới
  if (overlay) {
    const btn = document.getElementById("lyricsBtn");
    const isActive = overlay.classList.toggle("active");
    btn.classList.toggle("active", isActive);
    if (isActive) loadLyrics(); // Hàm cũ cho modal nhỏ
  } else {
    // Mặc định mở Full Screen luôn
    openLyricsPage();
  }
}
// Tự động cập nhật nếu đang mở trang Lyrics mà đổi bài
audio.addEventListener("play", () => {
  if (lyricsPage.classList.contains("active")) {
    const song = songs[state.currentSongIndex];
    // Cập nhật ảnh/tên
    lyricsUI.cover.src = song.cover;
    lyricsUI.backdrop.style.backgroundImage = `url('${song.cover}')`;
    lyricsUI.title.innerText = song.title;
    lyricsUI.artist.innerText = song.artist;
    // Tải lời mới
    fetchAndRenderLyrics(song);
  }
});
// ======================================================
// === MEDIA SESSION API (FIX LỖI CHẠY NỀN) ===
// ======================================================

// Gọi hàm này mỗi khi đổi bài hát (Thêm vào cuối hàm loadSong)
function updateMediaSession() {
  if ("mediaSession" in navigator) {
    const song = songs[state.currentSongIndex];
    const coverUrl = new URL(song.cover, document.baseURI).href;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: "SoundSphere Collection",
      artwork: [
        { src: coverUrl, sizes: "96x96", type: "image/jpeg" },
        { src: coverUrl, sizes: "128x128", type: "image/jpeg" },
        { src: coverUrl, sizes: "192x192", type: "image/jpeg" },
        { src: coverUrl, sizes: "256x256", type: "image/jpeg" },
        { src: coverUrl, sizes: "384x384", type: "image/jpeg" },
        { src: coverUrl, sizes: "512x512", type: "image/jpeg" },
      ],
    });

    // Gắn sự kiện điều khiển từ màn hình khóa / tai nghe
    navigator.mediaSession.setActionHandler("play", () => {
      togglePlay();
      updatePlayStateMediaSession();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      togglePlay();
      updatePlayStateMediaSession();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => prevSong());
    navigator.mediaSession.setActionHandler("nexttrack", () => nextSong());

    // (Tùy chọn) Tua nhạc trên màn hình khóa
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime && details.fastSeek && "fastSeek" in audio) {
        audio.fastSeek(details.seekTime);
        return;
      }
      audio.currentTime = details.seekTime || 0;
      updatePositionState();
    });
  }
}

// Cập nhật trạng thái Play/Pause cho hệ thống
function updatePlayStateMediaSession() {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = state.isPlaying
      ? "playing"
      : "paused";
  }
}

// Cập nhật thanh thời gian trên màn hình khóa (quan trọng để không bị ngắt)
function updatePositionState() {
  if (
    "mediaSession" in navigator &&
    "setPositionState" in navigator.mediaSession
  ) {
    if (audio.duration && !isNaN(audio.duration)) {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: audio.currentTime,
      });
    }
  }
}
// ==================== FS TAB LOGIC ====================

// 1. Hàm chuyển Tab
function switchFsTab(tabName) {
  // Xóa active ở tất cả nút & nội dung
  document
    .querySelectorAll(".fs-tab-btn")
    .forEach((btn) => btn.classList.remove("active"));
  document
    .querySelectorAll(".fs-tab-content")
    .forEach((content) => content.classList.remove("active"));

  // Thêm active vào tab được chọn
  // Tìm nút dựa vào text hoặc thứ tự (ở đây dùng logic đơn giản)
  const buttons = document.querySelectorAll(".fs-tab-btn");
  if (tabName === "lyrics") buttons[0].classList.add("active");
  if (tabName === "playlist") {
    buttons[1].classList.add("active");
    renderFsPlaylist(); // Render playlist khi bấm vào tab này
    scrollToActiveSong(); // Cuộn tới bài đang hát
  }
  if (tabName === "info") {
    buttons[2].classList.add("active");
    updateInfoTab(); // Cập nhật thông tin khi bấm
  }

  // Hiển thị nội dung tương ứng
  document.getElementById(`tab-${tabName}`).classList.add("active");
}

// 2. Hàm Render Playlist trong Full Screen
function renderFsPlaylist() {
  const container = document.getElementById("fsPlaylistList");
  container.innerHTML = songs
    .map((s, i) => {
      const isActive = i === state.currentSongIndex;
      return `
               <div class="fs-song-item ${
                 isActive ? "active" : ""
               }" onclick="playSong(${i})">
                  <img src="${
                    s.cover
                  }" class="fs-song-img" loading="lazy" decoding="async">

                  <div class="fs-song-info">
                     <div class="fs-song-title">${s.title}</div>
                     <div class="fs-song-artist">${s.artist}</div>
                  </div>
                  ${
                    isActive
                      ? '<i class="fa-solid fa-chart-simple" style="color:var(--neon-primary)"></i>'
                      : ""
                  }
               </div>
             `;
    })
    .join("");
}

// 3. Hàm cuộn tới bài đang hát trong Playlist FS
function scrollToActiveSong() {
  setTimeout(() => {
    const activeEl = document.querySelector(".fs-song-item.active");
    if (activeEl) {
      const scrollPosition =
        activeEl.offsetTop -
        container.clientHeight / 2 +
        activeEl.clientHeight / 2;
      container.scrollTo({
        top: scrollPosition,
        behavior: "smooth",
      });
    }
  }, 100);
}

// 4. Hàm cập nhật Tab Thông tin
function updateInfoTab() {
  const song = songs[state.currentSongIndex];
  document.getElementById("infoArtist").innerText = song.artist;
  // Có thể thêm logic random Album nếu muốn
}
function updateActiveSongUI(index) {
  // 1. Tìm bài đang active cũ và tắt nó đi
  const oldActive = document.querySelector(".song-item.active");
  if (oldActive) {
    oldActive.classList.remove("active");
    const oldIdx = oldActive.id.replace("song-", "");
    const indexWrapper = oldActive.querySelector(".song-index-wrapper");
    if (indexWrapper) {
      indexWrapper.innerHTML = `<span class="song-index">${
        parseInt(oldIdx) + 1
      }</span>`;
    }
    const titleEl = oldActive.querySelector(".song-title");
    if (titleEl) titleEl.style.color = "white";
  }

  // 2. Bật active cho bài mới
  const newActive = document.getElementById(`song-${index}`);
  if (newActive) {
    newActive.classList.add("active", "just-active");
    setTimeout(() => newActive.classList.remove("just-active"), 1000);

    const waveHtml = `<div class="playing-gif"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>`;
    const playHtml = `<i class="fa-solid fa-play" style="color:var(--neon-primary); font-size:12px;"></i>`;

    const newIndexWrapper = newActive.querySelector(".song-index-wrapper");
    if (newIndexWrapper) {
      newIndexWrapper.innerHTML = state.isPlaying ? waveHtml : playHtml;
    }

    const newTitleEl = newActive.querySelector(".song-title");
    if (newTitleEl) newTitleEl.style.color = "var(--neon-primary)";

    // --- SỬA LỖI TỰ CUỘN TẠI ĐÂY ---
    // Chỉ cuộn nếu không phải là lúc trang web vừa load (kiểm tra state.isPlaying hoặc một biến flag)
    if (state.isPlaying) {
      newActive.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }
}
// ==================== AUTHENTICATION LOGIC ====================
function openAuthModal() {
  document.getElementById("authOverlay").classList.add("active");
  // Mặc định mở tab Login trước
  switchAuthMode("login");
}

function closeAuthModal() {
  document.getElementById("authOverlay").classList.remove("active");
}
// --- LOGIC MODAL PHÍM TẮT ---
function toggleShortcutsModal() {
  const modal = document.getElementById("shortcutsOverlay");
  modal.classList.toggle("active");
}

// Hàm chuyển đổi tab (Hỗ trợ 3 tab: Login, Register, Forgot)
function switchAuthMode(mode) {
  // 1. Ẩn tất cả các form trước
  document.querySelectorAll(".auth-form").forEach((f) => {
    f.classList.remove("active");
  });

  // 2. Hiện form đích (CSS sẽ tự lo phần animation trượt vào)
  const targetForm = document.getElementById(mode + "Form");
  if (targetForm) {
    targetForm.classList.add("active");

    // Tự động focus vào ô nhập liệu đầu tiên cho tiện
    const firstInput = targetForm.querySelector("input");
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
  }
}
// === LOGIC AUTH MỚI (VALIDATION + SHOW/HIDE) ===

// 1. Ẩn/Hiện mật khẩu
function togglePass(inputId, icon) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
    icon.style.color = "var(--neon-primary)";
  } else {
    input.type = "password";
    icon.classList.remove("fa-eye-slash");
    icon.classList.add("fa-eye");
    icon.style.color = "#aaa";
  }
}

// 2. Gợi ý độ mạnh mật khẩu
function checkStrength(input) {
  const val = input.value;
  const msg = document.getElementById("passStrengthMsg");

  input.className = ""; // Reset class

  if (!val) {
    msg.innerText = "";
    msg.classList.remove("show");
    return;
  }

  msg.classList.add("show");

  if (val.length < 6) {
    msg.innerText = "• Mật khẩu quá ngắn (cần > 6 ký tự)";
    msg.style.color = "#ff4757";
    input.classList.add("input-weak");
  } else if (val.match(/[0-9]/) && val.match(/[!@#$%^&*]/)) {
    msg.innerText = "• Tuyệt vời! Mật khẩu rất mạnh";
    msg.style.color = "#2ed573";
    input.classList.add("input-strong");
  } else {
    msg.innerText = "• Khá ổn (Thêm số & ký tự để mạnh hơn)";
    msg.style.color = "#ffa502";
    input.classList.add("input-medium");
  }
}

// 3. Hàm hiển thị lỗi
function showError(input, message) {
  const parent =
    input.closest(".input-group") || input.parentElement.parentElement;
  const errorSpan = parent.querySelector(".error-msg");
  if (errorSpan) {
    errorSpan.innerText = message;
    errorSpan.classList.add("show");
  }
  input.classList.add("input-error");

  // Tự động xóa lỗi khi người dùng nhập lại
  input.addEventListener(
    "input",
    function () {
      input.classList.remove("input-error");
      if (errorSpan) errorSpan.classList.remove("show");
    },
    { once: true },
  );
}

// 4. Xử lý Đăng nhập
// Tìm hàm handleLogin và thay thế nội dung bên trong khối if (isValid)

function handleLogin(e) {
  e.preventDefault();
  const user = document.getElementById("loginUser");
  const pass = document.getElementById("loginPass");
  let isValid = true;

  if (!user.value.trim()) {
    showError(user, "Vui lòng nhập tên đăng nhập");
    isValid = false;
  }
  if (!pass.value.trim()) {
    showError(pass, "Vui lòng nhập mật khẩu");
    isValid = false;
  }

  if (isValid) {
    // 1. Đóng Modal
    closeAuthModal();

    // 2. Hiện thông báo chào mừng
    showToast(
      `Xin chào, ${user.value}!`,
      "success",
      '<i class="fa-solid fa-hand-sparkles"></i>',
    );

    // 3. CẬP NHẬT GIAO DIỆN SIDEBAR
    const navAccount = document.getElementById("navAccount");

    // --- LOGIC MỚI: XỬ LÝ TÊN 3 CHỮ ---
    // B1: Đếm xem tên có bao nhiêu từ
    const words = user.value.trim().split(/\s+/);
    const wordCount = words.length;

    // B2: LOGIC MỚI CHUẨN XÁC HƠN:
    // - Nếu tên đúng 2 chữ (VD: Sơn Tùng) -> Lấy 2 ký tự (ST)
    // - Các trường hợp còn lại (Tên 1 chữ hoặc tên dài 3,4,5 chữ) -> Chỉ lấy 1 ký tự đầu
    const charLength = wordCount === 2 ? 2 : 1;

    // B3: Gọi API... (Giữ nguyên)
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      user.value,
    )}&background=random&color=fff&size=128&length=${charLength}&bold=true`;

    // Thêm title="${user.value}" để hover vào thấy tên full
    navAccount.innerHTML = `
                <img src="${avatarUrl}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid var(--neon-primary); flex-shrink: 0;">
                <span style="color: var(--neon-primary); font-weight: 700;" title="${user.value}">${user.value}</span>
            `;

    navAccount.onclick = function () {
      openLogoutModal();
    };
  }
}

// 5. Xử lý Đăng ký
function handleRegister(e) {
  e.preventDefault();
  const user = document.getElementById("regUser");
  const email = document.getElementById("regEmail");
  const pass = document.getElementById("regPass");
  const confirm = document.getElementById("regConfirmPass");
  const captcha = document.getElementById("captchaCheck");
  let isValid = true;

  if (!user.value.trim()) {
    showError(user, "Tên đăng nhập không được trống");
    isValid = false;
  }
  if (!email.value.trim()) {
    showError(email, "Email không được trống");
    isValid = false;
  } else if (!email.value.includes("@")) {
    showError(email, "Email không hợp lệ");
    isValid = false;
  }

  if (!pass.value) {
    showError(pass, "Mật khẩu không được trống");
    isValid = false;
  } else if (pass.value.length < 6) {
    showError(pass, "Mật khẩu phải trên 6 ký tự");
    isValid = false;
  }

  if (confirm.value !== pass.value) {
    showError(confirm, "Mật khẩu nhập lại không khớp");
    isValid = false;
  }

  if (!captcha.checked) {
    const captchaMsg = document.getElementById("captchaError");
    captchaMsg.innerText = "Vui lòng xác nhận bạn không phải robot";
    captchaMsg.classList.add("show");
    isValid = false;
  } else {
    document.getElementById("captchaError").classList.remove("show");
  }

  if (isValid) {
    closeAuthModal();
    showToast(
      "Đăng ký thành công!",
      "success",
      '<i class="fa-solid fa-check"></i>',
    );
  }
}
// === LOGIC QUÊN MẬT KHẨU & ĐĂNG XUẤT ===

// 1. Xử lý gửi yêu cầu quên mật khẩu
function handleForgotPass(e) {
  e.preventDefault();
  const email = document.getElementById("forgotEmail");

  if (!email.value.trim() || !email.value.includes("@")) {
    showError(email, "Vui lòng nhập email hợp lệ");
    return;
  }

  // Giả lập gửi thành công
  closeAuthModal();
  showToast(
    `Đã gửi mail khôi phục tới: ${email.value}`,
    "success",
    '<i class="fa-solid fa-envelope-circle-check"></i>',
  );

  // Reset form và quay về trang đăng nhập cho lần sau
  email.value = "";
  setTimeout(() => switchAuthMode("login"), 500);
}

// 2. Logic Popup Đăng xuất
function openLogoutModal() {
  document.getElementById("logoutOverlay").classList.add("active");
}
function closeLogoutModal() {
  document.getElementById("logoutOverlay").classList.remove("active");
}
// Hàm xác nhận đăng xuất (Gắn vào nút "Đồng ý" trong bảng Logout)
function confirmLogout() {
  if (window.auth) {
    // 1. Gọi lệnh đăng xuất của Firebase
    window.auth
      .signOut()
      .then(() => {
        console.log("Đã đăng xuất thành công!");
        // 2. Sau khi thoát xong mới tải lại trang
        window.location.reload();
      })
      .catch((error) => {
        console.error("Lỗi đăng xuất:", error);
        alert("Không thể đăng xuất: " + error.message);
      });
  } else {
    // Trường hợp dự phòng nếu chưa load xong Firebase
    window.location.reload();
  }
}
// ==================== LANGUAGE SYSTEM (FINAL FULL) ====================

const translations = {
  vi: {
    // SIDEBAR
    sb_explore: "Khám phá",
    sb_library: "Thư viện",
    sb_favorite: "Yêu thích",
    sb_recent: "Đã nghe gần đây",
    sb_account: "Tài khoản",
    sb_settings: "Cài đặt",

    // SETTINGS
    st_header: "Cài Đặt",
    st_acc_title: "Tài khoản",
    st_acc_edit: "Chỉnh sửa phương thức đăng nhập",
    st_acc_desc: "Thay đổi mật khẩu hoặc liên kết mạng xã hội",
    st_lang_title: "Ngôn ngữ",
    st_lang_opt: "Ngôn ngữ hiển thị",
    st_lang_desc: "Giao diện sẽ chuyển đổi ngay lập tức",
    st_audio_title: "Chất lượng âm thanh",
    st_audio_stream: "Chất lượng stream",
    st_audio_desc: "Điều chỉnh độ bit-rate của nhạc",
    st_qual_high: "Cao (320kbps)",
    st_qual_std: "Chuẩn (128kbps)",
    st_other_title: "Thông tin khác",
    st_fullscreen_title: "Chế độ toàn màn hình",
    st_fullscreen_desc: "Ẩn thanh địa chỉ trình duyệt (Android/PC)",
    st_about: "Giới thiệu về SoundSphere",
    st_terms: "Điều khoản sử dụng",
    st_privacy: "Chính sách bảo mật",
    settings_terms: "Điều khoản sử dụng",
    settings_policy: "Chính sách bảo mật",
    st_report: "Báo cáo vi phạm bản quyền",
    st_contact: "Liên hệ hỗ trợ",

    // AUTH & POPUP
    auth_login_header: "Đăng nhập",
    auth_welcome: "Chào mừng bạn quay trở lại SoundSphere",
    auth_user: "Tên đăng nhập",
    auth_user_ph: "Tên đăng nhập",
    auth_pass: "Mật khẩu",
    auth_pass_ph: "Mật khẩu",
    auth_remember: "Ghi nhớ đăng nhập",
    auth_forgot: "Quên mật khẩu?",
    auth_btn_login: "Đăng nhập",
    auth_no_acc: "Chưa có tài khoản?",
    auth_reg_here: "Đăng kí nhé!",
    auth_or: "Hoặc tiếp tục với",
    auth_policy:
      'Việc đăng nhập đồng nghĩa với việc bạn đồng ý với <br> <a href="#">Điều khoản</a> và <a href="#">Chính sách</a> của SoundSphere.',

    auth_reg_header: "Đăng kí tài khoản mới",
    auth_re_pass: "Nhập lại mật khẩu",
    auth_re_pass_ph: "Xác nhận mật khẩu",
    auth_robot: "Tôi không phải người máy",
    auth_btn_reg: "Đăng kí",
    auth_have_acc: "Đã có tài khoản?",
    auth_login_here: "Đăng nhập nhé!",

    auth_forgot_header: "Khôi phục mật khẩu",
    auth_forgot_sub: "Nhập email để nhận hướng dẫn đặt lại mật khẩu",
    auth_email_reg: "Email đăng ký",
    auth_btn_send: "Gửi yêu cầu",
    auth_back_login: "Quay lại đăng nhập",

    auth_logout_header: "Đăng xuất?",
    auth_logout_sub: "Bạn có chắc chắn muốn đăng xuất khỏi tài khoản không?",
    auth_btn_cancel: "Hủy",
    auth_btn_logout: "Đăng xuất",

    // --- TỪ VỰNG MỚI CHO TAB LYRICS ---
    tab_lyrics: "Lời bài hát",
    tab_playlist: "Danh sách phát",
    tab_info: "Thông tin",
    info_credit: "Credit",
    info_artist: "Nghệ sĩ",
    info_album: "Album",

    sb_search_ph: "Tìm kiếm bài hát, nghệ sĩ...",
    empty_fav_text: "Chưa có bài hát nào được yêu thích",
    empty_recent_text: "Chưa có lịch sử nghe nhạc",

    sec_universe: "Khám phá vũ trụ",
    sec_charts: "Bảng Xếp Hạng",
    sec_suggest: "Gợi ý cho bạn",
    fav_title: "Bài hát yêu thích",

    lib_playlist: "Playlist của bạn",
    lib_liked: "Bài hát đã thích",
    lib_down: "Tải xuống",
    lib_most: "Nghe nhiều nhất",
    lib_empty: "Trống",
    lib_auto: "Tự động tạo",
    lib_suggest: "Gợi ý từ:",
    lib_based: "Dựa trên thói quen nghe",
    lib_all: "Tất cả bài hát",
    empty_recent_text: "Chưa có lịch sử nghe nhạc",

    btn_clear_history: "Xóa lịch sử",
    confirm_clear_history:
      "Bạn có chắc chắn muốn xóa toàn bộ lịch sử nghe nhạc không?",
    msg_history_cleared: "Đã xóa lịch sử nghe nhạc!",

    modal_clear_title: "Xóa lịch sử?",
    modal_clear_desc:
      "Bạn có chắc chắn muốn xóa toàn bộ danh sách đã nghe không? Hành động này không thể hoàn tác.",
    btn_confirm_delete: "Xóa ngay",

    // --- SLEEP TIMER ---
    timer_header: "Hẹn giờ tắt nhạc",
    timer_hour: "Giờ",
    timer_min: "Phút",
    timer_preview_default: "Chưa thiết lập hẹn giờ",
    timer_cancel: "Hủy hẹn giờ",
    timer_start_btn: "Bắt đầu đếm ngược",
    timer_preview_label: "Nhạc sẽ tắt lúc",
    timer_preview_in: "Sau", // Ví dụ: Sau 1 giờ 30 phút
    timer_toast_set: "Đã hẹn giờ tắt sau",
    timer_status_off: "Sẽ tắt nhạc lúc",
    timer_status_closing: "Đang tắt nhạc...",

    // --- POMODORO ---
    pomo_header: "Pomodoro Focus",
    pomo_time_input: "Thời gian (phút):",
    pomo_auto_pause: "Dừng nhạc khi hết giờ",
    pomo_ready: "Sẵn sàng tập trung",
    pomo_start: "Bắt đầu",
    pomo_pause: "Tạm dừng",
    pomo_continue: "Tiếp tục",
    pomo_running: "Đang tập trung...",
    pomo_paused: "Đã tạm dừng",
    pomo_done: "Đã hoàn thành!",
    pomo_toast_done: "🎉 Hoàn thành phiên làm việc!",

    rp_header: "Đang phát",
    // --- PHÍM TẮT & TOAST ---
    sc_title: "Phím tắt & Cử chỉ",
    sc_pc: "🖥️ Máy tính (PC)",
    sc_mobile: "📱 Điện thoại (Cảm ứng)",
    sc_space: "Phát / Tạm dừng",
    sc_kl: "Bài trước / Bài sau",
    sc_vol: "Tăng / Giảm âm lượng",
    sc_mute: "Tắt / Bật tiếng",
    sc_sr: "Trộn bài / Lặp lại",

    sc_m_tap: "Chạm vào đĩa nhạc nhỏ",
    sc_m_tap_desc: "Mở giao diện MP3 toàn màn hình",
    sc_m_swipe: "Vuốt thanh phát nhạc",
    sc_m_swipe_desc: "Vuốt sang trái/phải để chuyển bài",
    sc_m_rotate: "Xem lời bài hát (Karaoke)",
    sc_m_rotate_desc: "Xoay ngang điện thoại & Chạm vào đĩa nhạc",

    toast_playing: "Đang phát",
    toast_paused: "Đã tạm dừng",
    toast_next: "Bài tiếp theo",
    toast_prev: "Bài trước đó",
    toast_vol: "Âm lượng",
    toast_muted: "Đã tắt tiếng",
    toast_unmuted: "Đã bật tiếng",
    tt_title: "Phím tắt:",
    st_tools_title: "Tiện ích mở rộng",
    timer_desc: "Tự động tắt nhạc sau một khoảng thời gian",
    pomo_desc: "Đồng hồ đếm ngược giúp tập trung",
    sc_desc: "Xem hướng dẫn thao tác và cử chỉ",
    auth_policy:
      'Việc đăng nhập đồng nghĩa với việc bạn đồng ý với <br> <a href="#" onclick="openInfoModal(\'terms\'); return false;" style="color:var(--neon-primary); font-weight:bold;">Điều khoản</a> và <a href="#" onclick="openInfoModal(\'privacy\'); return false;" style="color:var(--neon-primary); font-weight:bold;">Chính sách</a> của SoundSphere.',
  },
  en: {
    // SIDEBAR
    sb_explore: "Explore",
    sb_library: "Library",
    sb_favorite: "Favorites",
    sb_recent: "Recently Played",
    sb_account: "Account",
    sb_settings: "Settings",

    // SETTINGS
    st_header: "Settings",
    st_acc_title: "Account",
    st_acc_edit: "Login Methods",
    st_acc_desc: "Change password or link social accounts",
    st_lang_title: "Language",
    st_lang_opt: "Display Language",
    st_lang_desc: "Interface will update immediately",
    st_audio_title: "Audio Quality",
    st_audio_stream: "Streaming Quality",
    st_audio_desc: "Adjust music bit-rate",
    st_qual_high: "High (320kbps)",
    st_qual_std: "Standard (128kbps)",
    st_other_title: "Others",
    st_fullscreen_title: "Full Screen Mode",
    st_fullscreen_desc: "Hide browser address bar (Android/PC)",
    st_about: "About SoundSphere",
    st_terms: "Terms of Service",
    st_privacy: "Privacy Policy",
    settings_terms: "Terms of Use",
    settings_policy: "Privacy Policy",
    st_report: "Report Copyright Issue",
    st_contact: "Contact Support",

    // AUTH & POPUP
    auth_login_header: "Login",
    auth_welcome: "Welcome back to SoundSphere",
    auth_user: "Username",
    auth_user_ph: "Username",
    auth_pass: "Password",
    auth_pass_ph: "Password",
    auth_remember: "Remember me",
    auth_forgot: "Forgot password?",
    auth_btn_login: "Login",
    auth_no_acc: "Don't have an account?",
    auth_reg_here: "Register now!",
    auth_or: "Or continue with",
    auth_policy:
      'By logging in, you agree to SoundSphere\'s <br> <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.',

    auth_reg_header: "Create new account",
    auth_re_pass: "Confirm Password",
    auth_re_pass_ph: "Confirm Password",
    auth_robot: "I'm not a robot",
    auth_btn_reg: "Register",
    auth_have_acc: "Already have an account?",
    auth_login_here: "Login now!",

    auth_forgot_header: "Recovery Password",
    auth_forgot_sub: "Enter email to receive instructions",
    auth_email_reg: "Registered Email",
    auth_btn_send: "Send Request",
    auth_back_login: "Back to Login",

    auth_logout_header: "Logout?",
    auth_logout_sub: "Are you sure you want to logout?",
    auth_btn_cancel: "Cancel",
    auth_btn_logout: "Logout",

    // --- NEW LYRICS TAB VOCABULARY ---
    tab_lyrics: "Lyrics",
    tab_playlist: "Playlist",
    tab_info: "Info",
    info_credit: "Credits",
    info_artist: "Artist",
    info_album: "Album",

    sb_search_ph: "Search for songs, artists...",
    empty_fav_text: "No favorite songs yet",
    empty_recent_text: "No playback history yet",

    sec_universe: "Explore Universe",
    sec_charts: "Top Charts",
    sec_suggest: "Suggested for you",
    fav_title: "Favorite Songs",

    lib_playlist: "Your Playlists",
    lib_liked: "Liked Songs",
    lib_down: "Downloads",
    lib_most: "Most Played",
    lib_empty: "Empty",
    lib_auto: "Auto generated",
    lib_suggest: "Suggestions from:",
    lib_based: "Based on listening history",
    lib_all: "All Songs",
    empty_recent_text: "No playback history yet",

    btn_clear_history: "Clear History",
    confirm_clear_history:
      "Are you sure you want to clear your playback history?",
    msg_history_cleared: "Playback history cleared!",

    modal_clear_title: "Clear History?",
    modal_clear_desc:
      "Are you sure you want to clear your entire listening history? This cannot be undone.",
    btn_confirm_delete: "Delete",

    // --- SLEEP TIMER ---
    timer_header: "Sleep Timer",
    timer_hour: "Hour",
    timer_min: "Min",
    timer_preview_default: "Timer not set",
    timer_cancel: "Cancel Timer",
    timer_start_btn: "Start Countdown",
    timer_preview_label: "Music stops at",
    timer_preview_in: "In",
    timer_toast_set: "Sleep timer set for",
    timer_status_off: "Music stops at",
    timer_status_closing: "Stopping music...",

    // --- POMODORO ---
    pomo_header: "Pomodoro Focus",
    pomo_time_input: "Duration (min):",
    pomo_auto_pause: "Pause music when done",
    pomo_ready: "Ready to focus",
    pomo_start: "Start",
    pomo_pause: "Pause",
    pomo_continue: "Resume",
    pomo_running: "Focusing...",
    pomo_paused: "Paused",
    pomo_done: "Session Finished!",
    pomo_toast_done: "🎉 Session completed!",
    // -------------------
    rp_header: "Now Playing",
    // --- SHORTCUTS & TOAST ---
    sc_title: "Shortcuts & Gestures",
    sc_pc: "🖥️ Computer (PC)",
    sc_mobile: "📱 Mobile (Touch)",
    sc_space: "Play / Pause",
    sc_kl: "Prev / Next Song",
    sc_vol: "Volume Up / Down",
    sc_mute: "Mute / Unmute",
    sc_sr: "Shuffle / Repeat",

    sc_m_tap: "Tap mini disc",
    sc_m_tap_desc: "Open Full Screen Player",
    sc_m_swipe: "Swipe Player Bar",
    sc_m_swipe_desc: "Swipe Left/Right to change song",
    sc_m_rotate: "View Lyrics (Karaoke)",
    sc_m_rotate_desc: "Rotate Landscape & Tap Disc",

    toast_playing: "Now Playing",
    toast_paused: "Paused",
    toast_next: "Next Song",
    toast_prev: "Previous Song",
    toast_vol: "Volume",
    toast_muted: "Muted",
    toast_unmuted: "Unmuted",
    tt_title: "Shortcuts:",
    st_tools_title: "Utilities",
    timer_desc: "Automatically stop music after a set time",
    pomo_desc: "Countdown timer for focus sessions",
    sc_desc: "View shortcuts and touch gestures",
    auth_policy:
      'By logging in, you agree to SoundSphere\'s <br> <a href="#" onclick="openInfoModal(\'terms\'); return false;" style="color:var(--neon-primary); font-weight:bold;">Terms</a> and <a href="#" onclick="openInfoModal(\'privacy\'); return false;" style="color:var(--neon-primary); font-weight:bold;">Privacy Policy</a>.',
  },
};
let currentLang = localStorage.getItem("ss_language") || "vi";

function initLanguage() {
  applyLanguage(currentLang);
}

function toggleLanguage() {
  currentLang = currentLang === "vi" ? "en" : "vi";
  localStorage.setItem("ss_language", currentLang);
  applyLanguage(currentLang);
  showToast(
    currentLang === "vi" ? "Đã chuyển sang Tiếng Việt" : "Switched to English",
    "success",
    '<i class="fa-solid fa-language"></i>',
  );
}

//
//
function applyLanguage(lang) {
  // 1. Dịch nội dung chữ (giữ nguyên)
  document.querySelectorAll("[data-lang]").forEach((el) => {
    const key = el.getAttribute("data-lang");
    if (translations[lang] && translations[lang][key]) {
      el.innerHTML = translations[lang][key];
    }
  });

  // 2. Dịch Placeholder (giữ nguyên)
  document.querySelectorAll("[data-lang-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-lang-placeholder");
    if (translations[lang][key]) {
      el.placeholder = translations[lang][key];
    }
  });

  // 3. CẬP NHẬT NÚT ĐỔI NGÔN NGỮ (SỬA LẠI PHẦN NÀY)
  const btn = document.getElementById("btnLangToggle");
  if (btn) {
    if (lang === "vi") {
      // Tiếng Việt: Dùng icon Quả địa cầu (hoặc fa-earth-asia nếu thích)
      btn.innerHTML = 'TIẾNG VIỆT <i class="fa-solid fa-earth-asia"></i>';
    } else {
      // Tiếng Anh: Dùng icon Ngôn ngữ (hoặc fa-earth-americas)
      btn.innerHTML = 'ENGLISH <i class="fa-solid fa-earth-americas"></i>';
    }
  }

  // Cập nhật lại UI chất lượng âm thanh (giữ nguyên)
  updateQualityUI();
}
// === LOGIC CHẤT LƯỢNG ÂM THANH ===

// 1. Lấy cài đặt cũ (Mặc định là 'high')
let currentQuality = localStorage.getItem("ss_stream_quality") || "high";

// 2. Hàm khởi chạy (Gọi khi load web)
function initStreamQuality() {
  updateQualityUI();
}

// 3. Hàm chuyển đổi (Gắn vào nút bấm)
function toggleStreamQuality() {
  // Đổi trạng thái: high -> standard -> high
  currentQuality = currentQuality === "high" ? "standard" : "high";

  // Lưu vào bộ nhớ
  localStorage.setItem("ss_stream_quality", currentQuality);

  // Cập nhật giao diện
  updateQualityUI();

  // Thông báo cho người dùng
  const msg =
    currentQuality === "high"
      ? "Đã chuyển sang Chất lượng cao (320kbps)"
      : "Đã chuyển sang Tiết kiệm dữ liệu (128kbps)";

  showToast(msg, "success", '<i class="fa-solid fa-sliders"></i>');
}

// 4. Hàm cập nhật giao diện nút bấm
function updateQualityUI() {
  const btn = document.getElementById("btnStreamQuality");
  if (!btn) return;
  if (!translations || !translations[currentLang]) return;
  // Lấy ngôn ngữ hiện tại để hiển thị đúng text
  const lang = currentLang;

  if (currentQuality === "high") {
    btn.innerHTML =
      translations[currentLang]["st_qual_high"] || "High (320kbps)";
    btn.style.background = "var(--neon-secondary)";
    btn.style.color = "#000";
    btn.style.border = "none";
  } else {
    btn.innerHTML =
      translations[currentLang]["st_qual_std"] || "Standard (128kbps)";
    btn.style.background = "transparent";
    btn.style.color = "#ccc";
    btn.style.border = "1px solid #555";
  }
}
// === CÁCH 2: TỰ ĐỘNG TÍNH & LƯU CACHE (SMART LOAD) ===

function lazyLoadMetadata(currentIndex) {
  const songsToLoad = [currentIndex, (currentIndex + 1) % songs.length];

  songsToLoad.forEach((idx) => {
    const s = songs[idx];
    // Nếu chưa có thời lượng và chưa có trong cache
    if (!s.duration) {
      const tempAudio = new Audio();
      tempAudio.preload = "metadata";
      tempAudio.src = s.src;
      tempAudio.onloadedmetadata = () => {
        s.duration = formatTime(tempAudio.duration);
        const durElement = document.getElementById(`dur-${idx}`);
        if (durElement) durElement.innerText = s.duration;
        // Giải phóng bộ nhớ
        tempAudio.src = "";
        tempAudio.load();
      };
    }
  });
}

// Hàm phụ trợ: Tạo audio ẩn để lấy thông tin giây
function getAudioDuration(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.preload = "metadata";

    audio.onloadedmetadata = () => {
      resolve(formatTime(audio.duration));
    };

    // Nếu file lỗi hoặc mạng chậm quá, trả về --:-- để không bị kẹt
    audio.onerror = () => {
      resolve("--:--");
    };
  });
}
function renderSkeleton() {
  const skeletonHTML = Array(8)
    .fill('<div class="skeleton-item"></div>')
    .join("");
  el.list.innerHTML = skeletonHTML;
}
// === LOGIC MODAL THÔNG TIN (CHÍNH SÁCH, ĐIỀU KHOẢN...) ===

const infoData = {
  privacy: {
    title: "Chính sách bảo mật",
    content: `
                  <p><strong>1. Thu thập dữ liệu:</strong><br>SoundSphere là một dự án cá nhân phục vụ mục đích học tập. Chúng tôi không thu thập bất kỳ dữ liệu cá nhân nào của người dùng trên máy chủ.</p>
                  <br>
                  <p><strong>2. Lưu trữ cục bộ (Local Storage):</strong><br>Chúng tôi chỉ lưu trữ các cài đặt của bạn (như ngôn ngữ, bài hát yêu thích, chế độ lặp lại) ngay trên trình duyệt của bạn để mang lại trải nghiệm tốt hơn.</p>
                  <br>
                  <p><strong>3. Bản quyền âm nhạc:</strong><br>Các bài hát trên nền tảng này được sử dụng cho mục đích demo. Nếu có vấn đề về bản quyền, vui lòng liên hệ qua mục "Báo cáo vi phạm".</p>
                  <br>
                  <p><strong>4. Liên hệ:</strong><br>Mọi thắc mắc xin vui lòng gửi về email hỗ trợ trong phần Cài đặt.</p>
              `,
  },
  terms: {
    title: "Điều khoản sử dụng",
    content: `
                  <p>Chào mừng bạn đến với SoundSphere. Khi sử dụng website này, bạn đồng ý rằng:</p>
                  <ul style="margin-left: 20px; margin-top: 10px;">
                      <li>Không sử dụng website vào mục đích thương mại trái phép.</li>
                      <li>Tôn trọng cộng đồng và không spam.</li>
                      <li>SoundSphere có quyền thay đổi tính năng mà không báo trước.</li>
                  </ul>
              `,
  },
  about: {
    title: "Về SoundSphere",
    content: `
                  <p><strong>SoundSphere v1.0</strong></p>
                  <p>Được phát triển với niềm đam mê âm nhạc và công nghệ.</p>
                  <p>Giao diện được thiết kế theo phong cách Neon/Glassmorphism hiện đại.</p>
                  <br>
                  <p>© 2024 SoundSphere Project. All rights reserved.</p>
              `,
  },
};

function openInfoModal(type) {
  const modal = document.getElementById("infoModal");
  const title = document.getElementById("infoTitle");
  const content = document.getElementById("infoContent");

  // Sử dụng biến policyData được lấy từ file data/policies.js
  if (typeof policyData !== "undefined" && policyData[type]) {
    title.innerText = policyData[type].title;
    content.innerHTML = policyData[type].content;
    modal.classList.add("active");
  } else {
    console.error("Không tìm thấy dữ liệu policyData!");
  }
}

function closeInfoModal() {
  document.getElementById("infoModal").classList.remove("active");
}
// === LOGIC KÉO THẢ FULL SCREEN PLAYER ===

const fsProgressBar = document.getElementById("fsProgressBar");
let isFsDragging = false;

// 1. Sự kiện khi bắt đầu kéo -> Ngừng cập nhật tự động
fsProgressBar.addEventListener("mousedown", () => (isFsDragging = true));
fsProgressBar.addEventListener("touchstart", () => (isFsDragging = true));

// 2. Sự kiện khi đang kéo -> Cập nhật giao diện (số giây + thanh màu)
fsProgressBar.addEventListener("input", () => {
  const val = fsProgressBar.value;
  const max = audio.duration || 1;
  const pct = (val / max) * 100;

  // Cập nhật thanh màu
  document.getElementById("fsProgressFill").style.width = `${pct}%`;
  // Cập nhật số giây
  document.getElementById("fsCurrentTime").innerText = formatTime(val);
});

// 3. Sự kiện khi thả tay ra -> Tua nhạc
fsProgressBar.addEventListener("change", () => {
  isFsDragging = false;
  audio.currentTime = fsProgressBar.value;
  if (!state.isPlaying) togglePlay(); // Nếu đang pause thì phát luôn
});

// 4. CẬP NHẬT LẠI LOGIC TIMEUPDATE CŨ
// (Tìm đoạn audio.addEventListener("timeupdate"...) cũ của FS và sửa lại như sau)

audio.addEventListener("timeupdate", () => {
  // Cập nhật cho Footer Player (Code cũ)
  if (!isDragging && el.progressBar) {
    // ... logic cũ của footer ...
  }

  // Cập nhật cho Full Screen Player (MỚI)
  if (
    document.getElementById("fullScreenPlayer").classList.contains("active")
  ) {
    const curr = audio.currentTime;
    const dur = audio.duration || 1;

    // Chỉ cập nhật nếu người dùng KHÔNG đang kéo
    if (!isFsDragging) {
      fsProgressBar.max = dur; // Cập nhật max liên tục đề phòng lỗi load
      fsProgressBar.value = curr;

      const pct = (curr / dur) * 100;
      document.getElementById("fsProgressFill").style.width = `${pct}%`;
      document.getElementById("fsCurrentTime").innerText = formatTime(curr);
    }
  }
});

// Cập nhật Max khi bài hát tải xong
audio.addEventListener("loadedmetadata", () => {
  if (fsProgressBar) fsProgressBar.max = audio.duration;
});
// ==================== FULL SCREEN BROWSER LOGIC ====================

// ==================== FULL SCREEN LOGIC (IOS FIX) ====================

function toggleAppFullScreen() {
  // 1. Kiểm tra xem có phải là iPhone/iPad không
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // 2. Kiểm tra xem Web đã được thêm vào màn hình chính chưa (Standalone Mode)
  const isStandalone =
    window.navigator.standalone ||
    window.matchMedia("(display-mode: standalone)").matches;

  // --- XỬ LÝ RIÊNG CHO IPHONE (IOS) ---
  if (isIOS) {
    if (isStandalone) {
      // Nếu đã là App rồi thì không cần bấm nữa
      showToast(
        "Bạn đang ở chế độ toàn màn hình!",
        "success",
        '<i class="fa-brands fa-apple"></i>',
      );
    } else {
      // Nếu đang chạy trên Safari -> Hiện hướng dẫn
      // (Tăng thời gian hiển thị lên 5 giây để kịp đọc)
      showToast(
        "iPhone: Bấm nút <b>Chia sẻ</b> <i class='fa-solid fa-arrow-up-from-bracket'></i> chọn <b>'Thêm vào MH chính'</b>",
        "info",
        '<i class="fa-brands fa-apple"></i>',
      );

      // Tự động cuộn trang xuống 1 chút để thanh địa chỉ thu nhỏ lại (Mẹo nhỏ)
      window.scrollTo(0, 1);
    }
    return; // Dừng lệnh, không chạy code Android bên dưới
  }

  // --- XỬ LÝ CHO ANDROID & PC (GIỮ NGUYÊN) ---
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    }
    showToast(
      "Đã vào chế độ toàn màn hình",
      "success",
      '<i class="fa-solid fa-expand"></i>',
    );
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    showToast(
      "Đã thoát toàn màn hình",
      "info",
      '<i class="fa-solid fa-compress"></i>',
    );
  }
}

// Lắng nghe sự kiện thay đổi để đổi icon (Expand <-> Compress)
document.addEventListener("fullscreenchange", updateFullScreenIcon);
document.addEventListener("webkitfullscreenchange", updateFullScreenIcon);

function updateFullScreenIcon() {
  // Danh sách các icon cần đổi (Trong Cài đặt + Trong Sidebar)
  const icons = [
    document.getElementById("iconFullScreen"),
    document.getElementById("sidebarFsIcon"),
  ];

  const isFull = document.fullscreenElement || document.webkitFullscreenElement;

  icons.forEach((icon) => {
    if (!icon) return;

    if (isFull) {
      // Đang Full -> Hiện icon thu nhỏ
      icon.className = "fa-solid fa-compress";

      // Nếu là nút trong Sidebar thì đổi chữ luôn cho xịn
      if (icon.id === "sidebarFsIcon") {
        icon.nextElementSibling.innerText = "Thoát toàn màn hình";
      }
    } else {
      // Đang thường -> Hiện icon phóng to
      icon.className = "fa-solid fa-expand";

      if (icon.id === "sidebarFsIcon") {
        icon.nextElementSibling.innerText = "Toàn màn hình";
      }
    }
  });
  // ==================== ANTI-ZOOM LOGIC (IOS FIX) ====================

  // 1. Chặn hành động chụm ngón tay (Pinch to Zoom) trên iOS
  document.addEventListener("gesturestart", function (e) {
    e.preventDefault();
  });

  // 2. Chặn Zoom khi chạm 2 lần liên tiếp (Double Tap Zoom)
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    function (event) {
      const now = new Date().getTime();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    false,
  );

  // 3. Chặn Zoom bằng Ctrl + Lăn chuột (trên PC/Laptop có cảm ứng)
  document.addEventListener("keydown", function (event) {
    if (
      event.ctrlKey &&
      (event.key === "+" || event.key === "-" || event.key === "0")
    ) {
      event.preventDefault();
    }
  });
  document.addEventListener(
    "wheel",
    function (event) {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    },
    { passive: false },
  );
}
/* ==========================================
   PHẦN 1: XỬ LÝ ĐĂNG NHẬP GOOGLE
   ========================================== */

function loginGoogle() {
  if (!window.signInWithPopup) {
    alert("Lỗi: Chưa kết nối Firebase! Kiểm tra lại code Config.");
    return;
  }

  const provider = new window.provider.constructor();

  window
    .signInWithPopup(window.auth, provider)
    .then((result) => {
      console.log("Đăng nhập thành công:", result.user.displayName);
      const user = result.user;

      // --- BẮT ĐẦU: CODE ÉP BUỘC CẬP NHẬT GIAO DIỆN ---

      // 1. Tắt bảng Modal (Tìm theo ID authOverlay)
      const modal = document.getElementById("authOverlay");
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none"; // Ẩn luôn cho chắc
      }

      // 2. Đổi nút Tài khoản thành Avatar ngay lập tức
      const navAccount = document.getElementById("navAccount");
      if (navAccount) {
        navAccount.innerHTML = `
            <img src="${user.photoURL}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; margin-right: 8px; border: 2px solid #00ff00;">
            <span style="font-weight: bold; color: white; max-width: 100px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${user.displayName}</span>
         `;
        // Gắn lại sự kiện đăng xuất

        navAccount.onclick = openLogoutModal;
      }

      // 3. Tải danh sách yêu thích
      loadUserFavorites(user.uid);

      // --- KẾT THÚC ---
    })
    .catch((error) => {
      console.error("Lỗi:", error);
      alert("Đăng nhập thất bại: " + error.message);
    });
}

function logoutGoogle() {
  window.auth.signOut().then(() => {
    location.reload();
  });
}

/* ==========================================
   PHẦN 2: TỰ ĐỘNG CẬP NHẬT GIAO DIỆN (BẢN FIX GHOST LOGIN)
   ========================================== */

// Hàm cập nhật UI khi trạng thái thay đổi
function handleAuthChange(user) {
  const loginModal = document.getElementById("authOverlay");
  const navAccount = document.getElementById("navAccount");

  if (user) {
    // ---> ĐÃ ĐĂNG NHẬP
    console.log("=> User đang online:", user.displayName);

    // 1. Tắt bảng đăng nhập nếu đang mở
    if (loginModal) {
      loginModal.classList.remove("active");
      loginModal.style.display = "none";
    }

    // 2. Đổi nút Tài khoản thành Avatar
    if (navAccount) {
      navAccount.innerHTML = `
                <img src="${user.photoURL}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; margin-right: 8px; border: 2px solid var(--neon-primary);">
                <span style="font-weight: bold; color: white; max-width: 100px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${user.displayName}</span>
            `;
      navAccount.onclick = openLogoutModal; // Gắn hàm mở popup đăng xuất
    }

    // 3. Tải danh sách yêu thích ngay
    loadUserFavorites(user.uid);
  } else {
    // ---> CHƯA ĐĂNG NHẬP
    console.log("=> Chưa đăng nhập (Khách)");

    // Reset về nút Tài khoản thường
    if (navAccount) {
      navAccount.innerHTML = `
                <i class="fa-solid fa-user"></i>
                <span data-lang="sb_account">Tài khoản</span>
            `;
      navAccount.onclick = openAuthModal; // Gắn hàm mở popup đăng nhập
    }

    // Xóa danh sách yêu thích tạm
    currentFavorites = [];
    updateHeartUI();
  }
}

// Kích hoạt lắng nghe (Thử liên tục cho đến khi tìm thấy Firebase)
const authInterval = setInterval(() => {
  if (window.auth && window.onAuthStateChanged) {
    clearInterval(authInterval); // Đã tìm thấy, dừng kiểm tra
    console.log("✅ Đã kết nối Listener theo dõi đăng nhập!");

    window.onAuthStateChanged(window.auth, (user) => {
      handleAuthChange(user);
    });
  }
}, 500); // Kiểm tra mỗi 0.5 giây

/* ==========================================
   PHẦN 3: XỬ LÝ TIM (YÊU THÍCH)
   ========================================== */

// 4. Hàm xử lý chính (Phiên bản Siêu tốc - Optimistic UI + Chống Spam)
function toggleFavorite(songId) {
  const user = window.auth.currentUser;

  // 1. Kiểm tra đăng nhập
  if (!user) {
    showToast(
      "Vui lòng đăng nhập để lưu bài hát!",
      "info",
      '<i class="fa-solid fa-lock"></i>',
    );
    openAuthModal();
    return;
  }

  // 2. CHỐNG SPAM: Nếu bài này đang được xử lý thì chặn ngay
  if (processingSongs.has(songId)) {
    console.log("⏳ Đang xử lý, vui lòng không bấm liên tục...");
    return;
  }

  // Khóa bài hát này lại (Bắt đầu xử lý)
  processingSongs.add(songId);

  // Lấy thông tin bài hát để hiện thông báo đẹp
  const song = songs.find((s) => s.id === songId);
  const songTitle = song ? song.title : "Bài hát";
  const userRef = window.doc(window.db, "users", user.uid);

  // 3. XỬ LÝ "LẠC QUAN" (Cập nhật giao diện NGAY LẬP TỨC)
  // Tính toán trước trạng thái tương lai
  const isCurrentlyLiked = currentFavorites.includes(songId);
  const willBeLiked = !isCurrentlyLiked; // Đang thích -> thành bỏ, và ngược lại

  // --- CẬP NHẬT GIAO DIỆN NGAY (Không chờ Firebase) ---
  if (willBeLiked) {
    // Giả lập thêm vào mảng
    currentFavorites.push(songId);
    // Hiện tim đỏ ngay
    syncAllHeartButtons(songId, true);
    // Hiện thông báo ngay
    showToast(
      `Đã thêm “${songTitle}” vào yêu thích`,
      "success",
      '<i class="fa-solid fa-heart"></i>',
    );
  } else {
    // Giả lập xóa khỏi mảng
    currentFavorites = currentFavorites.filter((id) => id !== songId);
    // Hiện tim rỗng ngay
    syncAllHeartButtons(songId, false);
    // Hiện thông báo ngay
    showToast(
      `Đã bỏ thích “${songTitle}”`,
      "off",
      '<i class="fa-regular fa-heart"></i>',
    );
  }

  // 4. GỬI LÊN FIREBASE (Làm ngầm bên dưới)
  let updatePromise;

  if (willBeLiked) {
    // Gửi lệnh Thêm
    updatePromise = window.setDoc(
      userRef,
      {
        email: user.email,
        favorites: window.arrayUnion(songId),
      },
      { merge: true },
    );
  } else {
    // Gửi lệnh Xóa
    updatePromise = window.updateDoc(userRef, {
      favorites: window.arrayRemove(songId),
    });
  }

  // 5. XỬ LÝ KẾT QUẢ TỪ SERVER
  updatePromise
    .then(() => {
      console.log("✅ Firebase đã đồng bộ xong!");
      // Mọi thứ đã đúng như dự tính, không cần làm gì thêm
    })
    .catch((error) => {
      console.error("❌ Lỗi Firebase:", error);

      // QUAN TRỌNG: NẾU LỖI -> PHẢI HOÀN TÁC (UNDO) LẠI GIAO DIỆN
      alert("Lỗi kết nối! Đang hoàn tác...");

      if (willBeLiked) {
        // Nãy lỡ thêm, giờ xóa đi
        currentFavorites = currentFavorites.filter((id) => id !== songId);
        syncAllHeartButtons(songId, false);
      } else {
        // Nãy lỡ xóa, giờ thêm lại
        currentFavorites.push(songId);
        syncAllHeartButtons(songId, true);
      }
    })
    .finally(() => {
      // 6. MỞ KHÓA (Cho phép bấm lại bài này sau khi xong việc)
      processingSongs.delete(songId);
    });
}
// --- HÀM PHỤ TRỢ: ĐỒNG BỘ TẤT CẢ NÚT TIM ---
function syncAllHeartButtons(songId, isLiked) {
  // A. Đồng bộ các nút tim nhỏ trong danh sách (List)
  const listBtns = document.querySelectorAll(`.heart-btn[data-id="${songId}"]`);
  listBtns.forEach((btn) => {
    if (isLiked) {
      btn.classList.add("liked"); // <--- SỬA THÀNH liked
      const icon = btn.querySelector("i");
      if (icon) icon.className = "fa-solid fa-heart";
    } else {
      btn.classList.remove("liked"); // <--- SỬA THÀNH liked
      const icon = btn.querySelector("i");
      if (icon) icon.className = "fa-regular fa-heart";
    }
  });

  // B. Đồng bộ nút tim to (Footer & Main)
  // QUAN TRỌNG: Chỉ tô màu nếu bài vừa like ĐANG LÀ BÀI ĐANG PHÁT
  const currentSong = songs[state.currentSongIndex];
  if (currentSong && currentSong.id === songId) {
    updateLikeStatusUI(songId, isLiked);
  }

  // C. Nếu đang ở trang "Yêu thích" mà bỏ tim -> Load lại danh sách để bài đó biến mất
  const playlistTitle = document.getElementById("playlistTitle");
  if (
    playlistTitle &&
    playlistTitle.innerText.includes("Bài hát yêu thích") &&
    !isLiked
  ) {
    updateFavoriteList();
  }
}

/* ======================================================
   PHẦN BỔ SUNG: TẢI DỮ LIỆU TỪ FIREBASE (BỊ THIẾU)
   ====================================================== */

// 1. Hàm tải danh sách yêu thích từ Firebase về máy
async function loadUserFavorites(userId) {
  try {
    const docRef = window.doc(window.db, "users", userId);
    const docSnap = await window.getDoc(docRef);

    if (docSnap.exists()) {
      currentFavorites = docSnap.data().favorites || [];
      console.log("-> Đã tải danh sách yêu thích:", currentFavorites);

      // Tải xong thì tô màu trái tim ngay
      updateHeartUI();

      // Nếu đang ở trang Yêu thích thì vẽ lại danh sách luôn
      if (
        document
          .getElementById("playlistTitle")
          ?.innerText.includes("Bài hát yêu thích")
      ) {
        updateFavoriteList();
      }
    } else {
      console.log("-> User mới, chưa có dữ liệu yêu thích.");
      currentFavorites = [];
    }
  } catch (error) {
    console.error("Lỗi tải favorites:", error);
  }
}

// 2. Hàm tô màu các nút tim dựa trên danh sách đã tải
function updateHeartUI() {
  // Tìm tất cả nút tim trên màn hình
  const allHearts = document.querySelectorAll(".heart-btn");

  allHearts.forEach((btn) => {
    // Lấy ID bài hát từ nút đó
    const id = parseInt(btn.getAttribute("data-id"));

    // Nếu ID này có trong danh sách yêu thích -> Tô đỏ (active)
    if (currentFavorites.includes(id)) {
      btn.classList.add("liked");
      const icon = btn.querySelector("i");
      if (icon) icon.className = "fa-solid fa-heart";
    } else {
      // Nếu không -> Bỏ tô đỏ
      btn.classList.remove("liked");
      const icon = btn.querySelector("i");
      if (icon) icon.className = "fa-regular fa-heart";
    }
  });
}
// ==================== BANNER SLIDER LOGIC ====================
let slideIndex = 0;
const slides = document.querySelectorAll(".banner-item");
const dotsContainer = document.getElementById("bannerDots");
let slideInterval;

function initBanner() {
  if (slides.length === 0) return;

  // Tạo dots
  slides.forEach((_, idx) => {
    const dot = document.createElement("div");
    dot.classList.add("dot");
    if (idx === 0) dot.classList.add("active");
    dot.onclick = () => goToSlide(idx);
    dotsContainer.appendChild(dot);
  });

  // Tự động chạy
  startSlideTimer();
}

function goToSlide(n) {
  slideIndex = n;
  const wrapper = document.getElementById("bannerWrapper");
  const dots = document.querySelectorAll(".dot");

  // Di chuyển banner
  wrapper.style.transform = `translateX(-${slideIndex * 100}%)`;

  // Cập nhật dots
  dots.forEach((d) => d.classList.remove("active"));
  if (dots[slideIndex]) dots[slideIndex].classList.add("active");

  // Reset timer khi người dùng bấm thủ công
  resetSlideTimer();
}

function nextSlide() {
  slideIndex = (slideIndex + 1) % slides.length;
  goToSlide(slideIndex);
}

function startSlideTimer() {
  slideInterval = setInterval(nextSlide, 4000); // 4 giây chuyển 1 lần
}

function resetSlideTimer() {
  clearInterval(slideInterval);
  startSlideTimer();
}

// Gọi hàm khởi tạo
document.addEventListener("DOMContentLoaded", () => {
  initBanner();
});
// ==================== 3D INFINITY CAROUSEL LOGIC (UPDATED) ====================

let carouselIndex = 0;
const carouselItems = document.querySelectorAll(".chart-3d-item");
let carouselInterval;
let startX = 0;
let endX = 0;
let isCarouselDragging = false;

// CẤU HÌNH THỜI GIAN
const CAROUSEL_AUTO_TIME = 8000; // 8 Giây (Dài hơn theo yêu cầu)

function init3DCarousel() {
  if (carouselItems.length === 0) return;

  // 1. Khởi tạo vị trí ban đầu
  updateCarouselPositions();

  // 2. Bắt đầu tự chạy
  startCarouselTimer();

  const track = document.querySelector(".charts-3d-container");

  // --- HỖ TRỢ CẢM ỨNG (MOBILE) ---
  track.addEventListener(
    "touchstart",
    (e) => {
      startX = e.changedTouches[0].screenX;
      stopCarouselTimer(); // Dừng auto khi chạm vào
    },
    { passive: true },
  );

  track.addEventListener(
    "touchend",
    (e) => {
      endX = e.changedTouches[0].screenX;
      handleCarouselSwipe();
      startCarouselTimer(); // Chạy lại sau khi thả tay
    },
    { passive: true },
  );

  // --- HỖ TRỢ KÉO CHUỘT (PC) ---
  track.addEventListener("mousedown", (e) => {
    isCarouselDragging = true;
    startX = e.clientX;
    track.style.cursor = "grabbing"; // Đổi con trỏ chuột
    stopCarouselTimer();
    e.preventDefault(); // Ngăn bôi đen văn bản khi kéo
  });

  track.addEventListener("mouseup", (e) => {
    if (!isCarouselDragging) return; // Đổi ở đây
    isCarouselDragging = false; // Đổi ở đây
    endX = e.clientX;
    track.style.cursor = "grab";
    handleCarouselSwipe();
    startCarouselTimer();
  });

  track.addEventListener("mouseleave", () => {
    if (isCarouselDragging) {
      isCarouselDragging = false;
      track.style.cursor = "grab";
      startCarouselTimer();
    }
  });
}

function updateCarouselPositions() {
  // Xóa hết class cũ
  carouselItems.forEach((item) => {
    item.classList.remove("active", "prev", "next");
    item.style.zIndex = "0"; // Reset z-index
    item.style.pointerEvents = "none"; // Khóa bấm các thẻ chìm
  });

  // 1. Xác định Active (Ở giữa)
  const activeItem = carouselItems[carouselIndex];
  activeItem.classList.add("active");
  activeItem.style.zIndex = "10";
  activeItem.style.pointerEvents = "auto"; // Cho phép bấm thẻ nổi

  // 2. Xác định Prev (Bên trái) - Logic vòng tròn
  const prevIndex =
    (carouselIndex - 1 + carouselItems.length) % carouselItems.length;
  const prevItem = carouselItems[prevIndex];
  prevItem.classList.add("prev");
  prevItem.style.zIndex = "5";

  // 3. Xác định Next (Bên phải) - Logic vòng tròn
  const nextIndex = (carouselIndex + 1) % carouselItems.length;
  const nextItem = carouselItems[nextIndex];
  nextItem.classList.add("next");
  nextItem.style.zIndex = "5";
}

function nextCarouselSlide() {
  carouselIndex = (carouselIndex + 1) % carouselItems.length;
  updateCarouselPositions();
}

function prevCarouselSlide() {
  carouselIndex =
    (carouselIndex - 1 + carouselItems.length) % carouselItems.length;
  updateCarouselPositions();
}

function startCarouselTimer() {
  stopCarouselTimer();
  carouselInterval = setInterval(nextCarouselSlide, CAROUSEL_AUTO_TIME);
}

function stopCarouselTimer() {
  clearInterval(carouselInterval);
}

function handleCarouselSwipe() {
  const threshold = 30; // Độ nhạy: Kéo 30px là đổi bài
  if (startX - endX > threshold) {
    // Kéo sang trái -> Next
    nextCarouselSlide();
  } else if (endX - startX > threshold) {
    // Kéo sang phải -> Prev
    prevCarouselSlide();
  }
}

// Gọi hàm khởi tạo
document.addEventListener("DOMContentLoaded", () => {
  init3DCarousel();
});
function handleSearch(keyword) {
  const uni = document.querySelector(".universe-panel");
  const playlistTitle = document.getElementById("playlistTitle");

  // 1. Nếu đang ở trang Settings thì chuyển về trang chính để thấy kết quả
  const set = document.getElementById("settingsPanel");
  if (set && set.style.display !== "none") {
    showMainPlaylist();
  }

  // 2. Nếu ô tìm kiếm trống, hiện lại danh sách gốc
  if (!keyword) {
    songs = [...defaultSongList]; // Khôi phục danh sách đầy đủ
    if (playlistTitle) playlistTitle.innerText = "Dải Ngân Hà";
    renderList();
    return;
  }

  // 3. Chuyển từ khóa sang chữ thường để tìm kiếm không phân biệt hoa thường
  const lowerKey = keyword.toLowerCase();

  // 4. Lọc bài hát từ danh sách gốc (defaultSongList)
  const filtered = defaultSongList.filter(
    (s) =>
      s.title.toLowerCase().includes(lowerKey) ||
      s.artist.toLowerCase().includes(lowerKey),
  );

  // 5. Cập nhật mảng songs hiện tại và vẽ lại giao diện
  songs = filtered;
  if (state.currentSong) {
    const newIdx = songs.findIndex((s) => s.id === state.currentSong.id);
    if (newIdx !== -1) {
      state.currentSongIndex = newIdx;
    }
  }
  if (playlistTitle) {
    playlistTitle.innerText = `Kết quả cho: "${keyword}"`;
  }

  // Nếu không tìm thấy bài nào
  if (filtered.length === 0) {
    el.list.innerHTML = `
      <div style="text-align:center; padding:50px; color:var(--text-dim);">
        <i class="fa-solid fa-magnifying-glass" style="font-size:40px; margin-bottom:15px; opacity:0.2;"></i>
        <p>Không tìm thấy bài hát nào phù hợp</p>
      </div>`;
  } else {
    renderList();
  }
}

// Hàm lấy 10 bài ngẫu nhiên không trùng lặp từ thư viện tổng
function getRandomSongsForExplore() {
  if (typeof defaultSongList === "undefined") return []; // Phòng hờ lỗi nạp file
  let allMusic = [...defaultSongList];
  // Trộn mảng
  for (let i = allMusic.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allMusic[i], allMusic[j]] = [allMusic[j], allMusic[i]];
  }
  return allMusic.slice(0, 10); // Lấy đúng 10 bài
}

const navLib = document.getElementById("navLibrary");
if (navLib) {
  navLib.onclick = showLibraryPlaylist;
}
setInterval(() => {
  const playlistTitle = document.getElementById("playlistTitle");
  // Chỉ tự động đổi bài nếu người dùng ĐANG ở mục Khám phá
  if (playlistTitle && playlistTitle.innerText === "Dải Ngân Hà (Gợi ý)") {
    console.log("🔄 30s đã trôi qua: Đang làm mới danh sách gợi ý...");
    songs = getRandomSongsForExplore();
    renderList();

    showToast(
      "Đã cập nhật gợi ý mới!",
      "info",
      '<i class="fa-solid fa-rotate"></i>',
    );
  }
}, 30000); // 30000ms = 30 giây
/* ======================================================
   LOGIC LỊCH SỬ & GỢI Ý THÔNG MINH (NEW)
   ====================================================== */

// 1. Hàm thêm bài hát vào lịch sử (Gọi khi play nhạc)
// --- ĐẾM LƯỢT NGHE (Firestore) ---
// Chỉ tính 1 lượt nghe nếu người dùng thực sự nghe ít nhất 5 giây liên tục bài đó
// (tránh tính lượt khi bấm next/back qua loa, hoặc seek nhảy bài nhanh).
let playCountTimer = null;
function schedulePlayCountIncrement(song) {
  clearTimeout(playCountTimer);
  if (!song || !song.docId) return; // cần docId thật trong Firestore để update đúng document

  playCountTimer = setTimeout(() => {
    // Vẫn đang nghe đúng bài này và đang phát (không bị pause/next trong lúc chờ) thì mới tính
    if (state.currentSong && state.currentSong.docId === song.docId && state.isPlaying) {
      incrementPlayCountInFirestore(song.docId);
    }
  }, 5000);
}

function incrementPlayCountInFirestore(docId) {
  if (!window.db || !window.doc || !window.updateDoc || !window.increment) return;
  try {
    window.updateDoc(window.doc(window.db, "songs", docId), {
      playCount: window.increment(1),
    }).catch((e) => {
      // Không chặn trải nghiệm nghe nhạc nếu lỗi — chỉ log để debug
      console.warn("Không ghi được lượt nghe:", e.message);
    });
  } catch (e) {
    console.warn("Lỗi tăng lượt nghe:", e.message);
  }
}

function addToHistory(song) {
  if (!song) return;

  // Lấy lịch sử cũ từ bộ nhớ
  let history = JSON.parse(localStorage.getItem("ss_play_history") || "[]");

  // Xóa bài này nếu đã tồn tại (để đưa lên đầu)
  history = history.filter((item) => item.id !== song.id);

  // Thêm vào đầu danh sách
  history.unshift({
    id: song.id,
    title: song.title,
    artist: song.artist,
    cover: song.cover,
    genre: song.genre || "Pop", // Nếu data chưa có genre thì mặc định là Pop
    timestamp: Date.now(),
  });

  // Giới hạn chỉ lưu 20 bài gần nhất
  if (history.length > 20) history.pop();

  // Lưu lại
  localStorage.setItem("ss_play_history", JSON.stringify(history));

  // Cập nhật thống kê sở thích ngay lập tức
  analyzeUserTaste(history);
}

// 2. Hàm phân tích sở thích (Tìm thể loại hay nghe nhất)
function analyzeUserTaste(history) {
  if (!history.length) return null;

  const genreCounts = {};
  history.forEach((song) => {
    const g = song.genre || "Pop";
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  });

  // Tìm thể loại có lượt nghe cao nhất
  let topGenre = Object.keys(genreCounts).reduce((a, b) =>
    genreCounts[a] > genreCounts[b] ? a : b,
  );

  localStorage.setItem("ss_top_genre", topGenre);
  return topGenre;
}

// 3. Hàm lấy danh sách gợi ý dựa trên sở thích
function getRecommendations() {
  const topGenre = localStorage.getItem("ss_top_genre") || "Pop";
  const history = JSON.parse(localStorage.getItem("ss_play_history") || "[]");
  const historyIds = history.map((h) => h.id);

  // Lọc ra các bài cùng thể loại NHƯNG chưa nghe gần đây
  let suggestions = defaultSongList.filter(
    (s) =>
      (s.genre === topGenre || !s.genre) && // Cùng thể loại
      !historyIds.includes(s.id), // Chưa nằm trong lịch sử
  );

  // Nếu ít gợi ý quá thì lấy random bù vào
  if (suggestions.length < 5) {
    const others = defaultSongList.filter((s) => !historyIds.includes(s.id));
    suggestions = [...suggestions, ...others].slice(0, 10);
  }

  return { genre: topGenre, list: suggestions };
}

/* ======================================================
   TÍNH NĂNG MỞ RỘNG: SLEEP TIMER & POMODORO (CUSTOMIZABLE)
   ====================================================== */

/* ======================================================
   TÍNH NĂNG: SLEEP TIMER (FINAL FIXED)
   ====================================================== */

let sleepTimerID = null;
let sleepUIInterval = null;
let sleepEndTime = null;

// Biến lưu tạm giá trị đang chọn
let selectedHours = 0;
let selectedMinutes = 0;

// 1. Mở Modal
function toggleSleepTimerModal() {
  const modal = document.getElementById("sleepTimerOverlay");
  if (modal) modal.classList.add("active");

  // Kiểm tra xem đang chạy hay đang tắt để hiện giao diện phù hợp
  if (sleepTimerID) {
    switchSleepMode("running");
    updateSleepRunningUI();
  } else {
    switchSleepMode("selection");
    // Reset về 0 mỗi khi mở lại để chọn mới
    selectedHours = 0;
    selectedMinutes = 0;
    updatePickerUI();
  }
}

// 2. Đóng Modal
function closeSleepTimerModal() {
  document.getElementById("sleepTimerOverlay").classList.remove("active");
}

// 3. Chọn nhanh (Presets)
function setQuickTime(mins) {
  selectedHours = Math.floor(mins / 60);
  selectedMinutes = mins % 60;
  updatePickerUI();
}

// 4. Tăng giảm thủ công
function adjustTimer(type, amount) {
  if (type === "h") {
    selectedHours += amount;
    if (selectedHours < 0) selectedHours = 0;
    if (selectedHours > 23) selectedHours = 23;
  } else {
    selectedMinutes += amount;
    // Xử lý logic phút (55 -> 0, 0 -> 55)
    if (selectedMinutes >= 60) {
      selectedMinutes = 0;
      selectedHours++;
    } else if (selectedMinutes < 0) {
      selectedMinutes = 55;
      if (selectedHours > 0) selectedHours--;
    }
  }
  updatePickerUI();
}

// 5. Cập nhật giao diện chọn giờ (QUAN TRỌNG: Ẩn/Hiện nút xác nhận)
function updatePickerUI() {
  const elHours = document.getElementById("inputHours");
  const elMinutes = document.getElementById("inputMinutes");
  const btnConfirm = document.getElementById("btnConfirmTimer");
  const previewBox = document.getElementById("timerPreview");

  // Cập nhật số
  if (elHours)
    elHours.innerText =
      selectedHours < 10 ? "0" + selectedHours : selectedHours;
  if (elMinutes)
    elMinutes.innerText =
      selectedMinutes < 10 ? "0" + selectedMinutes : selectedMinutes;

  const totalMinutes = selectedHours * 60 + selectedMinutes;
  const t = translations[currentLang]; // Lấy ngôn ngữ

  // Nếu thời gian > 0 -> Hiện preview giờ tắt và nút Xác nhận
  if (totalMinutes > 0) {
    const now = new Date();
    const targetTime = new Date(now.getTime() + totalMinutes * 60000);
    let h = targetTime.getHours();
    let m = targetTime.getMinutes();
    h = h < 10 ? "0" + h : h;
    m = m < 10 ? "0" + m : m;

    previewBox.innerHTML = `
        <div style="font-size: 13px; color: #aaa;">${t.timer_preview_label}</div>
        <div class="preview-time" style="font-size: 28px; color: var(--neon-primary); font-weight:800; margin: 5px 0;">${h}:${m}</div>
        <div style="font-size: 12px; color: var(--neon-secondary);">
            (${t.timer_preview_in} ${selectedHours}h ${selectedMinutes}p)
        </div>
    `;
    previewBox.style.opacity = "1";

    // HIỆN NÚT XÁC NHẬN
    if (btnConfirm) btnConfirm.style.display = "block";
  } else {
    // Nếu thời gian = 0 -> Ẩn nút xác nhận
    previewBox.innerHTML = `<div style="font-size: 13px; color: #aaa;">${t.timer_preview_default}</div>`;
    previewBox.style.opacity = "0.5";

    // ẨN NÚT XÁC NHẬN
    if (btnConfirm) btnConfirm.style.display = "none";
  }
}

// 6. Bấm nút Xác nhận -> Bắt đầu đếm ngược
function confirmSleepTimer() {
  const totalMs = (selectedHours * 60 + selectedMinutes) * 60000;
  if (totalMs <= 0) return;

  sleepEndTime = Date.now() + totalMs;

  // Xóa timer cũ nếu có
  if (sleepTimerID) clearTimeout(sleepTimerID);
  if (sleepUIInterval) clearInterval(sleepUIInterval);

  // Set timeout tắt nhạc
  sleepTimerID = setTimeout(() => {
    if (state.isPlaying) {
      togglePlay(); // Tắt nhạc
      closeSleepTimerModal(); // Đóng modal
      showToast(
        "Đã tắt nhạc theo hẹn giờ!",
        "info",
        '<i class="fa-solid fa-moon"></i>',
      );
    }
    cancelSleepTimer(false); // Reset trạng thái
  }, totalMs);

  // Set interval cập nhật giao diện mỗi giây
  sleepUIInterval = setInterval(updateSleepRunningUI, 1000);

  // Chuyển giao diện
  switchSleepMode("running");
  updateSleepRunningUI();
  updateSleepTimerBtn(true); // Sáng đèn nút trên player

  showToast(
    `Đã hẹn giờ tắt sau ${selectedHours}h ${selectedMinutes}p`,
    "success",
  );
}

// 7. Hủy hẹn giờ
function cancelSleepTimer(showMsg = true) {
  if (sleepTimerID) clearTimeout(sleepTimerID);
  if (sleepUIInterval) clearInterval(sleepUIInterval);

  sleepTimerID = null;
  sleepUIInterval = null;
  sleepEndTime = null;
  selectedHours = 0;
  selectedMinutes = 0;

  updateSleepTimerBtn(false); // Tắt đèn nút player
  switchSleepMode("selection"); // Quay về màn chọn giờ
  updatePickerUI();

  if (showMsg) showToast("Đã hủy hẹn giờ tắt", "info");
}

// 8. Hàm chuyển đổi hiển thị giữa 2 vùng (Chọn giờ / Đang chạy)
function switchSleepMode(mode) {
  const selectionArea = document.getElementById("sleepSelectionArea");
  const runningArea = document.getElementById("sleepRunningArea");

  if (selectionArea && runningArea) {
    if (mode === "running") {
      selectionArea.style.display = "none";
      runningArea.style.display = "block";
    } else {
      selectionArea.style.display = "block";
      runningArea.style.display = "none";
    }
  }
}

// 9. Cập nhật số đếm ngược khi đang chạy
function updateSleepRunningUI() {
  const status = document.getElementById("sleepTimerStatus");
  if (!status || !sleepEndTime) return;

  const remainingMs = sleepEndTime - Date.now();
  const t = translations[currentLang];

  if (remainingMs <= 0) {
    status.innerHTML = `<span style="color:#aaa">${t.timer_status_closing}</span>`;
    return;
  }

  const endDate = new Date(sleepEndTime);
  let endH = endDate.getHours();
  let endM = endDate.getMinutes();
  endH = endH < 10 ? "0" + endH : endH;
  endM = endM < 10 ? "0" + endM : endM;

  const totalSeconds = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const countDownStr = `${h}:${m < 10 ? "0" + m : m}:${s < 10 ? "0" + s : s}`;

  status.innerHTML = `
        <div style="font-size: 13px; color: #ccc; margin-bottom: 8px;">${t.timer_status_off}</div>
        <div style="font-size: 56px; font-weight: 800; color: var(--neon-primary); font-family: 'Outfit', sans-serif; text-shadow: 0 0 20px rgba(0,229,255,0.4); line-height:1;">
            ${endH}:${endM}
        </div>
        <div style="font-size: 16px; color: white; margin-top: 15px; font-weight:600; padding: 8px 16px; background:rgba(255,255,255,0.1); border-radius:20px; display:inline-block;">
            <i class="fa-solid fa-hourglass-half" style="margin-right:5px"></i> ${countDownStr}
        </div>
    `;
}

// 10. Bật/tắt trạng thái Active cho nút trên thanh Player
function updateSleepTimerBtn(isActive) {
  const btn = document.getElementById("sleepTimerBtn");
  if (btn) btn.classList.toggle("active", isActive);
}

// --- 2. POMODORO TIMER (TÙY CHỈNH THỜI GIAN) ---
let pomoInterval = null;
let pomoDefaultTime = 25; // Mặc định 25 phút
let pomoTime = 25 * 60;
let isPomoRunning = false;

function togglePomodoroModal() {
  document.getElementById("pomodoroOverlay").classList.add("active");
}

function closePomodoroModal() {
  document.getElementById("pomodoroOverlay").classList.remove("active");
}

// Hàm cập nhật thời gian từ ô Input
function updatePomoTimeFromInput() {
  const input = document.getElementById("pomoCustomInput");
  let val = parseInt(input.value);

  if (!val || val <= 0) val = 25; // Fallback nếu nhập sai

  pomoDefaultTime = val;

  // Nếu đồng hồ đang KHÔNG chạy thì cập nhật hiển thị ngay
  if (!isPomoRunning) {
    pomoTime = pomoDefaultTime * 60;
    updatePomoDisplay();
  }
}

function togglePomodoro() {
  const btn = document.getElementById("pomoStartBtn");
  const input = document.getElementById("pomoCustomInput");
  const t = translations[currentLang]; // Lấy từ điển

  if (isPomoRunning) {
    // -> TẠM DỪNG
    clearInterval(pomoInterval);
    isPomoRunning = false;
    // Sửa chữ nút bấm và trạng thái
    btn.innerHTML = `<i class="fa-solid fa-play"></i> ${t.pomo_continue}`;
    btn.classList.remove("paused");
    document.getElementById("pomoStatus").innerText = t.pomo_paused;
    input.disabled = false;
  } else {
    // -> CHẠY
    isPomoRunning = true;
    // Sửa chữ nút bấm và trạng thái
    btn.innerHTML = `<i class="fa-solid fa-pause"></i> ${t.pomo_pause}`;
    btn.classList.add("paused");
    document.getElementById("pomoStatus").innerText = t.pomo_running;
    document.getElementById("pomodoroBtn").classList.add("active");

    input.disabled = true;

    pomoInterval = setInterval(() => {
      if (pomoTime > 0) {
        pomoTime--;
        updatePomoDisplay();
      } else {
        finishPomodoro();
      }
    }, 1000);
  }
}

function resetPomodoro() {
  clearInterval(pomoInterval);
  isPomoRunning = false;
  const t = translations[currentLang];

  // Reset về thời gian trong ô input
  const input = document.getElementById("pomoCustomInput");
  let val = parseInt(input.value) || 25;
  pomoTime = val * 60;

  updatePomoDisplay();

  const btn = document.getElementById("pomoStartBtn");
  // Reset về chữ "Bắt đầu" có data-lang để tự đổi khi chuyển ngôn ngữ
  btn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-lang="pomo_start">${t.pomo_start}</span>`;

  document.getElementById("pomoStatus").innerText = t.pomo_ready;

  document.getElementById("pomodoroBtn").classList.remove("active");
  input.disabled = false; // Mở khóa lại ô input
}

function finishPomodoro() {
  clearInterval(pomoInterval);
  isPomoRunning = false;
  const t = translations[currentLang];

  const bell = new Audio(
    "https://actions.google.com/sounds/v1/cartoon/cartoon_boing.ogg",
  );
  bell.volume = 0.5;
  bell.play().catch((e) => console.log("Audio error"));

  const autoPause = document.getElementById("pomoAutoPause").checked;
  if (autoPause && state.isPlaying) {
    togglePlay();
  }

  showToast(t.pomo_toast_done, "success");
  resetPomodoro();
  document.getElementById("pomoStatus").innerText = t.pomo_done;
}

function updatePomoDisplay() {
  const m = Math.floor(pomoTime / 60);
  const s = pomoTime % 60;
  const timeStr = `${m < 10 ? "0" + m : m}:${s < 10 ? "0" + s : s}`;

  document.getElementById("pomoDisplay").innerText = timeStr;

  if (isPomoRunning) {
    document.title = `${timeStr} - Tập trung`;
  } else {
    document.title = "SoundSphere - Final Fixed";
  }
}
/* ======================================================
   TÍNH NĂNG: KÉO THẢ (DRAG TO SCROLL) CHO PC
   ====================================================== */
/* ======================================================
   TÍNH NĂNG: KÉO THẢ SIÊU MƯỢT (SILKY SMOOTH PHYSICS)
   ====================================================== */
function enableDragScroll(container) {
  let isDown = false;
  let startX;
  let scrollLeft;
  let velX = 0; // Vận tốc
  let momentumID;
  let lastTime = 0;

  // Ngăn hình ảnh bị kéo đi khi đang vuốt
  container.querySelectorAll("img").forEach((img) => {
    img.addEventListener("dragstart", (e) => e.preventDefault());
  });

  container.addEventListener("mousedown", (e) => {
    isDown = true;
    container.classList.add("active");

    // Dừng quán tính cũ ngay lập tức
    cancelAnimationFrame(momentumID);

    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;

    // Reset vận tốc và thời gian
    velX = 0;
    lastTime = Date.now();
  });

  const stopDrag = () => {
    if (!isDown) return;
    isDown = false;
    container.classList.remove("active");
    beginMomentum();
  };

  container.addEventListener("mouseleave", stopDrag);
  container.addEventListener("mouseup", stopDrag);

  container.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    e.preventDefault();

    const now = Date.now();
    const dt = now - lastTime; // Thời gian giữa 2 lần di chuột
    lastTime = now;

    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 1.5; // Hệ số nhân tốc độ kéo (1.5 là vừa tay)

    const prevScrollLeft = container.scrollLeft;
    container.scrollLeft = scrollLeft - walk;

    // Tính vận tốc tức thời: Quãng đường / Thời gian
    // Giới hạn dt để tránh chia cho 0 hoặc số quá nhỏ
    if (dt > 0) {
      const newVel = (container.scrollLeft - prevScrollLeft) / dt;
      // Làm mượt vận tốc (Lấy trung bình với vận tốc cũ để tránh giật)
      velX = velX * 0.5 + newVel * 0.5;
    }
  });

  // Hàm tạo hiệu ứng trôi (Inertia)
  function beginMomentum() {
    // Nếu vận tốc quá nhỏ thì dừng luôn cho đỡ tốn tài nguyên
    if (Math.abs(velX) < 0.01) return;

    // Tăng cường vận tốc ban đầu một chút để trôi xa hơn
    let currentVel = velX * 16; // Nhân với xấp xỉ 1 frame (16ms)

    function loop() {
      // Cập nhật vị trí
      container.scrollLeft += currentVel;

      // Ma sát (Friction): Giảm dần vận tốc
      // 0.95 = Trôi mượt, lâu dừng
      // 0.90 = Dừng nhanh hơn
      currentVel *= 0.95;

      // Nếu vẫn còn trôi được thì lặp tiếp
      if (Math.abs(currentVel) > 0.5) {
        momentumID = requestAnimationFrame(loop);
      } else {
        // Dừng hẳn, bật lại Snap (nếu cần)
        container.classList.remove("active");
      }
    }

    // Bắt đầu vòng lặp
    momentumID = requestAnimationFrame(loop);
  }
}

// Thêm vào cuối file

// --- TÍNH NĂNG TỰ ĐỘNG DỌN DẸP LỊCH SỬ (AUTO CLEAN) ---
function autoCleanHistory() {
  // 1. Cấu hình thời gian hết hạn (15 ngày đổi ra mili-giây)
  const EXPIRY_DAYS = 15;
  const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  // 2. Lấy dữ liệu hiện tại
  const rawHistory = localStorage.getItem("ss_play_history");
  if (!rawHistory) return;

  try {
    const history = JSON.parse(rawHistory);
    const now = Date.now();

    // 3. Lọc: Chỉ giữ lại những bài mà (Hiện tại - Lúc nghe) < 15 ngày
    const freshHistory = history.filter((item) => {
      // Nếu dữ liệu cũ không có timestamp thì xóa luôn (hoặc giữ lại tùy bạn)
      if (!item.timestamp) return false;

      return now - item.timestamp < EXPIRY_MS;
    });

    // 4. Nếu có sự thay đổi (có bài bị xóa) -> Lưu lại danh sách mới
    if (freshHistory.length !== history.length) {
      localStorage.setItem("ss_play_history", JSON.stringify(freshHistory));
      console.log(
        `🧹 Đã tự động xóa ${
          history.length - freshHistory.length
        } bài hát quá hạn (hơn ${EXPIRY_DAYS} ngày).`,
      );
    }
  } catch (e) {
    console.error("Lỗi khi dọn dẹp lịch sử:", e);
    // Nếu dữ liệu lỗi, reset luôn cho sạch
    localStorage.removeItem("ss_play_history");
  }
}
// Thêm vào cuối file (Thay thế logic xóa cũ)

// 1. Mở Modal xác nhận
function openClearHistoryModal() {
  document.getElementById("clearHistoryOverlay").classList.add("active");
}

// 2. Đóng Modal
function closeClearHistoryModal() {
  document.getElementById("clearHistoryOverlay").classList.remove("active");
}

// 3. Thực hiện xóa (Khi bấm nút "Xóa ngay" trong Modal)
function performClearHistory() {
  // Xóa dữ liệu
  localStorage.removeItem("ss_play_history");
  localStorage.removeItem("ss_top_genre");

  // Đóng Modal
  closeClearHistoryModal();

  // Thông báo thành công (Toast vẫn giữ lại cho đẹp)
  const t = translations[currentLang];
  showToast(
    t.msg_history_cleared || "Đã xóa lịch sử!",
    "success",
    '<i class="fa-solid fa-trash-can"></i>',
  );

  // Tải lại giao diện danh sách (để hiện màn hình trống)
  showRecentPlaylist();
}
// Thêm vào trong hàm init() hoặc cuối file main.js

function setupBackToTop() {
  const universePanel = document.querySelector(".universe-panel");
  const btn = document.getElementById("backToTopBtn");

  if (!universePanel || !btn) return;

  // 1. Lắng nghe sự kiện cuộn
  universePanel.addEventListener("scroll", () => {
    // Ngưỡng 800px tương đương khoảng hơn 10 bài hát
    if (universePanel.scrollTop > 800) {
      btn.classList.add("show");
    } else {
      btn.classList.remove("show");
    }
  });

  // 2. Xử lý khi bấm nút -> Cuộn lên đầu
  btn.addEventListener("click", () => {
    // Scroll mượt mà (Smooth scroll)
    universePanel.scrollTo({
      top: 0,
      behavior: "smooth",
    });

    // Hiệu ứng phụ: Sau khi bấm thì ẩn nút đi luôn cho gọn
    setTimeout(() => {
      btn.classList.remove("show");
    }, 500);
  });
}
// --- LOGIC ĐIỀU KHOẢN & CHÍNH SÁCH ---

// ... (Code cũ)

// --- LOGIC ĐIỀU KHOẢN & CHÍNH SÁCH ---
// 1. Nội dung văn bản
const legalData = {
  terms: `
        <h3 style="color:var(--neon-primary); margin-bottom:10px;">1. Giới thiệu</h3>
        <p>Chào mừng bạn đến với SoundSphere. Khi sử dụng dịch vụ, bạn đồng ý tuân thủ các điều khoản này.</p>
        <br>
        <h3 style="color:var(--neon-primary); margin-bottom:10px;">2. Quyền sở hữu trí tuệ</h3>
        <p>Tất cả nội dung âm nhạc, hình ảnh và giao diện trên SoundSphere đều thuộc bản quyền của chúng tôi hoặc các đối tác cấp phép.</p>
        <br>
        <h3 style="color:var(--neon-primary); margin-bottom:10px;">3. Trách nhiệm người dùng</h3>
        <p>Bạn cam kết không sử dụng dịch vụ vào mục đích phi pháp, sao chép nhạc trái phép hoặc tấn công hệ thống.</p>
    `,
  policy: `
        <h3 style="color:var(--neon-secondary); margin-bottom:10px;">1. Thu thập dữ liệu</h3>
        <p>Chúng tôi chỉ thu thập các thông tin cơ bản (email, tên hiển thị) để phục vụ việc tạo tài khoản và lưu danh sách yêu thích.</p>
        <br>
        <h3 style="color:var(--neon-secondary); margin-bottom:10px;">2. Bảo mật</h3>
        <p>Dữ liệu của bạn được mã hóa và lưu trữ an toàn trên Firebase. Chúng tôi cam kết không chia sẻ thông tin cho bên thứ ba.</p>
        <br>
        <h3 style="color:var(--neon-secondary); margin-bottom:10px;">3. Cookies</h3>
        <p>Trang web sử dụng LocalStorage để lưu cấu hình cá nhân của bạn (âm lượng, chế độ tối/sáng, lịch sử nghe).</p>
    `,
};

// 2. Hàm mở Modal (Đây là hàm bị lỗi lúc nãy do thiếu HTML)
function openLegalModal(type) {
  const overlay = document.getElementById("legalOverlay");
  const title = document.getElementById("legalTitle"); // <--- Lúc nãy lỗi ở đây do không tìm thấy ID
  const content = document.getElementById("legalContent"); // <--- Và ở đây

  if (overlay && title && content) {
    // Kiểm tra an toàn
    if (type === "terms") {
      title.innerText = "Điều Khoản Sử Dụng";
      content.innerHTML = legalData.terms;
    } else {
      title.innerText = "Chính Sách Bảo Mật";
      content.innerHTML = legalData.policy;
    }
    overlay.classList.add("active");
  } else {
    console.error("Thiếu HTML cho Legal Modal!");
  }
}

// 3. Hàm đóng Modal
function closeLegalModal() {
  const overlay = document.getElementById("legalOverlay");
  if (overlay) overlay.classList.remove("active");
}
/* ======================================================
   TÍNH NĂNG: USER PLAYLIST & SHARING
   ====================================================== */

let selectedIconClass = "fa-music"; // Mặc định

// 1. Quản lý Modal Tạo
function openCreatePlaylistModal() {
  if (!window.auth.currentUser) {
    showToast(
      "Vui lòng đăng nhập để tạo Playlist!",
      "info",
      '<i class="fa-solid fa-lock"></i>',
    );
    openAuthModal();
    return;
  }
  document.getElementById("createPlaylistOverlay").classList.add("active");
}

function closeCreatePlaylistModal() {
  document.getElementById("createPlaylistOverlay").classList.remove("active");
  document.getElementById("newPlaylistName").value = "";
}

// 2. Chọn Icon
function selectIcon(el, iconClass) {
  document
    .querySelectorAll(".icon-option")
    .forEach((i) => i.classList.remove("active"));
  el.classList.add("active");
  selectedIconClass = iconClass;
}

// 3. Xử lý tạo Playlist (Gửi lên Firestore)
async function handleCreatePlaylist() {
  const nameInput = document.getElementById("newPlaylistName");
  const name = nameInput.value.trim();
  const user = window.auth.currentUser;

  if (!name) {
    showToast("Vui lòng nhập tên Playlist", "off");
    return;
  }

  try {
    // Tạo document mới trong collection 'playlists'
    const docRef = await window.addDoc(
      window.collection(window.db, "playlists"),
      {
        ownerId: user.uid,
        ownerName: user.displayName || "Unknown",
        name: name,
        icon: selectedIconClass,
        songs: [], // Mảng ID bài hát (rỗng ban đầu)
        createdAt: Date.now(),
      },
    );

    showToast("Tạo playlist thành công!", "success");
    closeCreatePlaylistModal();

    // Tải lại thư viện để hiện playlist mới
    showLibraryPlaylist();
  } catch (e) {
    console.error("Lỗi tạo playlist: ", e);
    showToast("Lỗi khi tạo playlist", "off");
  }
}

// 4. Hàm tải Playlist từ Firestore (Của user hiện tại)
async function fetchUserPlaylists() {
  if (!window.auth.currentUser) return [];

  const q = window.query(
    window.collection(window.db, "playlists"),
    window.where("ownerId", "==", window.auth.currentUser.uid),
  );

  const querySnapshot = await window.getDocs(q);
  const playlists = [];
  querySnapshot.forEach((doc) => {
    playlists.push({ id: doc.id, ...doc.data() });
  });
  return playlists;
}

// 5. Override hàm showLibraryPlaylist cũ để tích hợp Playlist riêng
// (Ghi đè hàm cũ trong main.js bằng hàm này)
async function showLibraryPlaylist() {
  hideAllSections(); // Hàm ẩn các phần khác
  const navLib = document.getElementById("navLibrary");
  if (navLib) navLib.classList.add("active");

  // QUAN TRỌNG: Xóa sạch tiêu đề để renderList không bị nhầm là đang ở mục Yêu thích
  const playlistTitle = document.getElementById("playlistTitle");
  if (playlistTitle) {
    playlistTitle.style.display = "none";
    playlistTitle.innerText = "";
  }

  let libHeader = document.getElementById("libraryHeader");
  if (!libHeader) {
    libHeader = document.createElement("div");
    libHeader.id = "libraryHeader";
    const songListEl = document.getElementById("songList");
    songListEl.parentNode.insertBefore(libHeader, songListEl);
  }
  libHeader.style.display = "block";

  // Tải playlist user (nếu có tính năng này)
  if (
    typeof fetchUserPlaylists === "function" &&
    window.auth &&
    window.auth.currentUser
  ) {
    userPlaylists = await fetchUserPlaylists();
  } else {
    userPlaylists = [];
  }

  // HTML cho các nút chức năng trong thư viện
  let customPlaylistHTML = `
        <div class="lib-card playlist-card create-card" onclick="openCreatePlaylistModal()">
            <div class="create-icon-circle"><i class="fa-solid fa-plus"></i></div>
            <div class="lib-name" style="color:var(--neon-primary)">Tạo Playlist</div>
        </div>
        
        <div class="lib-card playlist-card create-card" onclick="typeof openAddSongModal === 'function' ? openAddSongModal() : showToast('Cần đăng nhập', 'info')" style="border-color: var(--neon-secondary) !important;">
            <div class="create-icon-circle" style="background: rgba(196, 92, 255, 0.2); color: var(--neon-secondary);"><i class="fa-solid fa-cloud-arrow-up"></i></div>
            <div class="lib-name" style="color:var(--neon-secondary)">Thêm nhạc</div>
        </div>
    `;

  // Render danh sách Playlist
  userPlaylists.forEach((pl) => {
    customPlaylistHTML += `
            <div class="lib-card playlist-card" onclick="openUserPlaylist('${pl.id}')">
                <div class="lib-img-box" style="background: linear-gradient(135deg, #2a2a72 0%, #009ffd 100%);">
                    <i class="fa-solid ${pl.icon}"></i>
                </div>
                <div class="lib-info">
                    <div class="lib-name">${pl.name}</div>
                    <div class="lib-desc">${pl.songs.length} bài hát</div>
                </div>
                <button class="lib-play-hover" onclick="event.stopPropagation(); openShareModal('${pl.id}')" title="Chia sẻ">
                    <i class="fa-solid fa-share-nodes"></i>
                </button>
            </div>`;
  });

  const t = translations[currentLang];
  const recommendation = getRecommendations(); // Hàm gợi ý (nếu có)

  libHeader.innerHTML = `
        <div class="lib-section">
            <div class="section-title" style="display:block; margin-bottom:15px;">${t.lib_playlist}</div>
            <div class="lib-scroll-container">
                <div class="lib-card playlist-card" onclick="showFavoritePlaylist()">
                    <div class="lib-img-box gradient-1"><i class="fa-solid fa-heart"></i></div>
                    <div class="lib-info">
                        <div class="lib-name">${t.lib_liked}</div>
                        <div class="lib-desc">${currentFavorites.length} bài hát</div>
                    </div>
                </div>
                ${customPlaylistHTML}
            </div>
        </div>
        <div class="lib-section">
            <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <span>${t.lib_suggest} <span style="color:var(--neon-primary)">${recommendation.genre}</span></span>
            </div>
            <div class="lib-scroll-container">
                ${recommendation.list
                  .map((song) => {
                    const realIdx = defaultSongList.findIndex(
                      (s) => s.id === song.id,
                    );
                    return `
                    <div class="lib-card recent-card" onclick="playSong(${realIdx}, 'all')">
                        <img src="${song.cover}" class="lib-thumb">
                        <div class="lib-info">
                            <div class="lib-name">${song.title}</div>
                            <div class="lib-desc">${song.artist}</div>
                        </div>
                    </div>`;
                  })
                  .join("")}
            </div>
        </div>
        <div class="section-title" style="display:block; margin-top:30px;">${t.lib_all}</div>
    `;

  // QUAN TRỌNG: Reset list về mặc định để hiển thị tất cả
  songs = [...defaultSongList];
  renderList();

  libHeader
    .querySelectorAll(".lib-scroll-container")
    .forEach((c) => enableDragScroll(c));
}

// 6. Mở và nghe Playlist riêng
async function openUserPlaylist(playlistId) {
  // Tìm trong mảng đã tải
  const playlist = userPlaylists.find((p) => p.id === playlistId);
  if (!playlist) return;

  // Lọc bài hát từ defaultSongList dựa trên mảng IDs trong playlist
  // (Giả sử bạn đã có chức năng thêm bài vào playlist - phần này tạm thời sẽ trống nếu chưa thêm)
  // Để test: Bạn có thể fix cứng vài bài trong Firestore hoặc thêm logic "Thêm vào playlist" sau.

  // Nếu playlist rỗng, thông báo
  if (!playlist.songs || playlist.songs.length === 0) {
    showToast("Playlist này chưa có bài hát nào", "info");
    // Vẫn hiện ra nhưng list trống
    songs = [];
  } else {
    songs = defaultSongList.filter((s) => playlist.songs.includes(s.id));
  }

  // Cập nhật giao diện
  const playlistTitle = document.getElementById("playlistTitle");
  if (playlistTitle) {
    playlistTitle.style.display = "block";
    playlistTitle.innerHTML = `<i class="fa-solid ${playlist.icon}"></i> ${playlist.name}`;
  }

  renderList();

  // Nếu có bài thì play bài đầu tiên luôn (tuỳ chọn)
  // if(songs.length > 0) playSong(0, 'playlist');
}

// 7. CHIA SẺ PLAYLIST (SHARE LOGIC)
function openShareModal(playlistId) {
  const modal = document.getElementById("shareOverlay");
  const input = document.getElementById("shareLinkInput");

  // Tạo link: Domain hiện tại + ?playlist=ID
  const shareUrl = `${window.location.origin}${window.location.pathname}?playlist=${playlistId}`;

  input.value = shareUrl;
  modal.classList.add("active");
}

function closeShareModal() {
  document.getElementById("shareOverlay").classList.remove("active");
}

function copyShareLink() {
  const input = document.getElementById("shareLinkInput");
  input.select();
  input.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(input.value);

  showToast("Đã sao chép link!", "success", '<i class="fa-solid fa-link"></i>');
}

// 8. TẢI PLAYLIST ĐƯỢC CHIA SẺ (KHI MỞ LINK)
// Gọi hàm này trong init()
async function checkSharedUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const playlistId = urlParams.get("playlist");

  if (playlistId) {
    console.log("🔗 Phát hiện link chia sẻ playlist:", playlistId);
    showToast("Đang tải Playlist được chia sẻ...", "info");

    try {
      const docRef = window.doc(window.db, "playlists", playlistId);
      const docSnap = await window.getDoc(docRef);

      if (docSnap.exists()) {
        const playlist = docSnap.data();

        // Hiển thị Playlist này lên
        // 1. Chuyển về view chính
        showMainPlaylist();

        // 2. Lọc bài hát
        if (playlist.songs && playlist.songs.length > 0) {
          songs = defaultSongList.filter((s) => playlist.songs.includes(s.id));
        } else {
          songs = [];
        }

        // 3. Đổi tiêu đề
        const titleEl = document.getElementById("playlistTitle");
        if (titleEl) {
          titleEl.style.display = "block";
          titleEl.innerHTML = `
                        <div style="font-size:14px; color:#aaa; margin-bottom:5px;">Playlist được chia sẻ bởi <b>${playlist.ownerName}</b></div>
                        <span><i class="fa-solid ${playlist.icon}"></i> ${playlist.name}</span>
                    `;
        }

        renderList();
        showToast(`Đã tải playlist: ${playlist.name}`, "success");

        // Xóa param trên URL để không bị load lại khi F5
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
      } else {
        showToast("Playlist không tồn tại hoặc đã bị xóa", "off");
      }
    } catch (e) {
      console.error(e);
      showToast("Lỗi khi tải Playlist chia sẻ", "off");
    }
  }
}
/* ======================================================
   TÍNH NĂNG: XÁC THỰC TÀI KHOẢN (AUTH)
   ====================================================== */

// 1. XỬ LÝ ĐĂNG KÝ
async function handleRegister() {
  const name = document.getElementById("registerName").value.trim();
  const email = document.getElementById("registerEmail").value.trim();
  const pass = document.getElementById("registerPassword").value;

  if (!name || !email || !pass) {
    showToast("Vui lòng điền đầy đủ thông tin!", "off");
    return;
  }

  if (pass.length < 6) {
    showToast("Mật khẩu phải từ 6 ký tự trở lên", "info");
    return;
  }

  try {
    showToast("Đang tạo tài khoản...", "info");

    // Gọi hàm tạo user của Firebase
    const userCredential = await window.createUserWithEmailAndPassword(
      window.auth,
      email,
      pass,
    );
    const user = userCredential.user;

    // Cập nhật tên hiển thị (Display Name)
    await window.updateProfile(user, {
      displayName: name,
    });

    // Tạo dữ liệu người dùng ban đầu trên Firestore (Tùy chọn)
    /* await window.setDoc(window.doc(window.db, "users", user.uid), {
            email: email,
            name: name,
            createdAt: Date.now()
        }); */

    showToast(`Chào mừng ${name}! Đăng ký thành công.`, "success");

    // Đóng modal đăng ký
    closeAuthModal(); // (Giả sử bạn đã có hàm này để đóng popup)
  } catch (error) {
    console.error(error);
    let msg = "Đăng ký thất bại.";
    if (error.code === "auth/email-already-in-use")
      msg = "Email này đã được sử dụng.";
    if (error.code === "auth/invalid-email") msg = "Email không hợp lệ.";
    showToast(msg, "off", '<i class="fa-solid fa-triangle-exclamation"></i>');
  }
}

// 2. XỬ LÝ ĐĂNG NHẬP
async function handleLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPassword").value;

  if (!email || !pass) {
    showToast("Vui lòng nhập Email và Mật khẩu", "off");
    return;
  }

  try {
    showToast("Đang đăng nhập...", "info");

    // Gọi hàm đăng nhập
    await window.signInWithEmailAndPassword(window.auth, email, pass);

    showToast("Đăng nhập thành công!", "success");

    // Đóng modal
    closeAuthModal();
  } catch (error) {
    console.error(error);
    let msg = "Đăng nhập thất bại.";
    if (
      error.code === "auth/user-not-found" ||
      error.code === "auth/wrong-password" ||
      error.code === "auth/invalid-credential"
    ) {
      msg = "Sai tài khoản hoặc mật khẩu.";
    }
    showToast(msg, "off", '<i class="fa-solid fa-triangle-exclamation"></i>');
  }
}

// 3. XỬ LÝ ĐĂNG XUẤT
async function handleLogout() {
  try {
    await window.signOut(window.auth);
    showToast("Đã đăng xuất", "info");

    // Reset dữ liệu bài hát yêu thích/playlist về mặc định
    currentFavorites = [];
    // renderList(); // Render lại list nhạc nếu cần
  } catch (error) {
    console.error(error);
  }
}

// 4. THEO DÕI TRẠNG THÁI (QUAN TRỌNG NHẤT)
// Hàm này tự chạy mỗi khi F5 hoặc khi user đăng nhập/xuất
function monitorAuthState() {
  window.onAuthStateChanged(window.auth, (user) => {
    if (user) {
      // --- TRẠNG THÁI: ĐÃ ĐĂNG NHẬP ---
      console.log("User đang đăng nhập:", user.email);

      // A. Cập nhật giao diện: Hiện tên & Avatar
      updateUserUI(true, user);

      // B. Tải dữ liệu riêng của User (Playlist, Yêu thích...)
      // if (typeof fetchUserPlaylists === 'function') fetchUserPlaylists();
      // if (typeof loadUserFavorites === 'function') loadUserFavorites();
    } else {
      // --- TRẠNG THÁI: KHÁCH (CHƯA LOGIN) ---
      console.log("Không có user đăng nhập.");

      // A. Cập nhật giao diện: Hiện nút Đăng nhập
      updateUserUI(false, null);
    }
  });
}

// 5. CẬP NHẬT GIAO DIỆN (UI)
function updateUserUI(isLoggedIn, user) {
  // Các phần tử giao diện cần thay đổi
  const userNameEls = document.querySelectorAll(
    "#userNameDisplay, .user-name-text",
  );
  const avatarEls = document.querySelectorAll(".user-avatar-img");
  const loginBtns = document.querySelectorAll(".btn-login-trigger"); // Nút mở modal đăng nhập
  const logoutBtns = document.querySelectorAll("#btnLogout"); // Nút đăng xuất trong cài đặt
  const accountInfoSection = document.getElementById("accountInfoSection"); // Khu vực thông tin tk

  if (isLoggedIn) {
    // ==> HIỆN THÔNG TIN USER
    const displayName = user.displayName || "Người dùng";
    // Lấy chữ cái đầu làm avatar nếu không có ảnh
    const firstChar = displayName.charAt(0).toUpperCase();

    userNameEls.forEach((el) => (el.innerText = displayName));
    // Ẩn nút đăng nhập, Hiện nút đăng xuất
    loginBtns.forEach((btn) => (btn.style.display = "none"));
    logoutBtns.forEach((btn) => (btn.style.display = "flex")); // Hoặc 'block'

    if (accountInfoSection) accountInfoSection.style.display = "flex";
  } else {
    // ==> HIỆN NÚT ĐĂNG NHẬP
    userNameEls.forEach((el) => (el.innerText = "Khách"));

    // Hiện nút đăng nhập, Ẩn nút đăng xuất
    loginBtns.forEach((btn) => (btn.style.display = "flex")); // Hoặc 'block'
    logoutBtns.forEach((btn) => (btn.style.display = "none"));

    if (accountInfoSection) accountInfoSection.style.display = "none";
  }
}
/* ======================================================
   HỆ THỐNG ĐIỀU HƯỚNG TRUNG TÂM (NAVIGATION MANAGER) - FIX LỖI GIAO DIỆN
   ====================================================== */

// 1. Hàm "Dọn dẹp": Ẩn TẤT CẢ mọi thứ trước khi chuyển trang
function hideAllSections() {
  // A. Ẩn các thành phần giao diện chính
  const elementsToHide = [
    ".banner-slider", // Banner ở Home
    ".planets-orbit", // Hành tinh xoay ở Home
    ".charts-3d-container", // Bảng xếp hạng 3D
    "#libraryHeader", // Header của Thư viện
    "#playlistTitle", // Tiêu đề playlist/section
    "#settingsPanel", // Màn hình Cài đặt
    ".section-title", // Các tiêu đề section
  ];

  elementsToHide.forEach((selector) => {
    const els = document.querySelectorAll(selector);
    els.forEach((el) => (el.style.display = "none"));
  });

  // B. Reset trạng thái nút Sidebar (Bỏ active hết)
  document
    .querySelectorAll(".nav-item")
    .forEach((btn) => btn.classList.remove("active"));

  // C. Đảm bảo panel chính hiện ra (để chứa nội dung)
  const uniPanel = document.querySelector(".universe-panel");
  if (uniPanel) {
    uniPanel.style.display = "block";
    uniPanel.style.opacity = "1";
    uniPanel.style.transform = "translateX(0)";
    uniPanel.scrollTop = 0; // Cuộn lên đầu
  }

  // D. Reset danh sách bài hát về hiển thị
  const songListEl = document.getElementById("songList");
  if (songListEl) songListEl.style.display = "grid";
}

// 2. TRANG CHỦ (KHÁM PHÁ)
function showMainPlaylist() {
  hideAllSections();

  // Active Sidebar
  const navItems = document.querySelectorAll(".nav-item");
  if (navItems[0]) navItems[0].classList.add("active");

  // Hiện các thành phần Home
  const elsToShow = [
    ".banner-slider",
    ".planets-orbit",
    ".charts-3d-container",
  ];
  elsToShow.forEach((selector) => {
    const el = document.querySelector(selector);
    if (el) el.style.display = "flex"; // Hoặc block tùy element
  });

  // Hiện lại các tiêu đề section (trừ tiêu đề playlist riêng)
  document.querySelectorAll(".section-title").forEach((el) => {
    if (el.id !== "playlistTitle") el.style.display = "block";
  });

  // Xử lý tiêu đề chính "Gợi ý cho bạn"
  const playlistTitle = document.getElementById("playlistTitle");
  if (playlistTitle) {
    playlistTitle.setAttribute("data-lang", "sec_suggest");
    playlistTitle.innerText =
      translations[currentLang].sec_suggest || "Gợi ý cho bạn";
    playlistTitle.style.display = "block";
    playlistTitle.style.marginTop = "30px";
  }

  // Reset danh sách bài hát về ngẫu nhiên
  songs = getRandomSongsForExplore();

  // Đồng bộ bài đang hát (để không bị lỗi index)
  if (state.currentSong) {
    const newIdx = songs.findIndex((s) => s.id === state.currentSong.id);
    if (newIdx !== -1) state.currentSongIndex = newIdx;
  }

  renderList();
}

// 3. THƯ VIỆN (PLAYLIST CỦA TÔI)
async function showLibraryPlaylist() {
  hideAllSections();

  // Active Sidebar
  const navLib = document.getElementById("navLibrary");
  if (navLib) navLib.classList.add("active");

  // Xử lý Header Thư viện
  let libHeader = document.getElementById("libraryHeader");
  if (!libHeader) {
    // Tạo mới nếu chưa có
    libHeader = document.createElement("div");
    libHeader.id = "libraryHeader";
    const songListEl = document.getElementById("songList");
    songListEl.parentNode.insertBefore(libHeader, songListEl);
  }
  libHeader.style.display = "block";

  // Tải dữ liệu Playlist User
  if (window.auth && window.auth.currentUser) {
    userPlaylists = await fetchUserPlaylists();
  } else {
    userPlaylists = [];
  }

  // Render nội dung Thư viện
  const t = translations[currentLang];
  const recommendation = getRecommendations();

  // HTML tạo playlist
  let customPlaylistHTML = `
        <div class="lib-card playlist-card create-card" onclick="openCreatePlaylistModal()">
            <div class="create-icon-circle"><i class="fa-solid fa-plus"></i></div>
            <div class="lib-name" style="color:var(--neon-primary)">Tạo mới</div>
        </div>
    `;
  // HTML playlist user
  userPlaylists.forEach((pl) => {
    customPlaylistHTML += `
            <div class="lib-card playlist-card" onclick="openUserPlaylist('${pl.id}')">
                <div class="lib-img-box" style="background: linear-gradient(135deg, #2a2a72 0%, #009ffd 100%);">
                    <i class="fa-solid ${pl.icon}"></i>
                </div>
                <div class="lib-info">
                    <div class="lib-name">${pl.name}</div>
                    <div class="lib-desc">${pl.songs.length} bài hát</div>
                </div>
                <button class="lib-play-hover" onclick="event.stopPropagation(); openShareModal('${pl.id}')" title="Chia sẻ">
                    <i class="fa-solid fa-share-nodes"></i>
                </button>
            </div>
        `;
  });

  libHeader.innerHTML = `
        <div class="lib-section">
            <div class="section-title" style="display:block; margin-bottom:15px;">${
              t.lib_playlist
            }</div>
            <div class="lib-scroll-container">
                <div class="lib-card playlist-card" onclick="showFavoritePlaylist()">
                    <div class="lib-img-box gradient-1"><i class="fa-solid fa-heart"></i></div>
                    <div class="lib-info">
                        <div class="lib-name">${t.lib_liked}</div>
                        <div class="lib-desc">${
                          currentFavorites.length
                        } bài hát</div>
                    </div>
                </div>
                ${customPlaylistHTML}
            </div>
        </div>
        <div class="lib-section">
            <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <span>${
                  t.lib_suggest
                } <span style="color:var(--neon-primary)">${
                  recommendation.genre
                }</span></span>
            </div>
            <div class="lib-scroll-container">
                ${recommendation.list
                  .map((song) => {
                    const realIdx = defaultSongList.findIndex(
                      (s) => s.id === song.id,
                    );
                    return `
                    <div class="lib-card recent-card" onclick="playSong(${realIdx}, 'all')">
                        <img src="${song.cover}" class="lib-thumb">
                        <div class="lib-info">
                            <div class="lib-name">${song.title}</div>
                            <div class="lib-desc">${song.artist}</div>
                        </div>
                    </div>`;
                  })
                  .join("")}
            </div>
        </div>
        <div class="section-title" style="display:block; margin-top:30px;">${
          t.lib_all
        }</div>
    `;

  // Render danh sách chính
  songs = [...defaultSongList];
  renderList();

  // Kích hoạt kéo thả
  libHeader
    .querySelectorAll(".lib-scroll-container")
    .forEach((c) => enableDragScroll(c));
}

// 4. YÊU THÍCH
function showFavoritePlaylist() {
  hideAllSections();

  // Active Sidebar
  const navFav = document.getElementById("navFavorite");
  if (navFav) navFav.classList.add("active");

  // Hiện tiêu đề
  const playlistTitle = document.getElementById("playlistTitle");
  if (playlistTitle) {
    playlistTitle.style.display = "block";
    playlistTitle.style.marginTop = "20px";
    playlistTitle.setAttribute("data-lang", "fav_title");
    playlistTitle.innerText =
      translations[currentLang].fav_title || "Bài hát yêu thích";
  }

  // Render danh sách yêu thích
  updateFavoriteList();
}

// 5. GẦN ĐÂY (LỊCH SỬ)
function showRecentPlaylist() {
  hideAllSections();

  // Active Sidebar
  const navRecent = document.getElementById("navRecent");
  if (navRecent) navRecent.classList.add("active");

  // Hiện tiêu đề + Nút xóa
  const playlistTitle = document.getElementById("playlistTitle");
  if (playlistTitle) {
    playlistTitle.style.display = "flex"; // Flex để căn nút xóa
    playlistTitle.style.alignItems = "center";
    playlistTitle.style.gap = "15px";
    playlistTitle.style.marginTop = "20px";

    const t = translations[currentLang];
    playlistTitle.innerHTML = `
            <span>${t.sb_recent || "Đã phát gần đây"}</span>
            <button onclick="openClearHistoryModal()" title="${
              t.btn_clear_history
            }" style="background: rgba(255, 71, 87, 0.1); border: 1px solid rgba(255, 71, 87, 0.3); color: #ff4757; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                <i class="fa-solid fa-trash-can" style="font-size: 14px;"></i>
            </button>
        `;
  }

  // Logic lấy dữ liệu lịch sử
  const history = JSON.parse(localStorage.getItem("ss_play_history") || "[]");
  const historySongs = history
    .map((hItem) => defaultSongList.find((s) => s.id === hItem.id))
    .filter((item) => item !== undefined);

  if (historySongs.length === 0) {
    const emptyText =
      translations[currentLang]?.empty_recent_text ||
      "Chưa có lịch sử nghe nhạc";
    document.getElementById("songList").innerHTML = `
            <div style="text-align:center; padding:80px 20px; color:var(--text-dim);">
                <i class="fa-solid fa-clock-rotate-left" style="font-size:64px; margin-bottom:20px; opacity:0.3;"></i>
                <div style="font-size:16px;">${emptyText}</div>
            </div>`;
  } else {
    songs = historySongs;
    if (state.currentSong) {
      const newIdx = songs.findIndex((s) => s.id === state.currentSong.id);
      if (newIdx !== -1) state.currentSongIndex = newIdx;
    }
    renderList();
  }
}

// 6. CÀI ĐẶT
function showSettingsPage() {
  hideAllSections();

  // Active Sidebar (Nút cuối cùng)
  const navItems = document.querySelectorAll(".nav-item");
  if (navItems.length > 0)
    navItems[navItems.length - 1].classList.add("active");

  // Ẩn luôn list nhạc để Settings full màn hình
  const songListEl = document.getElementById("songList");
  if (songListEl) songListEl.style.display = "none";

  // Ẩn universe panel
  const uni = document.querySelector(".universe-panel");
  if (uni) uni.style.display = "none";

  // Hiện Settings
  const setPanel = document.getElementById("settingsPanel");
  if (setPanel) {
    setPanel.style.display = "block";
    setPanel.style.opacity = "1";
  }
}
