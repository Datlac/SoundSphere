/* =========================================================================
   SOUNDSPHERE FINAL LOGIC (FIXED)
   ========================================================================= */

let songs = [...defaultSongList];
let previousSongIndex = -1;
let undoTimeout;

let state = {
  isPlaying: false,
  currentSongIndex: 0,
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
  volSlider: document.getElementById("volumeSlider"),
  volFill: document.getElementById("volumeFill"),
  volIcon: document.getElementById("volumeIcon"),
};

document.addEventListener("DOMContentLoaded", () => {
  init();
  initLanguage();
  initStreamQuality();
  loadDurationsSmart();
  setupSwipeGestures();
});

function init() {
  renderSkeleton();
  setTimeout(() => {
    // Session restore logic
    const savedOrder = localStorage.getItem("ss_saved_playlist");
    const savedShuffleState = localStorage.getItem("ss_is_shuffled");
    if (savedOrder) {
      try {
        songs = JSON.parse(savedOrder);
      } catch (e) {}
      state.isShuffled = savedShuffleState === "true";
    }

    if (el.shuffleBtn)
      el.shuffleBtn.classList.toggle("active", state.isShuffled);
    audio.volume = state.lastVolume;
    setVolumeUI(state.lastVolume);

    renderList();
    loadSong(state.currentSongIndex, false);
    setupEvents();
  }, 300);
}

/* --- NAVIGATION LOGIC (FIXED) --- */
function showMainPlaylist() {
  // 1. Đóng hết các Modal/Overlay
  document.getElementById("settingsPanel").style.display = "none";
  document.getElementById("fullScreenPlayer").classList.remove("active");
  document.getElementById("lyricsFullScreen").classList.remove("active");

  // 2. Hiện lại trang chủ
  const uni = document.querySelector(".universe-panel");
  uni.style.display = "block";
  uni.style.opacity = "1";
  uni.style.transform = "translateX(0)";

  // 3. Reset Sidebar active state
  document
    .querySelectorAll(".nav-item")
    .forEach((i) => i.classList.remove("active"));
  document.querySelector(".nav-item:first-child").classList.add("active");

  document.getElementById("playlistTitle").innerText = "Dải Ngân Hà";
}

function showSettingsPage() {
  document.querySelector(".universe-panel").style.display = "none";
  const set = document.getElementById("settingsPanel");
  set.style.display = "block";
  setTimeout(() => {
    set.style.opacity = "1";
    set.style.transform = "translateX(0)";
  }, 10);
}

/* --- PLAYER LOGIC --- */
function loadSong(i, play = true) {
  state.currentSongIndex = i;
  const song = songs[i];

  el.currentTitle.innerText = el.footerTitle.innerText = song.title;
  el.currentArtist.innerText = el.footerArtist.innerText = song.artist;
  el.currentCover.src = el.footerCover.src = song.cover;

  // Reset Disc
  const discImg = el.disc.querySelector(".disc-img");
  discImg.style.animation = "none";
  discImg.offsetHeight; /* Trigger reflow */
  discImg.style.animation = "rotate 24s linear infinite paused";
  el.disc.classList.remove("playing");

  audio.src = song.src;
  updateLikeStatusUI(song.id, state.likedSongs.has(song.id));
  updateActiveSongUI(i);

  if (play) {
    audio
      .play()
      .then(() => {
        state.isPlaying = true;
        el.playIcon.className = "fa-solid fa-pause";
        el.disc.classList.add("playing");
        updateMediaSession();
      })
      .catch((e) => {
        console.error(e);
        state.isPlaying = false;
        el.playIcon.className = "fa-solid fa-play";
      });
  }
}

function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) {
    audio.play();
    state.isPlaying = true;
    el.playIcon.className = "fa-solid fa-pause";
    el.disc.classList.add("playing");
  } else {
    audio.pause();
    state.isPlaying = false;
    el.playIcon.className = "fa-solid fa-play";
    el.disc.classList.remove("playing");
  }
  renderList();
  updateMediaSession();
}

function nextSong() {
  let nextIndex = (state.currentSongIndex + 1) % songs.length;
  if (state.isShuffled) {
    do {
      nextIndex = Math.floor(Math.random() * songs.length);
    } while (nextIndex === state.currentSongIndex && songs.length > 1);
  }
  loadSong(nextIndex, true);
}

function prevSong() {
  let prevIndex = (state.currentSongIndex - 1 + songs.length) % songs.length;
  loadSong(prevIndex, true);
}

/* --- EVENTS --- */
function setupEvents() {
  // Audio Time Update
  audio.addEventListener("timeupdate", () => {
    const curr = audio.currentTime;
    const dur = audio.duration || 1;
    const pct = (curr / dur) * 100;

    // Update Text
    const currStr = formatTime(curr);
    if (el.currentTime) el.currentTime.innerText = currStr;
    if (el.timeCurrentMain) el.timeCurrentMain.innerText = currStr;

    // Update Progress Bar (chỉ khi không kéo thủ công)
    if (!isDragging) {
      el.progressBar.value = curr;
      el.progressFill.style.width = `${pct}%`;
    }

    syncLyrics(); // Karaoke text sync
  });

  // Load Metadata (Duration fix)
  audio.addEventListener("loadedmetadata", () => {
    const dur = audio.duration;
    const durStr = formatTime(dur);
    el.progressBar.max = dur;
    if (el.duration) el.duration.innerText = durStr;
    if (el.timeDurationMain) el.timeDurationMain.innerText = durStr;
  });

  audio.addEventListener("ended", () => {
    if (state.repeatMode === 2) {
      audio.currentTime = 0;
      audio.play();
    } else nextSong();
  });

  // Progress Bar Dragging
  let isDragging = false;
  el.progressBar.addEventListener("input", (e) => {
    isDragging = true;
    const val = e.target.value;
    const max = e.target.max || 1;
    el.progressFill.style.width = `${(val / max) * 100}%`;
    el.currentTime.innerText = formatTime(val);
  });
  el.progressBar.addEventListener("change", (e) => {
    isDragging = false;
    audio.currentTime = e.target.value;
    if (!state.isPlaying) togglePlay();
  });
}

/* --- VOLUME LOGIC (FIXED) --- */
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
    audio.volume = state.lastVolume || 0.8;
    setVolumeUI(audio.volume);
  }
}

function setVolumeUI(v) {
  if (el.volSlider) el.volSlider.value = v;
  if (el.volFill) el.volFill.style.width = `${v * 100}%`;

  if (v == 0) el.volIcon.className = "fa-solid fa-volume-xmark";
  else if (v < 0.5) el.volIcon.className = "fa-solid fa-volume-low";
  else el.volIcon.className = "fa-solid fa-volume-high";
}

/* --- UTILS --- */
function formatTime(s) {
  if (isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" + sec : sec}`;
}

/* ==================== CORE PLAYER LOGIC ==================== */

function renderList() {
  const currentPlaylistTitle =
    document.getElementById("playlistTitle")?.innerText || "Dải Ngân Hà";
  if (currentPlaylistTitle === "Bài hát yêu thích") return;

  el.list.innerHTML = songs
    .map((s, i) => {
      const isActive = i === state.currentSongIndex;
      const isLiked = state.likedSongs.has(s.id);
      const duration = s.duration || "--:--";

      let indexContent = `<span class="song-index">${i + 1}</span>`;
      if (isActive && state.isPlaying) {
        indexContent = `<div class="playing-gif"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>`;
      } else if (isActive) {
        indexContent = `<i class="fa-solid fa-play" style="color:var(--neon-primary); font-size:12px;"></i>`;
      }

      return `
      <div class="song-item ${
        isActive ? "active" : ""
      }" id="song-${i}" onclick="playSong(${i}, 'all')">
         <div class="song-index-wrapper">${indexContent}</div>
         <div class="song-info">
             <div class="song-title" style="color: ${
               isActive ? "var(--neon-primary)" : "white"
             }">${s.title}</div>
             <div class="song-artist">${s.artist}</div>
         </div>
         <div style="display:flex; align-items:center; justify-content:center;">
             <button class="btn-heart-list ${
               isLiked ? "liked" : ""
             }" data-id="${
        s.id
      }" onclick="event.stopPropagation(); toggleLikeInList(${s.id})">
                 <i class="${isLiked ? "fa-solid" : "fa-regular"} fa-heart"></i>
             </button>
         </div>
         <div class="song-duration" id="dur-${i}">${duration}</div>
      </div>`;
    })
    .join("");
}

function loadSong(i, play = true) {
  state.currentSongIndex = i;
  const song = songs[i];

  // Update UI Elements
  el.currentTitle.innerText = el.footerTitle.innerText = song.title;
  el.currentArtist.innerText = el.footerArtist.innerText = song.artist;
  el.currentCover.src = el.footerCover.src = song.cover;

  // Reset Disc Animation
  const discImg = el.disc.querySelector(".disc-img");
  discImg.style.animation = "none";
  discImg.style.transform = "rotate(0deg) scale(1)";
  el.disc.classList.remove("playing");
  void discImg.offsetWidth;
  discImg.style.animation = "rotate 24s linear infinite paused";

  // Update Fullscreen UI
  const fsCover = document.getElementById("fsCover");
  const fsDiscWrapper = document.getElementById("fsDiscWrapper");
  if (fsCover && fsDiscWrapper) {
    fsCover.src = song.cover;
    document.getElementById(
      "fsBackdrop"
    ).style.backgroundImage = `url('${song.cover}')`;
    document.getElementById("fsTitle").innerText = song.title;
    document.getElementById("fsArtist").innerText = song.artist;

    fsCover.style.animation = "none";
    fsCover.style.transform = "rotate(0deg)";
    fsDiscWrapper.classList.remove("playing");
    void fsCover.offsetWidth;
    fsCover.style.animation = "rotate 20s linear infinite paused";
  }

  // Set Audio Source
  audio.src = song.src;

  // Update Like Button
  const isLiked = state.likedSongs.has(song.id);
  updateLikeStatusUI(song.id, isLiked);

  // Reset Timers
  if (el.timeCurrentMain) el.timeCurrentMain.innerText = "0:00";
  if (el.timeDurationMain)
    el.timeDurationMain.innerText = song.duration || "0:00";

  updateActiveSongUI(i);

  if (play) {
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        state.isPlaying = true;
        el.playIcon.className = "fa-solid fa-pause";

        // Mobile Visual Feedback
        if (window.innerHeight < 500) {
          showCenterNotification(`
            <div style="font-size:12px; color:#aaa; margin-bottom:5px;">ĐANG PHÁT</div>
            <div style="font-size:20px; color:var(--neon-primary); font-weight:bold;">${song.title}</div>
            <div style="font-size:14px; color:white;">${song.artist}</div>
        `);
        }

        // Fade In Effect
        let vol = 0;
        const target = state.lastVolume || 0.8;
        const fade = setInterval(() => {
          if (vol < target) {
            vol += 0.05;
            audio.volume = Math.min(vol, target);
          } else {
            audio.volume = target;
            clearInterval(fade);
          }
        }, 50);

        el.disc.classList.add("playing");
        el.deck.classList.add("playing");
        renderList();
        updateMediaSession();
      })
      .catch((err) => {
        console.error("Autoplay failed:", err);
        state.isPlaying = false;
        el.playIcon.className = "fa-solid fa-play";
      });
  } else {
    state.isPlaying = false;
    el.playIcon.className = "fa-solid fa-play";
    updateMediaSession();
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
  state.playbackContext = context;
  if (i === state.currentSongIndex && state.isPlaying) {
    togglePlay();
    return;
  }
  loadSong(i, true);
}

function getPlaybackList() {
  if (state.playbackContext === "favorites") {
    return songs
      .map((s, i) => i)
      .filter((i) => state.likedSongs.has(songs[i].id));
  }
  return songs.map((s, i) => i);
}

function nextSong() {
  previousSongIndex = state.currentSongIndex;
  const playbackList = getPlaybackList();
  if (playbackList.length === 0) return;

  let nextIndex;

  if (state.isShuffled) {
    const available = playbackList.filter((i) => i !== state.currentSongIndex);
    nextIndex =
      available.length > 0
        ? available[Math.floor(Math.random() * available.length)]
        : playbackList[0];
  } else {
    const currentPos = playbackList.indexOf(state.currentSongIndex);
    let nextPos = currentPos + 1;
    if (nextPos >= playbackList.length) nextPos = 0;
    nextIndex = playbackList[nextPos];
  }

  if (nextIndex === undefined) {
    state.playbackContext = "all";
    nextIndex = (state.currentSongIndex + 1) % songs.length;
  }

  loadSong(nextIndex, true);
  if (window.innerHeight < 500) showUndoToast();
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
    prevIndex =
      available.length > 0
        ? available[Math.floor(Math.random() * available.length)]
        : playbackList[0];
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

/* ==================== EVENTS & LISTENERS ==================== */

function setupEvents() {
  // Keyboard
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const nonRepeatKeys = ["Space", "KeyL", "KeyK", "KeyS", "KeyR", "KeyM"];
    if (e.repeat && nonRepeatKeys.includes(e.code)) return;

    switch (e.code) {
      case "Space":
        e.preventDefault();
        togglePlay();
        break;
      case "KeyL":
        nextSong();
        break;
      case "KeyK":
        prevSong();
        break;
      case "ArrowUp":
        e.preventDefault();
        audio.volume = Math.min(1, audio.volume + 0.05);
        setVolumeUI(audio.volume);
        break;
      case "ArrowDown":
        e.preventDefault();
        audio.volume = Math.max(0, audio.volume - 0.05);
        setVolumeUI(audio.volume);
        break;
      case "KeyS":
        toggleShuffle();
        break;
      case "KeyR":
        toggleRepeat();
        break;
      case "KeyM":
        toggleMute();
        break;
    }
  });

  // Audio State Events
  audio.addEventListener("playing", () => {
    el.disc.classList.remove("buffering");
    document
      .querySelector(".footer-cover-wrapper")
      ?.classList.remove("buffering");
  });

  audio.addEventListener("error", () => {
    el.disc.classList.remove("buffering");
    document
      .querySelector(".footer-cover-wrapper")
      ?.classList.remove("buffering");
    if (state.isPlaying) {
      showToast("Lỗi tải bài hát!", "error");
      state.isPlaying = false;
      el.playIcon.className = "fa-solid fa-play";
    }
  });

  audio.addEventListener("timeupdate", () => {
    const currTimeStr = formatTime(audio.currentTime);
    if (el.timeCurrentMain) el.timeCurrentMain.innerText = currTimeStr;

    // Footer Progress
    if (!isDragging) {
      const pct = (audio.currentTime / (audio.duration || 1)) * 100;
      el.progressBar.value = audio.currentTime;
      el.progressFill.style.width = `${pct}%`;
      el.currentTime.innerText = currTimeStr;
    }

    // Fullscreen Progress
    if (
      document.getElementById("fullScreenPlayer").classList.contains("active")
    ) {
      if (!isFsDragging) {
        const fsProgressBar = document.getElementById("fsProgressBar");
        const dur = audio.duration || 1;
        if (fsProgressBar) {
          fsProgressBar.max = dur;
          fsProgressBar.value = audio.currentTime;
          const pct = (audio.currentTime / dur) * 100;
          document.getElementById("fsProgressFill").style.width = `${pct}%`;
          document.getElementById("fsCurrentTime").innerText = currTimeStr;
        }
      }
    }

    syncLyrics(); // Karaoke Sync
  });

  audio.addEventListener("loadedmetadata", () => {
    const durStr = formatTime(audio.duration);
    el.progressBar.max = audio.duration;
    el.duration.innerText = durStr;
    if (el.timeDurationMain) el.timeDurationMain.innerText = durStr;
    const fsProgressBar = document.getElementById("fsProgressBar");
    if (fsProgressBar) fsProgressBar.max = audio.duration;
  });

  audio.addEventListener("ended", () => {
    if (state.repeatMode === 2) {
      audio.currentTime = 0;
      audio.play();
    } else {
      nextSong();
    }
  });

  // Footer Progress Dragging
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
}

function seekSong() {
  /* Placeholder */
}

/* ==================== PLAYER CONTROLS (SHUFFLE/REPEAT/VOLUME) ==================== */

function toggleShuffle() {
  state.isShuffled = !state.isShuffled;
  el.shuffleBtn.classList.toggle("active", state.isShuffled);
  if (el.fsShuffleBtn)
    el.fsShuffleBtn.classList.toggle("active", state.isShuffled);
  localStorage.setItem("ss_is_shuffled", state.isShuffled);
  showToast(
    state.isShuffled ? "Đã BẬT trộn bài" : "Đã TẮT trộn bài",
    state.isShuffled ? "success" : "off",
    '<i class="fa-solid fa-shuffle"></i>'
  );
}

function toggleRepeat() {
  state.repeatMode = (state.repeatMode + 1) % 3;
  updateRepeatUI(el.repeatBtn);
  if (el.fsRepeatBtn) updateRepeatUI(el.fsRepeatBtn);

  let msg = "Đã TẮT lặp lại";
  let type = "off";
  if (state.repeatMode === 1) {
    msg = "Lặp danh sách";
    type = "success";
  }
  if (state.repeatMode === 2) {
    msg = "Lặp 1 bài";
    type = "success";
  }
  showToast(msg, type, '<i class="fa-solid fa-repeat"></i>');
}

function updateRepeatUI(btn) {
  if (!btn) return;
  btn.classList.remove("active", "repeat-one");
  if (state.repeatMode === 1) btn.classList.add("active");
  if (state.repeatMode === 2) btn.classList.add("active", "repeat-one");
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

/* ==================== LIKE SYSTEM ==================== */

function toggleFooterLike() {
  toggleLikeState(
    songs[state.currentSongIndex].id,
    songs[state.currentSongIndex].title
  );
}
function toggleMainLike() {
  toggleLikeState(
    songs[state.currentSongIndex].id,
    songs[state.currentSongIndex].title
  );
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
      `Đã thích "${title}"`,
      "success",
      '<i class="fa-solid fa-heart"></i>'
    );
  } else {
    state.likedSongs.delete(id);
    showToast(
      `Đã bỏ thích "${title}"`,
      "off",
      '<i class="fa-regular fa-heart"></i>'
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
    document.getElementById("playlistTitle")?.innerText === "Bài hát yêu thích"
  ) {
    updateFavoriteList();
  }
}

function updateLikeStatusUI(id, isLiked) {
  el.likeBtn.classList.toggle("liked", isLiked);
  el.likeBtn.querySelector("i").className = isLiked
    ? "fa-solid fa-heart"
    : "fa-regular fa-heart";
  el.mainLikeBtn.classList.toggle("liked", isLiked);
  el.mainLikeBtn.querySelector("i").className = isLiked
    ? "fa-solid fa-heart"
    : "fa-regular fa-heart";
}

function showFavoritePlaylist() {
  document.getElementById("playlistTitle").innerText = "Bài hát yêu thích";
  document.querySelector(".universe-panel").style.display = "block";
  document.getElementById("settingsPanel").style.display = "none";
  document
    .querySelectorAll(".nav-item")
    .forEach((item) => item.classList.remove("active"));
  document.getElementById("navFavorite").classList.add("active");
  updateFavoriteList();
}

function updateFavoriteList() {
  const favoriteSongs = songs.filter((s) => state.likedSongs.has(s.id));
  if (favoriteSongs.length === 0) {
    el.list.innerHTML = `<div style="text-align:center; padding:80px 20px; color:var(--text-dim);"><i class="fa-regular fa-heart" style="font-size:64px; margin-bottom:20px; opacity:0.3;"></i><div style="font-size:16px;">Chưa có bài hát nào được yêu thích</div></div>`;
    return;
  }
  el.list.innerHTML = favoriteSongs
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
                 <button class="btn-heart-list liked" data-id="${
                   s.id
                 }" onclick="event.stopPropagation(); toggleLikeInList(${
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

/* ==================== UTILS ==================== */

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

function renderSkeleton() {
  const skeletonHTML = Array(8)
    .fill('<div class="skeleton-item"></div>')
    .join("");
  el.list.innerHTML = skeletonHTML;
}

// Smart Cache Duration
async function loadDurationsSmart() {
  const cachedData = JSON.parse(
    localStorage.getItem("ss_durations_cache") || "{}"
  );
  let hasNewData = false;

  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    const durElement = document.getElementById(`dur-${i}`);
    if (cachedData[s.src]) {
      s.duration = cachedData[s.src];
      if (durElement) durElement.innerText = s.duration;
      continue;
    }
    try {
      const duration = await getAudioDuration(s.src);
      s.duration = duration;
      if (durElement) durElement.innerText = duration;
      cachedData[s.src] = duration;
      hasNewData = true;
    } catch (err) {
      if (durElement) durElement.innerText = "--:--";
    }
  }

  if (hasNewData)
    localStorage.setItem("ss_durations_cache", JSON.stringify(cachedData));
}

function getAudioDuration(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(formatTime(audio.duration));
    audio.onerror = () => resolve("--:--");
  });
}

/* ==================== FULLSCREEN PLAYER ==================== */

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

document
  .querySelector(".footer-cover-wrapper")
  ?.addEventListener("click", openFullScreen);
fsElements.playBtn.addEventListener("click", togglePlay);

function openFullScreen() {
  if (window.innerWidth > 1024) return;
  const song = songs[state.currentSongIndex];
  const img = new Image();
  img.src = song.cover;
  img.onload = () => {
    updateFullScreenUI();
    requestAnimationFrame(() => fsOverlay.classList.add("active"));
  };
}

function closeFullScreen() {
  requestAnimationFrame(() => fsOverlay.classList.remove("active"));
}

function updateFullScreenUI() {
  const song = songs[state.currentSongIndex];
  fsElements.cover.src = song.cover;
  fsElements.backdrop.style.backgroundImage = `url('${song.cover}')`;
  fsElements.title.innerText = song.title;
  fsElements.artist.innerText = song.artist;
  fsElements.duration.innerText = formatTime(audio.duration || 0);
  syncFsPlayState();
}

function syncFsPlayState() {
  if (state.isPlaying) {
    fsElements.playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    fsElements.discWrapper.classList.add("playing");
  } else {
    fsElements.playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    fsElements.discWrapper.classList.remove("playing");
  }
}

// Logic kéo thanh nhạc Fullscreen
const fsProgressBar = document.getElementById("fsProgressBar");
let isFsDragging = false;
if (fsProgressBar) {
  fsProgressBar.addEventListener("mousedown", () => (isFsDragging = true));
  fsProgressBar.addEventListener("touchstart", () => (isFsDragging = true));
  fsProgressBar.addEventListener("input", () => {
    const val = fsProgressBar.value;
    const max = audio.duration || 1;
    const pct = (val / max) * 100;
    document.getElementById("fsProgressFill").style.width = `${pct}%`;
    document.getElementById("fsCurrentTime").innerText = formatTime(val);
  });
  fsProgressBar.addEventListener("change", () => {
    isFsDragging = false;
    audio.currentTime = fsProgressBar.value;
    if (!state.isPlaying) togglePlay();
  });
}

/* ==================== LYRICS SYSTEM ==================== */

const lyricsPage = document.getElementById("lyricsFullScreen");
const lyricsUI = {
  backdrop: document.getElementById("lyricsBackdrop"),
  cover: document.getElementById("lyricsCover"),
  title: document.getElementById("lyricsTitle"),
  artist: document.getElementById("lyricsArtist"),
  container: document.getElementById("lyricsTextContainer"),
};
let lyricsData = [];
let activeLineIndex = -1;

async function toggleLyricsPage() {
  const btn = document.getElementById("lyricsBtn");
  const isActive = lyricsPage.classList.contains("active");

  if (isActive) {
    lyricsPage.classList.remove("active");
    btn.classList.remove("active");
  } else {
    const song = songs[state.currentSongIndex];
    lyricsUI.cover.src = song.cover;
    lyricsUI.backdrop.style.backgroundImage = `url('${song.cover}')`;
    lyricsUI.title.innerText = song.title;
    lyricsUI.artist.innerText = song.artist;
    lyricsPage.classList.add("active");
    btn.classList.add("active");
    await fetchAndRenderLyrics(song);
  }
}

function closeLyricsPage() {
  lyricsPage.classList.remove("active");
}

function switchFsTab(tabName) {
  document
    .querySelectorAll(".fs-tab-btn")
    .forEach((btn) => btn.classList.remove("active"));
  document
    .querySelectorAll(".fs-tab-content")
    .forEach((c) => c.classList.remove("active"));

  const btns = document.querySelectorAll(".fs-tab-btn");
  if (tabName === "lyrics") btns[0].classList.add("active");
  if (tabName === "playlist") {
    btns[1].classList.add("active");
    renderFsPlaylist();
  }
  if (tabName === "info") {
    btns[2].classList.add("active");
    updateInfoTab();
  }

  document.getElementById(`tab-${tabName}`).classList.add("active");
}

function renderFsPlaylist() {
  const container = document.getElementById("fsPlaylistList");
  container.innerHTML = songs
    .map((s, i) => {
      const isActive = i === state.currentSongIndex;
      return `
           <div class="fs-song-item ${
             isActive ? "active" : ""
           }" onclick="playSong(${i})">
              <img src="${s.cover}" class="fs-song-img" loading="lazy">
              <div class="fs-song-info">
                 <div class="fs-song-title">${s.title}</div>
                 <div class="fs-song-artist">${s.artist}</div>
              </div>
              ${
                isActive
                  ? '<i class="fa-solid fa-chart-simple" style="color:var(--neon-primary)"></i>'
                  : ""
              }
           </div>`;
    })
    .join("");
  setTimeout(() => {
    const active = container.querySelector(".fs-song-item.active");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 100);
}

function updateInfoTab() {
  const song = songs[state.currentSongIndex];
  document.getElementById("infoArtist").innerText = song.artist;
}

async function fetchAndRenderLyrics(song) {
  lyricsUI.container.innerHTML =
    '<div class="lyrics-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải...</div>';
  lyricsData = [];
  activeLineIndex = -1;

  let rawLyrics = "";
  let isSynced = false;

  if (typeof lyricsDatabase !== "undefined" && lyricsDatabase[song.id]) {
    rawLyrics = lyricsDatabase[song.id];
    isSynced = /\[\d{2}:\d{2}/.test(rawLyrics);
  } else {
    try {
      const queries = [song.title, song.title.replace(/\(.*\)/g, "").trim()];
      for (const q of queries) {
        if (rawLyrics) break;
        const res = await fetch(
          `https://lrclib.net/api/search?q=${encodeURIComponent(
            song.artist + " " + q
          )}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            if (data[0].syncedLyrics) {
              rawLyrics = data[0].syncedLyrics;
              isSynced = true;
            } else {
              rawLyrics = data[0].plainLyrics;
              isSynced = false;
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (rawLyrics) {
    if (isSynced) {
      lyricsData = parseLRC(rawLyrics);
      const html = lyricsData
        .map(
          (line, idx) =>
            `<div class="lyrics-line" id="line-${idx}" onclick="seekToLine(${line.time})">${line.text}</div>`
        )
        .join("");
      lyricsUI.container.innerHTML = `<div style="padding-bottom: 50vh;">${html}</div>`;
    } else {
      lyricsUI.container.innerHTML = rawLyrics
        .split("\n")
        .map(
          (l) => `<div class="lyrics-line" style="cursor:default">${l}</div>`
        )
        .join("");
    }
  } else {
    lyricsUI.container.innerHTML = `<div class="lyrics-placeholder">Không tìm thấy lời bài hát</div>`;
  }
}

function parseLRC(lrc) {
  const lines = lrc.split("\n");
  const result = [];
  const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  lines.forEach((line) => {
    const match = line.match(timeReg);
    if (match) {
      const t =
        parseInt(match[1]) * 60 +
        parseInt(match[2]) +
        parseInt(match[3].padEnd(3, "0")) / 1000;
      const txt = line.replace(timeReg, "").trim();
      if (txt) result.push({ time: t, text: txt });
    }
  });
  return result;
}

function syncLyrics() {
  if (!lyricsData.length || !lyricsPage.classList.contains("active")) return;
  const time = audio.currentTime;
  let idx = lyricsData.findIndex((l) => l.time > time) - 1;
  if (idx === -2) idx = lyricsData.length - 1;

  if (idx !== activeLineIndex) {
    if (activeLineIndex !== -1)
      document
        .getElementById(`line-${activeLineIndex}`)
        ?.classList.remove("active");
    activeLineIndex = idx;
    if (activeLineIndex !== -1) {
      const line = document.getElementById(`line-${activeLineIndex}`);
      if (line) {
        line.classList.add("active");
        const container = lyricsUI.container;
        const top =
          line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
        container.scrollTo({ top, behavior: "smooth" });
      }
    }
  }
}

function seekToLine(t) {
  audio.currentTime = t;
  if (!state.isPlaying) togglePlay();
}

/* ==================== MEDIA SESSION & AUTH ==================== */

function updateMediaSession() {
  if ("mediaSession" in navigator) {
    const song = songs[state.currentSongIndex];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      artwork: [
        {
          src: new URL(song.cover, document.baseURI).href,
          sizes: "512x512",
          type: "image/jpeg",
        },
      ],
    });
    navigator.mediaSession.setActionHandler("play", () => {
      togglePlay();
      updatePlayStateMediaSession();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      togglePlay();
      updatePlayStateMediaSession();
    });
    navigator.mediaSession.setActionHandler("previoustrack", prevSong);
    navigator.mediaSession.setActionHandler("nexttrack", nextSong);
  }
}

function updatePlayStateMediaSession() {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = state.isPlaying
      ? "playing"
      : "paused";
  }
}

// Auth Logic
function openAuthModal() {
  document.getElementById("authOverlay").classList.add("active");
  switchAuthMode("login");
}
function closeAuthModal() {
  document.getElementById("authOverlay").classList.remove("active");
}
function switchAuthMode(mode) {
  document
    .querySelectorAll(".auth-form")
    .forEach((f) => f.classList.remove("active"));
  document.getElementById(mode + "Form")?.classList.add("active");
}
function handleLogin(e) {
  e.preventDefault();
  closeAuthModal();
  showToast(
    `Xin chào, User!`,
    "success",
    '<i class="fa-solid fa-hand-sparkles"></i>'
  );
  document.getElementById(
    "navAccount"
  ).innerHTML = `<span style="color:var(--neon-primary)">User</span>`;
  document.getElementById("navAccount").onclick = openLogoutModal;
}
function handleRegister(e) {
  e.preventDefault();
  closeAuthModal();
  showToast(
    "Đăng ký thành công!",
    "success",
    '<i class="fa-solid fa-check"></i>'
  );
}
function handleForgotPass(e) {
  e.preventDefault();
  closeAuthModal();
  showToast(
    "Đã gửi email khôi phục",
    "success",
    '<i class="fa-solid fa-envelope"></i>'
  );
}

// Logout
function openLogoutModal() {
  document.getElementById("logoutOverlay").classList.add("active");
}
function closeLogoutModal() {
  document.getElementById("logoutOverlay").classList.remove("active");
}
function confirmLogout() {
  window.location.reload();
}

function togglePass(inputId, icon) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    icon.classList.replace("fa-eye", "fa-eye-slash");
    icon.style.color = "var(--neon-primary)";
  } else {
    input.type = "password";
    icon.classList.replace("fa-eye-slash", "fa-eye");
    icon.style.color = "#aaa";
  }
}

function checkStrength(input) {
  const val = input.value;
  const msg = document.getElementById("passStrengthMsg");
  if (val.length < 6) {
    msg.innerText = "Yếu";
    msg.style.color = "#ff4757";
  } else {
    msg.innerText = "Mạnh";
    msg.style.color = "#2ed573";
  }
  msg.classList.add("show");
}

/* ==================== GLOBAL UI (NAVIGATION / SWIPE) ==================== */

function toggleMobileSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("mobileOverlay");
  sidebar.classList.toggle("active");
  overlay.classList.toggle("active");
}
document
  .getElementById("mobileOverlay")
  .addEventListener("click", toggleMobileSidebar);

function showSettingsPage() {
  const uni = document.querySelector(".universe-panel");
  const set = document.getElementById("settingsPanel");
  uni.style.opacity = "0";
  uni.style.transform = "translateX(-20px)";
  setTimeout(() => {
    uni.style.display = "none";
    set.style.display = "block";
    requestAnimationFrame(() => {
      set.style.opacity = "1";
      set.style.transform = "translateX(0)";
    });
  }, 300);
}

function showMainPlaylist() {
  const uni = document.querySelector(".universe-panel");
  const set = document.getElementById("settingsPanel");
  set.style.opacity = "0";
  set.style.transform = "translateX(20px)";
  setTimeout(() => {
    set.style.display = "none";
    uni.style.display = "block";
    document.getElementById("playlistTitle").innerText = "Dải Ngân Hà";
    requestAnimationFrame(() => {
      uni.style.opacity = "1";
      uni.style.transform = "translateX(0)";
    });
  }, 300);
}

// Fullscreen Browser
function toggleAppFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
    showToast(
      "Đã bật toàn màn hình",
      "success",
      '<i class="fa-solid fa-expand"></i>'
    );
  } else {
    document.exitFullscreen?.();
    showToast(
      "Đã thoát toàn màn hình",
      "info",
      '<i class="fa-solid fa-compress"></i>'
    );
  }
}

// --- SWIPE GESTURES LOGIC (Đã khôi phục) ---
let touchStartX = 0;
let touchEndX = 0;
const minSwipeDistance = 50;

const swipeTargets = [
  document.getElementById("controlDeck"),
  document.getElementById("discWrapper"),
  document.querySelector(".mobile-header"),
  document.getElementById("fsDiscWrapper"),
  document.querySelector(".fs-content"),
];

function setupSwipeGestures() {
  swipeTargets.forEach((target) => {
    if (!target) return;

    target.addEventListener(
      "touchstart",
      (e) => {
        if (e.target.tagName === "INPUT" && e.target.type === "range") {
          touchStartX = null;
          return;
        }
        touchStartX = e.changedTouches[0].screenX;
      },
      { passive: true }
    );

    target.addEventListener(
      "touchend",
      (e) => {
        if (touchStartX === null) return;
        touchEndX = e.changedTouches[0].screenX;
        handleSwipeGesture();
      },
      { passive: true }
    );
  });
}

function handleSwipeGesture() {
  const distance = touchStartX - touchEndX;
  if (distance > minSwipeDistance) {
    nextSong();
    showToast(
      "Bài tiếp theo",
      "success",
      '<i class="fa-solid fa-forward"></i>'
    );
  }
  if (distance < -minSwipeDistance) {
    prevSong();
    showToast(
      "Bài trước đó",
      "success",
      '<i class="fa-solid fa-backward"></i>'
    );
  }
}

// Policy Modal
function openInfoModal(type) {
  if (typeof policyData !== "undefined" && policyData[type]) {
    document.getElementById("infoTitle").innerText = policyData[type].title;
    document.getElementById("infoContent").innerHTML = policyData[type].content;
    document.getElementById("infoModal").classList.add("active");
  }
}
function closeInfoModal() {
  document.getElementById("infoModal").classList.remove("active");
}
