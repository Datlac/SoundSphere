/* =========================================================================
   SOUNDSPHERE ADMIN — Quản trị bài hát
   Đăng nhập Google -> chỉ ADMIN_EMAIL được vào -> kéo-thả mp3 + ảnh
   -> tự upload lên Cloudinary (unsigned upload, miễn phí, không cần thẻ)
   -> tự lưu record (kèm URL Cloudinary) vào Firestore (collection "songs")
   ========================================================================= */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CHỈ EMAIL NÀY ĐƯỢC PHÉP TRUY CẬP TRANG QUẢN TRỊ ---
const SUPER_ADMIN_EMAIL = "vnfake20@gmail.com";

// --- CẤU HÌNH CLOUDINARY ---
const CLOUDINARY_CLOUD_NAME = "drrjy5h2z";
const CLOUDINARY_UPLOAD_PRESET = "soundsphere_unsigned";

// --- CÙNG CONFIG FIREBASE VỚI index.html ---
const firebaseConfig = {
  apiKey: "AIzaSyBQ9YYwi2TkG-MB7F4EdmFMc0BDgSPJ1yQ",
  authDomain: "soundsphere-122025.firebaseapp.com",
  projectId: "soundsphere-122025",
  storageBucket: "soundsphere-122025.firebasestorage.app",
  messagingSenderId: "200072680016",
  appId: "1:200072680016:web:8d8cbac682b1bb95a1b755",
  measurementId: "G-2Z0H8TBXK2",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- DOM ---
const el = {
  gateLoggedOut: document.getElementById("gateLoggedOut"),
  gateForbidden: document.getElementById("gateForbidden"),
  forbiddenEmail: document.getElementById("forbiddenEmail"),
  appShell: document.getElementById("appShell"),
  adminEmailLabel: document.getElementById("adminEmailLabel"),
  btnGoogleLogin: document.getElementById("btnGoogleLogin"),
  btnSignOut: document.getElementById("btnSignOut"),
  btnSignOutForbidden: document.getElementById("btnSignOutForbidden"),

  audioDropzone: document.getElementById("audioDropzone"),
  audioInput: document.getElementById("audioInput"),
  coverDropzone: document.getElementById("coverDropzone"),
  coverInput: document.getElementById("coverInput"),

  inputTitle: document.getElementById("inputTitle"),
  inputArtist: document.getElementById("inputArtist"),
  inputGenre: document.getElementById("inputGenre"),
  inputId: document.getElementById("inputId"),
  inputLyrics: document.getElementById("inputLyrics"),
  btnRefreshId: document.getElementById("btnRefreshId"),

  progressWrap: document.getElementById("progressWrap"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  btnSubmit: document.getElementById("btnSubmit"),

  songTableBody: document.getElementById("songTableBody"),
  songCount: document.getElementById("songCount"),
  emptyState: document.getElementById("emptyState"),
  searchSongs: document.getElementById("searchSongs"),
  checkAllSongs: document.getElementById("checkAllSongs"),
  bulkEditToolbar: document.getElementById("bulkEditToolbar"),
  bulkEditSelectedCount: document.getElementById("bulkEditSelectedCount"),
  btnBulkEditOpen: document.getElementById("btnBulkEditOpen"),
  btnBulkEditClear: document.getElementById("btnBulkEditClear"),

  toast: document.getElementById("toast"),

  // Tabs
  tabButtons: document.querySelectorAll(".tab-btn"),
  tabPanels: document.querySelectorAll(".tab-panel"),

  // Bulk upload (album)
  bulkAudioDropzone: document.getElementById("bulkAudioDropzone"),
  bulkAudioInput: document.getElementById("bulkAudioInput"),
  bulkCoverDropzone: document.getElementById("bulkCoverDropzone"),
  bulkCoverInput: document.getElementById("bulkCoverInput"),
  bulkTableSection: document.getElementById("bulkTableSection"),
  bulkFileCount: document.getElementById("bulkFileCount"),
  bulkDupSummary: document.getElementById("bulkDupSummary"),
  bulkTableBody: document.getElementById("bulkTableBody"),
  bulkArtistAll: document.getElementById("bulkArtistAll"),
  btnApplyArtistAll: document.getElementById("btnApplyArtistAll"),
  bulkGenreAll: document.getElementById("bulkGenreAll"),
  btnApplyGenreAll: document.getElementById("btnApplyGenreAll"),
  btnApplyCoverAll: document.getElementById("btnApplyCoverAll"),
  dragReorderHint: document.getElementById("dragReorderHint"),
  bulkProgressText: document.getElementById("bulkProgressText"),
  btnBulkSubmit: document.getElementById("btnBulkSubmit"),

  // CSV import
  csvDropzone: document.getElementById("csvDropzone"),
  csvInput: document.getElementById("csvInput"),
  csvMappingSection: document.getElementById("csvMappingSection"),
  mapTitle: document.getElementById("mapTitle"),
  mapArtist: document.getElementById("mapArtist"),
  mapCover: document.getElementById("mapCover"),
  mapSrc: document.getElementById("mapSrc"),
  mapId: document.getElementById("mapId"),
  mapGenreDefault: document.getElementById("mapGenreDefault"),
  csvSummary: document.getElementById("csvSummary"),
  csvPreviewTable: document.getElementById("csvPreviewTable"),
  csvDupSection: document.getElementById("csvDupSection"),
  csvDupCount: document.getElementById("csvDupCount"),
  csvSkipAllDup: document.getElementById("csvSkipAllDup"),
  csvDupTable: document.getElementById("csvDupTable"),
  csvProgressText: document.getElementById("csvProgressText"),
  btnCsvImport: document.getElementById("btnCsvImport"),

  // Sidebar nav
  navItems: document.querySelectorAll(".nav-item"),
  pages: document.querySelectorAll(".page"),

  // Dashboard
  statSongCount: document.getElementById("statSongCount"),
  statArtistCount: document.getElementById("statArtistCount"),
  statAlbumCount: document.getElementById("statAlbumCount"),
  statTotalPlays: document.getElementById("statTotalPlays"),
  topSongsList: document.getElementById("topSongsList"),
  topArtistsList: document.getElementById("topArtistsList"),
  recentSongsList: document.getElementById("recentSongsList"),

  // Artists
  btnAddArtist: document.getElementById("btnAddArtist"),
  searchArtists: document.getElementById("searchArtists"),
  artistGrid: document.getElementById("artistGrid"),
  artistEmptyState: document.getElementById("artistEmptyState"),

  // Albums
  btnAddAlbum: document.getElementById("btnAddAlbum"),
  searchAlbums: document.getElementById("searchAlbums"),
  albumGrid: document.getElementById("albumGrid"),
  albumEmptyState: document.getElementById("albumEmptyState"),

  // Playlists
  btnAddPlaylist: document.getElementById("btnAddPlaylist"),
  playlistGrid: document.getElementById("playlistGrid"),
  playlistEmptyState: document.getElementById("playlistEmptyState"),

  // Frames (Khung Avatar)
  btnAddFrame: document.getElementById("btnAddFrame"),
  searchFrames: document.getElementById("searchFrames"),
  frameGrid: document.getElementById("frameGrid"),
  frameEmptyState: document.getElementById("frameEmptyState"),

  // Users
  searchUsers: document.getElementById("searchUsers"),
  usersTableBody: document.getElementById("usersTableBody"),
  usersEmptyState: document.getElementById("usersEmptyState"),

  // Storage
  statAudioFileCount: document.getElementById("statAudioFileCount"),
  statDuplicateSongs: document.getElementById("statDuplicateSongs"),
  btnScanDuplicates: document.getElementById("btnScanDuplicates"),
  storageDuplicateResults: document.getElementById("storageDuplicateResults"),

  // Homepage / banners
  pinnedAlbumsList: document.getElementById("pinnedAlbumsList"),
  btnManagePinnedAlbums: document.getElementById("btnManagePinnedAlbums"),
  pinnedPlaylistsList: document.getElementById("pinnedPlaylistsList"),
  btnManagePinnedPlaylists: document.getElementById("btnManagePinnedPlaylists"),

  // Admin Roles (Quản trị viên)
  superAdminEmailLabel: document.getElementById("superAdminEmailLabel"),
  newAdminEmailInput: document.getElementById("newAdminEmailInput"),
  btnAddAdminEmail: document.getElementById("btnAddAdminEmail"),
  adminRolesTableBody: document.getElementById("adminRolesTableBody"),

  // Modal dùng chung
  modalOverlay: document.getElementById("modalOverlay"),
  modalBox: document.getElementById("modalBox"),
};

let selectedAudioFile = null;
let selectedCoverFile = null;
let allSongsCache = [];
let selectedSongIds = new Set();

// State cho các module
let artistsCache = [];
let albumsCache = [];
let playlistsCache = [];
let framesCache = [];
let usersCache = [];

// State cho Upload Album
let bulkItems = [];

// State cho CSV Import
let csvRows = [];
let csvHeaders = [];
let csvSkipMap = new Map();
let csvDupReasons = new Map();

// --- CHUYỂN TAB ---
el.tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    el.tabButtons.forEach((b) => b.classList.remove("active"));
    el.tabPanels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// --- CHUYỂN TRANG (SIDEBAR) ---
const pageLoadedOnce = new Set();

function goToPage(pageName) {
  if (pageName === "adminroles" && !isSuperAdmin) {
    showToast("Chỉ Super Admin mới có quyền truy cập trang này.", "error");
    return;
  }

  el.navItems.forEach((item) => item.classList.remove("active"));
  el.pages.forEach((p) => p.classList.remove("active"));

  const navItem = document.querySelector(`.nav-item[data-page="${pageName}"]`);
  const pageEl = document.getElementById(`page-${pageName}`);
  if (navItem) navItem.classList.add("active");
  if (pageEl) pageEl.classList.add("active");

  if (!pageLoadedOnce.has(pageName)) {
    pageLoadedOnce.add(pageName);
    loadPageData(pageName);
  } else {
    if (pageName === "dashboard") renderDashboard();
  }
}

function loadPageData(pageName) {
  switch (pageName) {
    case "dashboard":
      renderDashboard();
      break;
    case "artists":
      loadArtists();
      break;
    case "albums":
      loadAlbums();
      break;
    case "playlists":
      loadPlaylists();
      break;
    case "frames":
      loadFrames();
      break;
    case "users":
      loadUsers();
      break;
    case "storage":
      renderStoragePage();
      break;
    case "homepage":
      loadHomepageSettings();
      break;
    case "adminroles":
      loadAdminRoles();
      break;
  }
}

el.navItems.forEach((item) => {
  item.addEventListener("click", () => goToPage(item.dataset.page));
});

// --- TOAST ---
function showToast(msg, type = "success") {
  el.toast.textContent = msg;
  el.toast.className = `toast show ${type}`;
  setTimeout(() => el.toast.classList.remove("show"), 3500);
}

// --- AUTH GATE ---
function showScreen(name) {
  el.gateLoggedOut.style.display = name === "loggedOut" ? "block" : "none";
  el.gateForbidden.style.display = name === "forbidden" ? "block" : "none";
  el.appShell.style.display = name === "app" ? "block" : "none";
}

let isSuperAdmin = false;
let adminEmailsCache = [];

async function checkAdminAccess(email) {
  const normalizedEmail = (email || "").toLowerCase();
  if (normalizedEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
    isSuperAdmin = true;
    return true;
  }
  isSuperAdmin = false;
  try {
    const snap = await getDoc(doc(db, "adminEmails", normalizedEmail));
    return snap.exists();
  } catch (e) {
    console.error("Không kiểm tra được quyền admin:", e);
    return false;
  }
}

async function evaluateAccessForUser(user) {
  if (!user) {
    showScreen("loggedOut");
    return;
  }

  const hasAccess = await checkAdminAccess(user.email);
  if (!hasAccess) {
    el.forbiddenEmail.textContent = user.email || "(không có email)";
    showScreen("forbidden");
    return;
  }

  el.adminEmailLabel.textContent = user.email;
  const adminRolesNavItem = document.querySelector('.nav-item[data-page="adminroles"]');
  if (adminRolesNavItem) adminRolesNavItem.style.display = isSuperAdmin ? "flex" : "none";

  showScreen("app");
  loadSongList().then(() => {
    pageLoadedOnce.add("dashboard");
    renderDashboard();
  });
}

onAuthStateChanged(auth, (user) => evaluateAccessForUser(user));

const btnRetryAccess = document.getElementById("btnRetryAccess");
if (btnRetryAccess) {
  btnRetryAccess.addEventListener("click", async () => {
    btnRetryAccess.disabled = true;
    btnRetryAccess.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra...';
    await evaluateAccessForUser(auth.currentUser);
    btnRetryAccess.disabled = false;
    btnRetryAccess.innerHTML = '<i class="fa-solid fa-rotate"></i> Thử lại';
  });
}

el.btnGoogleLogin.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    showToast("Đăng nhập thất bại: " + e.message, "error");
  }
});

el.btnSignOut.addEventListener("click", () => signOut(auth));
el.btnSignOutForbidden.addEventListener("click", () => signOut(auth));

// --- DROPZONE LOGIC ---
function setupDropzone(zoneEl, inputEl, onFileSelected) {
  zoneEl.addEventListener("click", () => inputEl.click());

  inputEl.addEventListener("change", () => {
    if (inputEl.files[0]) onFileSelected(inputEl.files[0]);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      zoneEl.classList.add("dragover");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      zoneEl.classList.remove("dragover");
    }),
  );
  zoneEl.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) onFileSelected(file);
  });
}

function renderDropzoneFile(zoneEl, file, isImage) {
  zoneEl
    .querySelectorAll(".dz-icon, .dz-label, .dz-hint, .preview-img, .file-chip")
    .forEach((n) => n.remove());

  if (isImage) {
    const img = document.createElement("img");
    img.className = "preview-img";
    img.src = URL.createObjectURL(file);
    zoneEl.appendChild(img);
  }
  const chip = document.createElement("div");
  chip.className = "file-chip";
  chip.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  zoneEl.appendChild(chip);
}

function bindAudioDropzone() {
  setupDropzone(el.audioDropzone, el.audioInput, (file) => {
    if (!file.type.startsWith("audio/")) {
      showToast("Vui lòng chọn file âm thanh (mp3, wav...)", "error");
      return;
    }
    selectedAudioFile = file;
    renderDropzoneFile(el.audioDropzone, file, false);
  });
}

function bindCoverDropzone() {
  setupDropzone(el.coverDropzone, el.coverInput, (file) => {
    if (!file.type.startsWith("image/")) {
      showToast("Vui lòng chọn file ảnh (jpg, png...)", "error");
      return;
    }
    selectedCoverFile = file;
    renderDropzoneFile(el.coverDropzone, file, true);
  });
}

bindAudioDropzone();
bindCoverDropzone();

// --- NÚT LÀM MỚI ID TỰ ĐỘNG ---
el.btnRefreshId.addEventListener("click", () => {
  fillNextId();
  showToast("Đã tính lại ID tiếp theo.", "success");
});

let dupRecheckTimer = null;
function scheduleDupRecheck(renderFn) {
  clearTimeout(dupRecheckTimer);
  dupRecheckTimer = setTimeout(renderFn, 600);
}

// =========================================================================
// TAB 2 — UPLOAD ALBUM (NHIỀU FILE CÙNG LÚC)
// =========================================================================

function fileBaseName(name) {
  return name.replace(/\.[^/.]+$/, "");
}

function prettifyFileName(name) {
  const base = fileBaseName(name).replace(/[_\-]+/g, " ").trim();
  return base
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function normalizeForCompare(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function findDuplicateReason(item, otherItems) {
  const normTitle = normalizeForCompare(item.title);
  const normArtist = normalizeForCompare(item.artist);
  const normFileName = item.fileName ? normalizeForCompare(fileBaseName(item.fileName)) : "";

  for (const song of allSongsCache) {
    const songTitle = normalizeForCompare(song.title);
    const songArtist = normalizeForCompare(song.artist);
    if (normTitle && normArtist && songTitle === normTitle && songArtist === normArtist) {
      return `Đã có trong database: "${song.title} — ${song.artist}"`;
    }
  }

  for (const other of otherItems) {
    if (other === item) continue;
    const otherTitle = normalizeForCompare(other.title);
    const otherArtist = normalizeForCompare(other.artist);
    const otherFileName = other.fileName ? normalizeForCompare(fileBaseName(other.fileName)) : "";

    if (normTitle && normArtist && otherTitle === normTitle && otherArtist === normArtist) {
      return `Trùng tên bài + ca sĩ với dòng khác trong danh sách này`;
    }
    if (normFileName && otherFileName && normFileName === otherFileName) {
      return `Trùng tên file với dòng khác trong danh sách này`;
    }
  }

  return null;
}

function setupMultiDropzone(zoneEl, inputEl, onFilesSelected) {
  zoneEl.addEventListener("click", () => inputEl.click());
  inputEl.addEventListener("change", () => {
    if (inputEl.files.length) onFilesSelected(Array.from(inputEl.files));
  });
  ["dragenter", "dragover"].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      zoneEl.classList.add("dragover");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      zoneEl.classList.remove("dragover");
    }),
  );
  zoneEl.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) {
      onFilesSelected(Array.from(e.dataTransfer.files));
    }
  });
}

let bulkAudioFiles = [];
let bulkCoverFiles = [];

setupMultiDropzone(el.bulkAudioDropzone, el.bulkAudioInput, (files) => {
  bulkAudioFiles = files.filter((f) => f.type.startsWith("audio/"));
  if (bulkAudioFiles.length !== files.length) {
    showToast("Đã bỏ qua một số file không phải âm thanh.", "error");
  }
  rebuildBulkItems();
});

setupMultiDropzone(el.bulkCoverDropzone, el.bulkCoverInput, (files) => {
  bulkCoverFiles = files.filter((f) => f.type.startsWith("image/"));
  if (bulkCoverFiles.length !== files.length) {
    showToast("Đã bỏ qua một số file không phải ảnh.", "error");
  }
  rebuildBulkItems();
});

function rebuildBulkItems() {
  if (bulkAudioFiles.length === 0) {
    el.bulkTableSection.style.display = "none";
    bulkItems = [];
    return;
  }

  const sortedAudio = [...bulkAudioFiles].sort((a, b) => a.name.localeCompare(b.name));
  const sortedCover = [...bulkCoverFiles].sort((a, b) => a.name.localeCompare(b.name));

  bulkItems = sortedAudio.map((audioFile, i) => ({
    audioFile,
    coverFile: sortedCover[i] || null,
    fileName: audioFile.name,
    title: prettifyFileName(audioFile.name),
    artist: "",
    genre: "Pop",
    id: null,
    checked: true,
    duplicateReason: null,
    status: "pending",
    statusMsg: "",
  }));

  renderBulkTable();
  el.bulkTableSection.style.display = "block";
}

function renderBulkTable() {
  bulkItems.forEach((item) => {
    const reason = findDuplicateReason(item, bulkItems);
    const wasDuplicate = !!item.duplicateReason;
    item.duplicateReason = reason;
    if (reason && !wasDuplicate && !item.userTouchedCheck) {
      item.checked = false;
    }
  });

  const dupCount = bulkItems.filter((it) => it.duplicateReason).length;
  el.bulkFileCount.textContent = `${bulkItems.length} bài hát sẵn sàng`;
  if (dupCount > 0) {
    el.bulkDupSummary.style.display = "inline-flex";
    el.bulkDupSummary.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${dupCount} bài có thể bị trùng — đã tự bỏ tích`;
  } else {
    el.bulkDupSummary.style.display = "none";
  }

  el.btnApplyCoverAll.style.display = bulkCoverFiles.length === 1 && bulkItems.length > 1 ? "inline-block" : "none";
  el.dragReorderHint.style.display = bulkItems.length > 1 ? "block" : "none";

  let nextId = computeNextId();
  const usedIds = new Set(allSongsCache.map((s) => Number(s.id)));

  el.bulkTableBody.innerHTML = "";
  bulkItems.forEach((item, idx) => {
    if (item.id === null) {
      while (usedIds.has(nextId)) nextId++;
      item.id = nextId;
      usedIds.add(nextId);
      nextId++;
    }

    const row = document.createElement("div");
    row.className = "bulk-row" + (item.duplicateReason ? " is-duplicate" : "");
    row.draggable = true;
    row.dataset.idx = idx;
    const coverPreview = item.coverFile
      ? `<img class="bulk-thumb" src="${URL.createObjectURL(item.coverFile)}" />`
      : `<div class="bulk-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)"><i class="fa-solid fa-image"></i></div>`;

    row.innerHTML = `
      <div class="bulk-drag-handle" title="Kéo để đổi thứ tự">
        <i class="fa-solid fa-grip-vertical"></i>
        <div class="bulk-order-num">${idx + 1}</div>
      </div>
      <input type="checkbox" class="bulk-checkbox" ${item.checked ? "checked" : ""} title="Bỏ tích để không upload bài này" />
      ${coverPreview}
      <div>
        <input type="text" class="bulk-title" value="${escapeHtml(item.title)}" />
        ${item.duplicateReason ? `<div class="dup-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(item.duplicateReason)}</div>` : ""}
      </div>
      <input type="text" class="bulk-artist" value="${escapeHtml(item.artist)}" placeholder="Ca sĩ" />
      <select class="bulk-genre">
        <option value="Pop">Pop</option>
        <option value="Lofi Chill">Lofi Chill</option>
        <option value="EDM">EDM</option>
        <option value="Rap Việt">Rap Việt</option>
        <option value="Ballad">Ballad</option>
        <option value="Khác">Khác</option>
      </select>
      <input type="number" class="bulk-id" value="${item.id}" />
      <button type="button" class="icon-btn danger bulk-remove" title="Bỏ bài này">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    row.querySelector(".bulk-genre").value = item.genre;

    row.querySelector(".bulk-checkbox").addEventListener("change", (e) => {
      bulkItems[idx].checked = e.target.checked;
      bulkItems[idx].userTouchedCheck = true;
    });
    row.querySelector(".bulk-title").addEventListener("input", (e) => {
      bulkItems[idx].title = e.target.value;
      scheduleDupRecheck(renderBulkTable);
    });
    row.querySelector(".bulk-artist").addEventListener("input", (e) => {
      bulkItems[idx].artist = e.target.value;
      scheduleDupRecheck(renderBulkTable);
    });
    row.querySelector(".bulk-genre").addEventListener("change", (e) => {
      bulkItems[idx].genre = e.target.value;
    });
    row.querySelector(".bulk-id").addEventListener("input", (e) => {
      bulkItems[idx].id = Number(e.target.value);
      bulkItems[idx].userTouchedId = true;
    });
    row.querySelector(".bulk-remove").addEventListener("click", () => {
      bulkItems.splice(idx, 1);
      renderBulkTable();
    });

    row.addEventListener("dragstart", () => {
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      el.bulkTableBody.querySelectorAll(".bulk-row").forEach((r) => {
        r.classList.remove("drag-over-top", "drag-over-bottom");
      });
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      const draggingRow = el.bulkTableBody.querySelector(".bulk-row.dragging");
      if (!draggingRow || draggingRow === row) return;
      const rect = row.getBoundingClientRect();
      const isAfter = e.clientY - rect.top > rect.height / 2;
      row.classList.toggle("drag-over-bottom", isAfter);
      row.classList.toggle("drag-over-top", !isAfter);
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over-top", "drag-over-bottom");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const fromIdx = Number(el.bulkTableBody.querySelector(".bulk-row.dragging")?.dataset.idx);
      const toIdx = Number(row.dataset.idx);
      if (isNaN(fromIdx) || fromIdx === toIdx) return;

      const isAfter = row.classList.contains("drag-over-bottom");
      const [moved] = bulkItems.splice(fromIdx, 1);
      let insertAt = toIdx;
      if (fromIdx < toIdx) insertAt -= 1;
      if (isAfter) insertAt += 1;
      bulkItems.splice(Math.max(0, insertAt), 0, moved);

      renumberBulkItemIds();
      renderBulkTable();
    });

    el.bulkTableBody.appendChild(row);
  });
}

function renumberBulkItemIds() {
  let nextId = computeNextId();
  const usedIds = new Set(allSongsCache.map((s) => Number(s.id)));
  bulkItems.forEach((item) => {
    if (item.userTouchedId) usedIds.add(item.id);
  });

  bulkItems.forEach((item) => {
    if (item.userTouchedId) return;
    while (usedIds.has(nextId)) nextId++;
    item.id = nextId;
    usedIds.add(nextId);
    nextId++;
  });
}

el.btnApplyArtistAll.addEventListener("click", () => {
  const artist = el.bulkArtistAll.value.trim();
  if (!artist) return;
  bulkItems.forEach((item) => (item.artist = artist));
  renderBulkTable();
});

el.btnApplyGenreAll.addEventListener("click", () => {
  const genre = el.bulkGenreAll.value;
  if (!genre) return;
  bulkItems.forEach((item) => (item.genre = genre));
  renderBulkTable();
});

el.btnApplyCoverAll.addEventListener("click", () => {
  if (bulkCoverFiles.length !== 1) return;
  const sharedCover = bulkCoverFiles[0];
  bulkItems.forEach((item) => (item.coverFile = sharedCover));
  showToast("Đã áp dụng ảnh này cho tất cả các bài hát.", "success");
  renderBulkTable();
});

el.btnBulkSubmit.addEventListener("click", async () => {
  const itemsToUpload = bulkItems.filter((it) => it.checked);

  if (itemsToUpload.length === 0) {
    showToast("Chưa có bài hát nào được tích để lưu.", "error");
    return;
  }

  const missingInfo = itemsToUpload.some((it) => !it.title.trim() || !it.artist.trim());
  if (missingInfo) {
    showToast("Vui lòng điền đủ tên bài hát và ca sĩ cho các dòng đã tích.", "error");
    return;
  }
  const idSet = new Set();
  for (const it of itemsToUpload) {
    if (idSet.has(it.id)) {
      showToast(`ID ${it.id} bị trùng trong danh sách đang upload. Hãy sửa lại.`, "error");
      return;
    }
    idSet.add(it.id);
  }

  el.btnBulkSubmit.disabled = true;
  let successCount = 0;

  for (let i = 0; i < itemsToUpload.length; i++) {
    const item = itemsToUpload[i];
    el.bulkProgressText.textContent = `Đang xử lý ${i + 1}/${itemsToUpload.length}: ${item.title}...`;
    try {
      const audioResult = await uploadToCloudinary(item.audioFile, "video", () => {});
      let coverResult = { url: "", publicId: "" };
      if (item.coverFile) {
        coverResult = await uploadToCloudinary(item.coverFile, "image", () => {});
      }

      await addDoc(collection(db, "songs"), {
        id: item.id,
        title: item.title.trim(),
        artist: item.artist.trim(),
        genre: item.genre,
        audioUrl: audioResult.url,
        audioPublicId: audioResult.publicId,
        coverUrl: coverResult.url,
        coverPublicId: coverResult.publicId,
        lyrics: "",
        createdAt: Date.now(),
        createdAtServer: serverTimestamp(),
      });

      successCount++;
    } catch (e) {
      console.error(`Lỗi upload "${item.title}":`, e);
      showToast(`Lỗi khi lưu "${item.title}": ${e.message}`, "error");
    }
  }

  el.bulkProgressText.textContent = `Hoàn tất: ${successCount}/${itemsToUpload.length} bài hát đã lưu thành công.`;
  showToast(`Đã thêm ${successCount}/${itemsToUpload.length} bài hát.`, "success");
  el.btnBulkSubmit.disabled = false;

  bulkItems = [];
  bulkAudioFiles = [];
  bulkCoverFiles = [];
  el.bulkTableSection.style.display = "none";
  el.bulkAudioInput.value = "";
  el.bulkCoverInput.value = "";
  loadSongList();
});

// =========================================================================
// TAB 3 — NHẬP TỪ CSV/EXCEL
// =========================================================================

setupDropzone(el.csvDropzone, el.csvInput, (file) => {
  parseCsvOrExcelFile(file);
});

function parseCsvOrExcelFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = e.target.result;
      const workbook = XLSX.read(data, { type: "array", cellDates: false });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (json.length === 0) {
        showToast("File không có dữ liệu.", "error");
        return;
      }

      csvRows = json;
      csvHeaders = Object.keys(json[0]);
      setupCsvMapping();
      renderCsvPreview();
      el.csvMappingSection.style.display = "block";
      showToast(`Đã đọc ${csvRows.length} dòng từ file.`, "success");
    } catch (err) {
      console.error(err);
      showToast("Không đọc được file. Hãy chắc chắn đây là file CSV hoặc Excel hợp lệ.", "error");
    }
  };
  reader.onerror = () => showToast("Lỗi khi đọc file.", "error");
  reader.readAsArrayBuffer(file);
}

function guessColumn(selectEl, candidates) {
  selectEl.innerHTML = `<option value="">— Không dùng —</option>`;
  csvHeaders.forEach((h) => {
    const opt = document.createElement("option");
    opt.value = h;
    opt.textContent = h;
    selectEl.appendChild(opt);
  });
  const lowerHeaders = csvHeaders.map((h) => h.toLowerCase());
  for (const cand of candidates) {
    const idx = lowerHeaders.indexOf(cand);
    if (idx !== -1) {
      selectEl.value = csvHeaders[idx];
      return;
    }
  }
}

function setupCsvMapping() {
  guessColumn(el.mapTitle, ["title", "tên bài hát", "ten bai hat", "name"]);
  guessColumn(el.mapArtist, ["artist", "ca sĩ", "ca si", "singer"]);
  guessColumn(el.mapCover, ["cover", "image", "ảnh", "anh", "cover_url", "coverurl"]);
  guessColumn(el.mapSrc, ["src", "audio", "mp3", "audio_url", "audiourl", "url"]);
  guessColumn(el.mapId, ["id", "stt"]);

  [el.mapTitle, el.mapArtist, el.mapCover, el.mapSrc, el.mapId].forEach((sel) => {
    sel.addEventListener("change", renderCsvPreview);
  });
}

function renderCsvPreview() {
  const cols = csvHeaders;
  let html = "<thead><tr>" + cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("") + "</tr></thead><tbody>";
  csvRows.slice(0, 8).forEach((row) => {
    html += "<tr>" + cols.map((c) => `<td>${escapeHtml(String(row[c] ?? ""))}</td>`).join("") + "</tr>";
  });
  html += "</tbody>";
  el.csvPreviewTable.innerHTML = html;

  const titleCol = el.mapTitle.value;
  const artistCol = el.mapArtist.value;
  const coverCol = el.mapCover.value;
  const srcCol = el.mapSrc.value;

  let missing = 0;
  if (titleCol && artistCol && coverCol && srcCol) {
    csvRows.forEach((row) => {
      if (!row[titleCol] || !row[artistCol] || !row[coverCol] || !row[srcCol]) missing++;
    });
  }

  el.csvSummary.innerHTML = `
    <span class="csv-summary-pill"><i class="fa-solid fa-list"></i> ${csvRows.length} dòng trong file (xem trước 8 dòng đầu)</span>
    ${missing > 0 ? `<span class="csv-summary-pill warn"><i class="fa-solid fa-triangle-exclamation"></i> ${missing} dòng thiếu dữ liệu bắt buộc — sẽ bị bỏ qua khi nhập</span>` : ""}
  `;

  detectCsvDuplicates();
}

function detectCsvDuplicates() {
  const titleCol = el.mapTitle.value;
  const artistCol = el.mapArtist.value;
  if (!titleCol || !artistCol) {
    el.csvDupSection.style.display = "none";
    return;
  }

  const dbKeys = new Map();
  allSongsCache.forEach((s) => {
    const key = `${normalizeForCompare(s.title)}|||${normalizeForCompare(s.artist)}`;
    dbKeys.set(key, `${s.title} — ${s.artist}`);
  });

  const fileKeyCount = new Map();
  csvRows.forEach((row) => {
    const key = `${normalizeForCompare(row[titleCol])}|||${normalizeForCompare(row[artistCol])}`;
    fileKeyCount.set(key, (fileKeyCount.get(key) || 0) + 1);
  });

  csvDupReasons = new Map();
  csvRows.forEach((row, idx) => {
    const key = `${normalizeForCompare(row[titleCol])}|||${normalizeForCompare(row[artistCol])}`;
    if (!key || key === "|||") return;

    if (dbKeys.has(key)) {
      csvDupReasons.set(idx, `Đã có trong database: "${dbKeys.get(key)}"`);
    } else if (fileKeyCount.get(key) > 1) {
      csvDupReasons.set(idx, `Trùng với dòng khác trong file (xuất hiện ${fileKeyCount.get(key)} lần)`);
    }
  });

  const newSkipMap = new Map();
  csvDupReasons.forEach((reason, idx) => {
    newSkipMap.set(idx, csvSkipMap.has(idx) ? csvSkipMap.get(idx) : el.csvSkipAllDup.checked);
  });
  csvSkipMap = newSkipMap;

  renderCsvDupTable(titleCol, artistCol);
}

function renderCsvDupTable(titleCol, artistCol) {
  const dupIndexes = Array.from(csvDupReasons.keys());

  if (dupIndexes.length === 0) {
    el.csvDupSection.style.display = "none";
    return;
  }

  el.csvDupSection.style.display = "block";
  el.csvDupCount.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${dupIndexes.length} dòng nghi trùng`;

  let html = `<thead><tr>
    <th>Bỏ qua</th><th>Tên bài hát</th><th>Ca sĩ</th><th>Lý do</th>
  </tr></thead><tbody>`;

  dupIndexes.forEach((idx) => {
    const row = csvRows[idx];
    const skip = csvSkipMap.get(idx);
    html += `<tr>
      <td><input type="checkbox" class="csv-dup-row-checkbox" data-idx="${idx}" ${skip ? "checked" : ""} /></td>
      <td>${escapeHtml(String(row[titleCol] ?? ""))}</td>
      <td>${escapeHtml(String(row[artistCol] ?? ""))}</td>
      <td style="color: var(--danger); font-size: 0.78rem">${escapeHtml(csvDupReasons.get(idx))}</td>
    </tr>`;
  });
  html += "</tbody>";
  el.csvDupTable.innerHTML = html;

  el.csvDupTable.querySelectorAll(".csv-dup-row-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.idx);
      csvSkipMap.set(idx, e.target.checked);
    });
  });
}

el.csvSkipAllDup.addEventListener("change", (e) => {
  csvDupReasons.forEach((_, idx) => csvSkipMap.set(idx, e.target.checked));
  const titleCol = el.mapTitle.value;
  const artistCol = el.mapArtist.value;
  renderCsvDupTable(titleCol, artistCol);
});

el.btnCsvImport.addEventListener("click", async () => {
  const titleCol = el.mapTitle.value;
  const artistCol = el.mapArtist.value;
  const coverCol = el.mapCover.value;
  const srcCol = el.mapSrc.value;
  const idCol = el.mapId.value;
  const defaultGenre = el.mapGenreDefault.value;

  if (!titleCol || !artistCol || !coverCol || !srcCol) {
    showToast("Vui lòng chọn đủ cột: tên bài hát, ca sĩ, ảnh bìa, link mp3.", "error");
    return;
  }

  const usedIds = new Set(allSongsCache.map((s) => Number(s.id)));
  let nextId = computeNextId();

  const validRows = csvRows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => row[titleCol] && row[artistCol] && row[coverCol] && row[srcCol]);

  const skippedAsDuplicate = validRows.filter(({ idx }) => csvSkipMap.get(idx)).length;
  const rowsToImport = validRows.filter(({ idx }) => !csvSkipMap.get(idx));

  if (rowsToImport.length === 0) {
    showToast("Không có dòng nào để nhập (có thể tất cả đã bị bỏ qua vì trùng).", "error");
    return;
  }

  el.btnCsvImport.disabled = true;

  let successCount = 0;
  let failCount = 0;
  const BATCH_SIZE = 400;

  for (let start = 0; start < rowsToImport.length; start += BATCH_SIZE) {
    const chunk = rowsToImport.slice(start, start + BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach(({ row }) => {
      let songId = idCol ? Number(row[idCol]) : NaN;
      if (isNaN(songId) || usedIds.has(songId)) {
        while (usedIds.has(nextId)) nextId++;
        songId = nextId;
        nextId++;
      }
      usedIds.add(songId);

      const newDocRef = doc(collection(db, "songs"));
      batch.set(newDocRef, {
        id: songId,
        title: String(row[titleCol]).trim(),
        artist: String(row[artistCol]).trim(),
        genre: defaultGenre,
        audioUrl: String(row[srcCol]).trim(),
        coverUrl: String(row[coverCol]).trim(),
        lyrics: "",
        createdAt: Date.now(),
        createdAtServer: serverTimestamp(),
      });
    });

    el.csvProgressText.textContent = `Đang nhập ${Math.min(start + BATCH_SIZE, rowsToImport.length)}/${rowsToImport.length} bài hát...`;

    try {
      await batch.commit();
      successCount += chunk.length;
    } catch (e) {
      console.error(e);
      failCount += chunk.length;
    }
  }

  el.csvProgressText.textContent = `Hoàn tất: ${successCount} bài hát đã nhập thành công${failCount > 0 ? `, ${failCount} bài lỗi` : ""}${skippedAsDuplicate > 0 ? `, ${skippedAsDuplicate} bài đã bỏ qua vì trùng` : ""}.`;
  showToast(`Đã nhập ${successCount} bài hát từ file.`, "success");
  el.btnCsvImport.disabled = false;

  csvRows = [];
  csvHeaders = [];
  csvSkipMap = new Map();
  csvDupReasons = new Map();
  el.csvMappingSection.style.display = "none";
  el.csvDupSection.style.display = "none";
  el.csvInput.value = "";
  loadSongList();
});

// =========================================================================
// DASHBOARD
// =========================================================================

function renderDashboard() {
  el.statSongCount.textContent = allSongsCache.length.toLocaleString("vi-VN");

  const uniqueArtistNames = new Set(
    allSongsCache.map((s) => normalizeForCompare(s.artist)).filter(Boolean),
  );
  const artistCount = artistsCache.length > 0 ? artistsCache.length : uniqueArtistNames.size;
  el.statArtistCount.textContent = artistCount.toLocaleString("vi-VN");

  el.statAlbumCount.textContent = albumsCache.length.toLocaleString("vi-VN");

  const totalPlays = allSongsCache.reduce((sum, s) => sum + (Number(s.playCount) || 0), 0);
  el.statTotalPlays.textContent = totalPlays.toLocaleString("vi-VN");

  const topSongs = [...allSongsCache]
    .sort((a, b) => (Number(b.playCount) || 0) - (Number(a.playCount) || 0))
    .slice(0, 10);

  el.topSongsList.innerHTML = topSongs.length
    ? topSongs
        .map(
          (s, i) => `
        <div class="top-list-row">
          <div class="top-list-rank">${i + 1}</div>
          <img src="${s.cover || s.coverUrl || ""}" onerror="this.style.opacity=0" />
          <div class="top-list-info">
            <div class="t-title">${escapeHtml(s.title)}</div>
            <div class="t-sub">${escapeHtml(s.artist)}</div>
          </div>
          <div class="top-list-count">${(Number(s.playCount) || 0).toLocaleString("vi-VN")} nghe</div>
        </div>`,
        )
        .join("")
    : `<div class="hint-note" style="margin:0">Chưa có dữ liệu lượt nghe. Lượt nghe được ghi nhận khi người dùng nghe nhạc trên trang chính.</div>`;

  const artistPlayMap = new Map();
  allSongsCache.forEach((s) => {
    const key = normalizeForCompare(s.artist);
    if (!key) return;
    if (!artistPlayMap.has(key)) {
      artistPlayMap.set(key, { name: s.artist, plays: 0, songCount: 0 });
    }
    const entry = artistPlayMap.get(key);
    entry.plays += Number(s.playCount) || 0;
    entry.songCount += 1;
  });
  const topArtists = Array.from(artistPlayMap.values())
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  el.topArtistsList.innerHTML = topArtists.length
    ? topArtists
        .map(
          (a, i) => `
        <div class="top-list-row">
          <div class="top-list-rank">${i + 1}</div>
          <div class="top-list-info">
            <div class="t-title">${escapeHtml(a.name)}</div>
            <div class="t-sub">${a.songCount} bài hát</div>
          </div>
          <div class="top-list-count">${a.plays.toLocaleString("vi-VN")} nghe</div>
        </div>`,
        )
        .join("")
    : `<div class="hint-note" style="margin:0">Chưa có dữ liệu.</div>`;

  const recentSongs = [...allSongsCache]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 8);

  el.recentSongsList.innerHTML = recentSongs.length
    ? recentSongs
        .map(
          (s) => `
        <div class="top-list-row">
          <img src="${s.cover || s.coverUrl || ""}" onerror="this.style.opacity=0" />
          <div class="top-list-info">
            <div class="t-title">${escapeHtml(s.title)}</div>
            <div class="t-sub">${escapeHtml(s.artist)} • ${escapeHtml(s.genre || "Pop")}</div>
          </div>
        </div>`,
        )
        .join("")
    : `<div class="hint-note" style="margin:0">Chưa có bài hát nào.</div>`;
}

// =========================================================================
// ARTISTS (Quản lý nghệ sĩ)
// =========================================================================

async function loadArtists() {
  try {
    const snap = await getDocs(collection(db, "artists"));
    artistsCache = [];
    snap.forEach((d) => artistsCache.push({ docId: d.id, ...d.data() }));
    renderArtistGrid();
  } catch (e) {
    console.error(e);
    showToast("Không tải được danh sách nghệ sĩ: " + e.message, "error");
  }
}

function renderArtistGrid(filterText = "") {
  const q = normalizeForCompare(filterText);
  let list = artistsCache;

  if (list.length === 0 && allSongsCache.length > 0) {
    const inferred = new Map();
    allSongsCache.forEach((s) => {
      const key = normalizeForCompare(s.artist);
      if (!key || inferred.has(key)) return;
      inferred.set(key, { name: s.artist, inferred: true, songCount: 0, avatarUrl: s.cover || s.coverUrl });
    });
    allSongsCache.forEach((s) => {
      const key = normalizeForCompare(s.artist);
      if (inferred.has(key)) inferred.get(key).songCount++;
    });
    list = Array.from(inferred.values());
  }

  if (q) {
    list = list.filter((a) => normalizeForCompare(a.name).includes(q));
  }

  el.artistEmptyState.style.display = list.length ? "none" : "block";
  el.artistGrid.innerHTML = list
    .map((a, i) => {
      const songCount = a.inferred
        ? a.songCount
        : allSongsCache.filter((s) => normalizeForCompare(s.artist) === normalizeForCompare(a.name)).length;
      return `
        <div class="entity-card" data-idx="${i}" data-inferred="${!!a.inferred}">
          <img src="${a.avatarUrl || ""}" onerror="this.style.opacity=0" />
          <div class="e-name">${escapeHtml(a.name)}</div>
          <div class="e-sub">${songCount} bài hát${a.inferred ? " • chưa tạo hồ sơ" : ""}</div>
        </div>`;
    })
    .join("");

  el.artistGrid.querySelectorAll(".entity-card").forEach((card, i) => {
    card.addEventListener("click", () => openArtistModal(list[i]));
  });
}

el.searchArtists.addEventListener("input", (e) => renderArtistGrid(e.target.value));
el.btnAddArtist.addEventListener("click", () => openArtistModal(null));

function openArtistModal(artist) {
  const isEdit = !!(artist && !artist.inferred);
  const isInferredPromote = !!(artist && artist.inferred);

  el.modalBox.innerHTML = `
    <h3>
      ${isEdit ? "Sửa nghệ sĩ" : "Thêm nghệ sĩ"}
      <span class="modal-close" id="modalCloseBtn"><i class="fa-solid fa-xmark"></i></span>
    </h3>
    <div class="field">
      <label>Tên nghệ sĩ *</label>
      <input type="text" id="modalArtistName" value="${escapeHtml(artist?.name || "")}" />
    </div>
    <div class="field">
      <label>Ảnh đại diện (URL ảnh — dán link Cloudinary có sẵn, hoặc để trống)</label>
      <input type="text" id="modalArtistAvatar" value="${escapeHtml(artist?.avatarUrl || "")}" placeholder="https://res.cloudinary.com/..." />
    </div>
    <div class="field">
      <label>Tiểu sử (tuỳ chọn)</label>
      <textarea id="modalArtistBio" style="min-height:70px">${escapeHtml(artist?.bio || "")}</textarea>
    </div>
    <div class="submit-row" style="justify-content: space-between">
      ${isEdit ? `<button class="btn btn-ghost" id="modalDeleteBtn" style="color: var(--danger)"><i class="fa-solid fa-trash"></i> Xóa</button>` : "<div></div>"}
      <button class="btn btn-primary" id="modalSaveBtn">
        <i class="fa-solid fa-floppy-disk"></i> ${isInferredPromote ? "Tạo hồ sơ nghệ sĩ" : "Lưu"}
      </button>
    </div>
  `;
  openModal();

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  document.getElementById("modalSaveBtn").addEventListener("click", async () => {
    const name = document.getElementById("modalArtistName").value.trim();
    const avatarUrl = document.getElementById("modalArtistAvatar").value.trim();
    const bio = document.getElementById("modalArtistBio").value.trim();
    if (!name) {
      showToast("Vui lòng nhập tên nghệ sĩ.", "error");
      return;
    }
    try {
      if (isEdit) {
        await updateDoc(doc(db, "artists", artist.docId), { name, avatarUrl, bio });
      } else {
        await addDoc(collection(db, "artists"), {
          name,
          avatarUrl,
          bio,
          createdAt: Date.now(),
          createdAtServer: serverTimestamp(),
        });
      }
      showToast(`Đã lưu nghệ sĩ "${name}".`, "success");
      closeModal();
      loadArtists();
    } catch (e) {
      showToast("Lỗi khi lưu: " + e.message, "error");
    }
  });

  if (isEdit) {
    document.getElementById("modalDeleteBtn").addEventListener("click", async () => {
      if (!confirm(`Xóa hồ sơ nghệ sĩ "${artist.name}"? Các bài hát của nghệ sĩ này vẫn giữ nguyên, chỉ xóa hồ sơ riêng.`)) return;
      try {
        await deleteDoc(doc(db, "artists", artist.docId));
        showToast("Đã xóa nghệ sĩ.", "success");
        closeModal();
        loadArtists();
      } catch (e) {
        showToast("Lỗi khi xóa: " + e.message, "error");
      }
    });
  }
}

// =========================================================================
// ALBUMS (Quản lý album, kéo-thả sắp xếp tracklist)
// =========================================================================

async function loadAlbums() {
  try {
    const snap = await getDocs(collection(db, "albums"));
    albumsCache = [];
    snap.forEach((d) => albumsCache.push({ docId: d.id, ...d.data() }));
    renderAlbumGrid();
  } catch (e) {
    console.error(e);
    showToast("Không tải được danh sách album: " + e.message, "error");
  }
}

function renderAlbumGrid(filterText = "") {
  const q = normalizeForCompare(filterText);
  let list = albumsCache;
  if (q) list = list.filter((a) => normalizeForCompare(a.title).includes(q));

  el.albumEmptyState.style.display = list.length ? "none" : "block";
  el.albumGrid.innerHTML = list
    .map(
      (a, i) => `
      <div class="entity-card is-album" data-idx="${i}">
        <img src="${a.coverUrl || ""}" onerror="this.style.opacity=0" />
        <div class="e-name">${escapeHtml(a.title)}</div>
        <div class="e-sub">${(a.songIds || []).length} bài hát</div>
      </div>`,
    )
    .join("");

  el.albumGrid.querySelectorAll(".entity-card").forEach((card, i) => {
    card.addEventListener("click", () => openAlbumModal(list[i]));
  });
}

el.searchAlbums.addEventListener("input", (e) => renderAlbumGrid(e.target.value));
el.btnAddAlbum.addEventListener("click", () => openAlbumModal(null));

function openAlbumModal(album) {
  const isEdit = !!album;
  const songIds = album?.songIds || [];

  el.modalBox.innerHTML = `
    <h3>
      ${isEdit ? "Sửa album" : "Tạo album"}
      <span class="modal-close" id="modalCloseBtn"><i class="fa-solid fa-xmark"></i></span>
    </h3>
    <div class="field">
      <label>Tên album *</label>
      <input type="text" id="modalAlbumTitle" value="${escapeHtml(album?.title || "")}" />
    </div>
    <div class="field">
      <label>Nghệ sĩ</label>
      <input type="text" id="modalAlbumArtist" value="${escapeHtml(album?.artist || "")}" />
    </div>
    <div class="field">
      <label>Ảnh bìa album (URL — dán link Cloudinary có sẵn)</label>
      <input type="text" id="modalAlbumCover" value="${escapeHtml(album?.coverUrl || "")}" placeholder="https://res.cloudinary.com/..." />
    </div>
    <div class="field">
      <label>Thêm bài hát vào album</label>
      <select id="modalAlbumAddSong">
        <option value="">— Chọn bài hát để thêm —</option>
        ${allSongsCache
          .filter((s) => !songIds.includes(s.docId))
          .map((s) => `<option value="${s.docId}">${escapeHtml(s.title)} — ${escapeHtml(s.artist)}</option>`)
          .join("")}
      </select>
    </div>
    <label style="font-size: 0.82rem; color: var(--text-dim); font-weight: 600; display:block; margin-bottom: 6px">
      Danh sách bài hát trong album (kéo-thả để đổi thứ tự)
    </label>
    <div class="tracklist" id="modalTracklist"></div>
    <div class="submit-row" style="justify-content: space-between; margin-top: 14px">
      ${isEdit ? `<button class="btn btn-ghost" id="modalDeleteBtn" style="color: var(--danger)"><i class="fa-solid fa-trash"></i> Xóa album</button>` : "<div></div>"}
      <button class="btn btn-primary" id="modalSaveBtn">
        <i class="fa-solid fa-floppy-disk"></i> Lưu
      </button>
    </div>
  `;
  openModal();

  let currentTrackIds = [...songIds];
  renderTracklist(currentTrackIds);

  function renderTracklist(ids) {
    const tlEl = document.getElementById("modalTracklist");
    if (ids.length === 0) {
      tlEl.innerHTML = `<div class="hint-note" style="margin:0">Chưa có bài hát nào trong album.</div>`;
      return;
    }
    tlEl.innerHTML = ids
      .map((id) => {
        const song = allSongsCache.find((s) => s.docId === id);
        if (!song) return "";
        return `
          <div class="tracklist-item" draggable="true" data-id="${id}">
            <i class="fa-solid fa-grip-vertical drag-handle"></i>
            <img src="${song.cover || song.coverUrl || ""}" onerror="this.style.opacity=0" />
            <div class="tl-title">${escapeHtml(song.title)} — ${escapeHtml(song.artist)}</div>
            <button type="button" class="icon-btn danger" data-remove="${id}" style="width:28px;height:28px">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>`;
      })
      .join("");

    let dragSrcId = null;
    tlEl.querySelectorAll(".tracklist-item").forEach((item) => {
      item.addEventListener("dragstart", () => {
        dragSrcId = item.dataset.id;
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => item.classList.remove("dragging"));
      item.addEventListener("dragover", (e) => e.preventDefault());
      item.addEventListener("drop", (e) => {
        e.preventDefault();
        const targetId = item.dataset.id;
        if (dragSrcId === targetId) return;
        const fromIdx = currentTrackIds.indexOf(dragSrcId);
        const toIdx = currentTrackIds.indexOf(targetId);
        currentTrackIds.splice(fromIdx, 1);
        currentTrackIds.splice(toIdx, 0, dragSrcId);
        renderTracklist(currentTrackIds);
      });
      item.querySelector("[data-remove]").addEventListener("click", () => {
        currentTrackIds = currentTrackIds.filter((id) => id !== item.dataset.id);
        renderTracklist(currentTrackIds);
      });
    });
  }

  document.getElementById("modalAlbumAddSong").addEventListener("change", (e) => {
    const songId = e.target.value;
    if (songId && !currentTrackIds.includes(songId)) {
      currentTrackIds.push(songId);
      renderTracklist(currentTrackIds);
      e.target.value = "";
    }
  });

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  document.getElementById("modalSaveBtn").addEventListener("click", async () => {
    const title = document.getElementById("modalAlbumTitle").value.trim();
    const artist = document.getElementById("modalAlbumArtist").value.trim();
    const coverUrl = document.getElementById("modalAlbumCover").value.trim();
    if (!title) {
      showToast("Vui lòng nhập tên album.", "error");
      return;
    }
    try {
      const payload = { title, artist, coverUrl, songIds: currentTrackIds };
      if (isEdit) {
        await updateDoc(doc(db, "albums", album.docId), payload);
      } else {
        await addDoc(collection(db, "albums"), {
          ...payload,
          createdAt: Date.now(),
          createdAtServer: serverTimestamp(),
        });
      }
      showToast(`Đã lưu album "${title}".`, "success");
      closeModal();
      loadAlbums();
    } catch (e) {
      showToast("Lỗi khi lưu: " + e.message, "error");
    }
  });

  if (isEdit) {
    document.getElementById("modalDeleteBtn").addEventListener("click", async () => {
      if (!confirm(`Xóa album "${album.title}"? Các bài hát bên trong vẫn giữ nguyên, chỉ xóa album.`)) return;
      try {
        await deleteDoc(doc(db, "albums", album.docId));
        showToast("Đã xóa album.", "success");
        closeModal();
        loadAlbums();
      } catch (e) {
        showToast("Lỗi khi xóa: " + e.message, "error");
      }
    });
  }
}

// =========================================================================
// PLAYLISTS (Playlist nổi bật do admin tạo)
// =========================================================================

async function loadPlaylists() {
  try {
    const snap = await getDocs(collection(db, "playlists"));
    playlistsCache = [];
    snap.forEach((d) => playlistsCache.push({ docId: d.id, ...d.data() }));
    renderPlaylistGrid();
  } catch (e) {
    console.error(e);
    showToast("Không tải được danh sách playlist: " + e.message, "error");
  }
}

function renderPlaylistGrid() {
  el.playlistEmptyState.style.display = playlistsCache.length ? "none" : "block";
  el.playlistGrid.innerHTML = playlistsCache
    .map(
      (p, i) => `
      <div class="entity-card" data-idx="${i}">
        <img src="${p.coverUrl || ""}" onerror="this.style.opacity=0" />
        <div class="e-name">${escapeHtml(p.title)}</div>
        <div class="e-sub">${(p.songIds || []).length} bài hát${p.pinned ? " • Đã ghim" : ""}</div>
      </div>`,
    )
    .join("");

  el.playlistGrid.querySelectorAll(".entity-card").forEach((card, i) => {
    card.addEventListener("click", () => openPlaylistModal(playlistsCache[i]));
  });
}

el.btnAddPlaylist.addEventListener("click", () => openPlaylistModal(null));

function openPlaylistModal(playlist) {
  const isEdit = !!playlist;
  const songIds = playlist?.songIds || [];

  el.modalBox.innerHTML = `
    <h3>
      ${isEdit ? "Sửa playlist" : "Tạo playlist"}
      <span class="modal-close" id="modalCloseBtn"><i class="fa-solid fa-xmark"></i></span>
    </h3>
    <div class="field">
      <label>Tên playlist *</label>
      <input type="text" id="modalPlTitle" value="${escapeHtml(playlist?.title || "")}" placeholder="Ví dụ: Top Hits, Chill Cuối Tuần..." />
    </div>
    <div class="field">
      <label>Ảnh bìa playlist (URL)</label>
      <input type="text" id="modalPlCover" value="${escapeHtml(playlist?.coverUrl || "")}" placeholder="https://res.cloudinary.com/..." />
    </div>
    <div class="field" style="display:flex; align-items:center; gap:8px">
      <input type="checkbox" id="modalPlPinned" ${playlist?.pinned ? "checked" : ""} class="bulk-checkbox" style="margin:0" />
      <label style="margin:0" for="modalPlPinned">Ghim lên trang chủ</label>
    </div>
    <div class="field">
      <label>Thêm bài hát</label>
      <select id="modalPlAddSong">
        <option value="">— Chọn bài hát để thêm —</option>
        ${allSongsCache
          .filter((s) => !songIds.includes(s.docId))
          .map((s) => `<option value="${s.docId}">${escapeHtml(s.title)} — ${escapeHtml(s.artist)}</option>`)
          .join("")}
      </select>
    </div>
    <div class="tracklist" id="modalPlTracklist"></div>
    <div class="submit-row" style="justify-content: space-between; margin-top: 14px">
      ${isEdit ? `<button class="btn btn-ghost" id="modalDeleteBtn" style="color: var(--danger)"><i class="fa-solid fa-trash"></i> Xóa playlist</button>` : "<div></div>"}
      <button class="btn btn-primary" id="modalSaveBtn">
        <i class="fa-solid fa-floppy-disk"></i> Lưu
      </button>
    </div>
  `;
  openModal();

  let currentTrackIds = [...songIds];
  renderPlTracklist(currentTrackIds);

  function renderPlTracklist(ids) {
    const tlEl = document.getElementById("modalPlTracklist");
    if (ids.length === 0) {
      tlEl.innerHTML = `<div class="hint-note" style="margin:0">Chưa có bài hát nào.</div>`;
      return;
    }
    tlEl.innerHTML = ids
      .map((id) => {
        const song = allSongsCache.find((s) => s.docId === id);
        if (!song) return "";
        return `
          <div class="tracklist-item" data-id="${id}">
            <img src="${song.cover || song.coverUrl || ""}" onerror="this.style.opacity=0" />
            <div class="tl-title">${escapeHtml(song.title)} — ${escapeHtml(song.artist)}</div>
            <button type="button" class="icon-btn danger" data-remove="${id}" style="width:28px;height:28px">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>`;
      })
      .join("");
    tlEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentTrackIds = currentTrackIds.filter((id) => id !== btn.dataset.remove);
        renderPlTracklist(currentTrackIds);
      });
    });
  }

  document.getElementById("modalPlAddSong").addEventListener("change", (e) => {
    const songId = e.target.value;
    if (songId && !currentTrackIds.includes(songId)) {
      currentTrackIds.push(songId);
      renderPlTracklist(currentTrackIds);
      e.target.value = "";
    }
  });

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  document.getElementById("modalSaveBtn").addEventListener("click", async () => {
    const title = document.getElementById("modalPlTitle").value.trim();
    const coverUrl = document.getElementById("modalPlCover").value.trim();
    const pinned = document.getElementById("modalPlPinned").checked;
    if (!title) {
      showToast("Vui lòng nhập tên playlist.", "error");
      return;
    }
    try {
      const payload = { title, coverUrl, pinned, songIds: currentTrackIds };
      if (isEdit) {
        await updateDoc(doc(db, "playlists", playlist.docId), payload);
      } else {
        await addDoc(collection(db, "playlists"), {
          ...payload,
          createdAt: Date.now(),
          createdAtServer: serverTimestamp(),
        });
      }
      showToast(`Đã lưu playlist "${title}".`, "success");
      closeModal();
      loadPlaylists();
    } catch (e) {
      showToast("Lỗi khi lưu: " + e.message, "error");
    }
  });

  if (isEdit) {
    document.getElementById("modalDeleteBtn").addEventListener("click", async () => {
      if (!confirm(`Xóa playlist "${playlist.title}"?`)) return;
      try {
        await deleteDoc(doc(db, "playlists", playlist.docId));
        showToast("Đã xóa playlist.", "success");
        closeModal();
        loadPlaylists();
      } catch (e) {
        showToast("Lỗi khi xóa: " + e.message, "error");
      }
    });
  }
}

// =========================================================================
// FRAMES (Quản lý Khung Avatar Realtime & Dán nhanh cấu trúc Code/JSON)
// =========================================================================

// Hàm phân tích cấu trúc Dart / JS Object / JSON (hỗ trợ cả // comment, nháy đơn '', dấu phẩy dư cuối dòng)
function parsePastedFrameCode(rawText) {
  let cleaned = (rawText || "").trim();
  if (!cleaned) return [];

  // Nếu dán cả khai báo mảng (vd: static final List... = [ ... ];)
  const bracketMatch = cleaned.match(/\[([\s\S]*)\]/);
  if (bracketMatch && cleaned.includes("=") && cleaned.indexOf("=") < cleaned.indexOf("[")) {
    cleaned = "[" + bracketMatch[1] + "]";
  }

  // Hỗ trợ chuyển đổi cú pháp Dart Color(0xFF...) hoặc FrameRarity.xxx nếu có
  cleaned = cleaned
    .replace(/Color\(\s*0x[Ff]{2}([0-9A-Fa-f]{6})\s*\)/g, "'#$1'")
    .replace(/FrameRarity\.(\w+)/g, "'$1'")
    .replace(/;+\s*$/, "")
    .trim();

  // Tự bọc vào mảng [...] để đọc được cả 1 object có dấu phẩy cuối hoặc nhiều object liên tiếp
  const wrapped =
    cleaned.startsWith("[") && cleaned.endsWith("]") ? cleaned : `[\n${cleaned}\n]`;

  const parsed = new Function(`"use strict"; return (${wrapped});`)();
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => item && typeof item === "object");
}

function normalizeHexForPicker(hex, fallback = "#00e5ff") {
  if (!hex || typeof hex !== "string") return fallback;
  let h = hex.trim();
  if (!h.startsWith("#")) h = "#" + h;
  if (/^#[0-9A-Fa-f]{6}$/.test(h)) return h.toLowerCase();
  return fallback;
}

async function loadFrames() {
  try {
    const snap = await getDocs(collection(db, "avatar_frames"));
    framesCache = [];
    snap.forEach((d) => framesCache.push({ docId: d.id, ...d.data() }));
    const rarityWeight = { legendary: 4, epic: 3, rare: 2, common: 1 };
    framesCache.sort((a, b) => (rarityWeight[b.rarity] || 0) - (rarityWeight[a.rarity] || 0));
    renderFrameGrid();
  } catch (e) {
    console.error(e);
    showToast("Không tải được danh mục khung: " + e.message, "error");
  }
}

function renderFrameGrid(filterText = "") {
  const q = normalizeForCompare(filterText);
  let list = framesCache;
  if (q) {
    list = list.filter(
      (f) =>
        normalizeForCompare(f.name).includes(q) ||
        normalizeForCompare(f.rarity).includes(q) ||
        normalizeForCompare(f.docId).includes(q),
    );
  }

  el.frameEmptyState.style.display = list.length ? "none" : "block";

  el.frameGrid.innerHTML = list
    .map((f, i) => {
      const glow = f.glowColor || "#00E5FF";
      const colors =
        f.gradientColors && f.gradientColors.length >= 2 ? f.gradientColors : [glow, glow];
      const hasAnim = f.animationUrl && f.animationUrl.trim().length > 0;

      const rarityLabel =
        {
          legendary: "⭐ 5★ Legendary",
          epic: "⭐ 4★ Epic",
          rare: "⭐ 3★ Rare",
          common: "⭐ 3★ Common",
        }[f.rarity] || f.rarity;

      return `
        <div class="entity-card" data-frame-idx="${i}" style="border-top: 3px solid ${glow}; position: relative;">
          <div style="position: relative; width: 84px; height: 84px; margin: 6px auto 14px;">
            <div style="
              width: 84px; height: 84px; border-radius: 50%;
              background: linear-gradient(135deg, ${colors[0]}, ${colors[1]});
              box-shadow: 0 0 16px ${glow}88;
              position: absolute; inset: 0;
            "></div>
            <div style="
              width: 74px; height: 74px; border-radius: 50%;
              background: #090D1A; position: absolute; top: 5px; left: 5px;
              display: flex; align-items: center; justify-content: center;
              overflow: hidden;
            ">
              <i class="fa-solid fa-user-astronaut" style="font-size: 30px; color: rgba(255,255,255,0.4);"></i>
            </div>
            ${
              hasAnim
                ? `<img src="${f.animationUrl}" style="
                    position: absolute; inset: -10px; width: 104px; height: 104px;
                    object-fit: contain; pointer-events: none;
                  " onerror="this.style.display='none'" />`
                : ""
            }
          </div>

          <div class="e-name" style="text-align: center; font-weight: 800;">${escapeHtml(f.name)}</div>
          <div class="e-sub" style="text-align: center; color: ${glow}; font-weight: 700; font-size: 0.72rem; margin-top: 3px;">
            ${rarityLabel}
          </div>
          <div style="display: flex; justify-content: center; gap: 4px; margin-top: 6px;">
            ${f.isAudioReactive ? '<span class="badge active" style="font-size: 0.65rem;">Audio-Reactive</span>' : ""}
            <span class="badge ${f.isActive !== false ? "active" : "locked"}" style="font-size: 0.65rem;">
              ${f.isActive !== false ? "Đang mở" : "Đã ẩn"}
            </span>
          </div>
        </div>
      `;
    })
    .join("");

  el.frameGrid.querySelectorAll("[data-frame-idx]").forEach((card) => {
    card.addEventListener("click", () => {
      const idx = Number(card.dataset.frameIdx);
      openFrameModal(list[idx]);
    });
  });
}

if (el.searchFrames) {
  el.searchFrames.addEventListener("input", (e) => renderFrameGrid(e.target.value));
}
if (el.btnAddFrame) {
  el.btnAddFrame.addEventListener("click", () => openFrameModal(null));
}

function openFrameModal(frame) {
  const isEdit = !!frame;
  const defaultColors = frame?.gradientColors || ["#00E5FF", "#7000FF"];
  let bulkParsedFrames = []; // Lưu danh sách nếu người dùng dán nhiều khung cùng lúc

  // Tạo sẵn chuỗi cấu trúc mẫu nếu đang ở chế độ Sửa để bạn có thể copy ngược ra nếu muốn
  const currentCodeSnippet = isEdit
    ? `{\n  'id': '${frame.docId}',\n  'name': '${(frame.name || "").replace(/'/g, "\\'")}',\n  'description': '${(frame.description || "").replace(/'/g, "\\'")}',\n  'rarity': '${frame.rarity || "common"}',\n  'glowColor': '${frame.glowColor || "#00E5FF"}',\n  'gradientColors': ['${defaultColors[0] || "#00E5FF"}', '${defaultColors[1] || "#7000FF"}'],\n  'animationUrl': '${frame.animationUrl || ""}',\n  'isAudioReactive': ${!!frame.isAudioReactive},\n  'isActive': ${frame.isActive !== false},\n},`
    : "";

  el.modalBox.innerHTML = `
    <h3>
      ${isEdit ? "Sửa khung Avatar" : "Thêm khung Avatar mới"}
      <span class="modal-close" id="modalCloseBtn"><i class="fa-solid fa-xmark"></i></span>
    </h3>

    <!-- Ô DÁN NHANH CẤU TRÚC CODE / JSON (AUTO-FILL & BULK IMPORT) -->
    <div style="
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.08), rgba(196, 92, 255, 0.08));
      border: 1px dashed var(--neon-primary);
      border-radius: 14px;
      padding: 14px;
      margin-bottom: 18px;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label style="font-size: 0.82rem; font-weight: 800; color: var(--neon-primary); margin: 0;">
          <i class="fa-solid fa-code"></i> Dán nhanh cấu trúc Code (Hỗ trợ dán 1 hoặc nhiều khung)
        </label>
        <button type="button" id="btnParseFrameCode" style="
          background: rgba(0, 229, 255, 0.18);
          border: 1px solid var(--neon-primary);
          color: var(--text-main);
          border-radius: 8px;
          padding: 4px 10px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
        ">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Điền tự động
        </button>
      </div>
      <textarea
        id="modalFrameCodePaste"
        placeholder="// Dán y nguyên cấu trúc vào đây, ví dụ:&#10;// 1. LÔI THẦN SIÊU CƯỜNG (Sấm sét điện tử - 5★)&#10;{&#10;  'id': 'frame_cyber_shock',&#10;  'name': 'Lôi Thần Cyber',&#10;  'rarity': 'legendary',&#10;  ...&#10;},"
        style="
          width: 100%;
          min-height: 92px;
          background: rgba(5, 7, 16, 0.75);
          border: 1px solid var(--glass-border);
          border-radius: 10px;
          padding: 10px;
          color: #00ff88;
          font-family: monospace;
          font-size: 0.78rem;
          line-height: 1.45;
          resize: vertical;
        "
      >${escapeHtml(currentCodeSnippet)}</textarea>
      <div id="modalFrameCodeStatus" style="font-size: 0.75rem; color: var(--text-dim); margin-top: 6px;">
        Mẹo: Khi bạn dán (Ctrl+V) cấu trúc vào ô trên, toàn bộ thông tin bên dưới sẽ tự động được điền.
      </div>
    </div>

    <!-- XEM TRƯỚC TRỰC TIẾP (LIVE PREVIEW) -->
    <div style="display: flex; align-items: center; gap: 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 12px; padding: 10px 14px; margin-bottom: 16px;">
      <div id="modalFrameLivePreview" style="position: relative; width: 64px; height: 64px; flex-shrink: 0;"></div>
      <div style="flex: 1; min-width: 0;">
        <div id="modalPreviewTitle" style="font-weight: 800; font-size: 0.92rem;">${escapeHtml(frame?.name || "Xem trước khung")}</div>
        <div id="modalPreviewSub" style="font-size: 0.76rem; color: var(--text-dim); margin-top: 2px;">
          ID: <code id="modalPreviewIdCode" style="color: var(--neon-primary);">${escapeHtml(frame?.docId || "tự động")}</code>
        </div>
      </div>
    </div>

    <div class="row-2">
      <div class="field">
        <label>ID khung (Document ID — để trống sẽ tự tạo)</label>
        <input type="text" id="modalFrameId" value="${escapeHtml(frame?.docId || "")}" ${isEdit ? "disabled" : ""} placeholder="Ví dụ: frame_cyber_shock" />
      </div>
      <div class="field">
        <label>Độ hiếm (Phẩm cấp Gacha) *</label>
        <select id="modalFrameRarity">
          <option value="common">3★ Phổ thông (Common)</option>
          <option value="rare">3★ Hiếm (Rare)</option>
          <option value="epic">4★ Sử thi (Epic - Tím)</option>
          <option value="legendary">5★ Huyền thoại (Legendary - Vàng)</option>
        </select>
      </div>
    </div>

    <div class="field">
      <label>Tên khung *</label>
      <input type="text" id="modalFrameName" value="${escapeHtml(frame?.name || "")}" placeholder="Ví dụ: Lôi Thần Cyber" />
    </div>

    <div class="field">
      <label>Mô tả vật phẩm</label>
      <input type="text" id="modalFrameDesc" value="${escapeHtml(frame?.description || "")}" placeholder="Hiệu ứng sấm sét nổ theo nhịp bass..." />
    </div>

    <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 12px; padding: 12px; margin-bottom: 14px;">
      <label style="font-size: 0.8rem; font-weight: 700; color: var(--neon-primary); margin-bottom: 8px; display: block;">
        <i class="fa-solid fa-palette"></i> Bảng màu Neon & Hào quang
      </label>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
        <div>
          <label style="font-size: 0.72rem; color: var(--text-dim);">Hào quang (Glow)</label>
          <input type="color" id="modalGlowPicker" value="${normalizeHexForPicker(frame?.glowColor, "#00e5ff")}" style="height: 38px; cursor: pointer;" />
        </div>
        <div>
          <label style="font-size: 0.72rem; color: var(--text-dim);">Viền Gradient 1</label>
          <input type="color" id="modalGrad1Picker" value="${normalizeHexForPicker(defaultColors[0], "#00e5ff")}" style="height: 38px; cursor: pointer;" />
        </div>
        <div>
          <label style="font-size: 0.72rem; color: var(--text-dim);">Viền Gradient 2</label>
          <input type="color" id="modalGrad2Picker" value="${normalizeHexForPicker(defaultColors[1], "#7000ff")}" style="height: 38px; cursor: pointer;" />
        </div>
      </div>
    </div>

    <div class="field">
      <label>Đường dẫn hiệu ứng động Discord Overlay (.webp, .png)</label>
      <input type="text" id="modalFrameAnimUrl" value="${escapeHtml(frame?.animationUrl || "")}" placeholder="Dán URL link ảnh hoặc upload bên dưới..." />
    </div>

    <div class="field">
      <label>Hoặc tải file hiệu ứng động lên Cloudinary</label>
      <input type="file" id="modalFrameAnimFile" accept="image/*,.webp" style="font-size: 0.82rem;" />
      <div class="dz-hint" style="font-size: 0.72rem; color: var(--text-dim); margin-top: 3px;">
        Chọn file Animated WebP trong suốt, hệ thống sẽ tự upload lấy link vĩnh viễn.
      </div>
    </div>

    <div class="row-2" style="margin-top: 10px;">
      <div class="field" style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="modalFrameReactive" ${frame?.isAudioReactive ? "checked" : ""} class="bulk-checkbox" style="margin: 0;" />
        <label for="modalFrameReactive" style="margin: 0; cursor: pointer;">Nhảy theo nhạc (Audio-Reactive)</label>
      </div>
      <div class="field" style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="modalFrameActive" ${frame?.isActive !== false ? "checked" : ""} class="bulk-checkbox" style="margin: 0;" />
        <label for="modalFrameActive" style="margin: 0; cursor: pointer;">Mở trong Gacha</label>
      </div>
    </div>

    <div class="progress-wrap" id="modalFrameProgressWrap">
      <div class="progress-fill" id="modalFrameProgressFill"></div>
    </div>
    <div class="progress-text" id="modalFrameProgressText"></div>

    <div class="submit-row" style="justify-content: space-between; margin-top: 16px;">
      ${
        isEdit
          ? `<button class="btn btn-ghost" id="modalDeleteFrameBtn" style="color: var(--danger)">
              <i class="fa-solid fa-trash"></i> Xóa khung
            </button>`
          : "<div></div>"
      }
      <button class="btn btn-primary" id="modalSaveFrameBtn">
        <i class="fa-solid fa-floppy-disk"></i> Lưu khung
      </button>
    </div>
  `;
  openModal();

  if (frame?.rarity) {
    document.getElementById("modalFrameRarity").value = frame.rarity;
  }

  const idInput = document.getElementById("modalFrameId");
  const nameInput = document.getElementById("modalFrameName");
  const raritySelect = document.getElementById("modalFrameRarity");
  const descInput = document.getElementById("modalFrameDesc");
  const glowPicker = document.getElementById("modalGlowPicker");
  const grad1Picker = document.getElementById("modalGrad1Picker");
  const grad2Picker = document.getElementById("modalGrad2Picker");
  const animUrlInput = document.getElementById("modalFrameAnimUrl");
  const reactiveCheck = document.getElementById("modalFrameReactive");
  const activeCheck = document.getElementById("modalFrameActive");
  const codePasteArea = document.getElementById("modalFrameCodePaste");
  const codeStatus = document.getElementById("modalFrameCodeStatus");
  const saveBtn = document.getElementById("modalSaveFrameBtn");

  // Cập nhật hình xem trước (Live Preview) ngay trong Modal
  function updateLivePreview() {
    const glow = glowPicker.value || "#00e5ff";
    const c1 = grad1Picker.value || glow;
    const c2 = grad2Picker.value || glow;
    const anim = animUrlInput.value.trim();
    const previewBox = document.getElementById("modalFrameLivePreview");
    const previewTitle = document.getElementById("modalPreviewTitle");
    const previewIdCode = document.getElementById("modalPreviewIdCode");

    if (previewTitle) previewTitle.textContent = nameInput.value.trim() || "Xem trước khung";
    if (previewIdCode) previewIdCode.textContent = idInput.value.trim() || "tự động";

    if (previewBox) {
      previewBox.innerHTML = `
        <div style="width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg, ${c1}, ${c2}); box-shadow: 0 0 14px ${glow}88; position: absolute; inset: 0;"></div>
        <div style="width: 56px; height: 56px; border-radius: 50%; background: #090D1A; position: absolute; top: 4px; left: 4px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
          <i class="fa-solid fa-user-astronaut" style="font-size: 22px; color: rgba(255,255,255,0.45);"></i>
        </div>
        ${
          anim
            ? `<img src="${escapeHtml(anim)}" style="position: absolute; inset: -8px; width: 80px; height: 80px; object-fit: contain; pointer-events: none;" onerror="this.style.display='none'" />`
            : ""
        }
      `;
    }
  }

  [idInput, nameInput, glowPicker, grad1Picker, grad2Picker, animUrlInput].forEach((node) => {
    node.addEventListener("input", updateLivePreview);
  });
  updateLivePreview();

  // Hàm xử lý khi dán cấu trúc vào ô Code
  function applyPastedCode(showToastFeedback = false) {
    const raw = codePasteArea.value.trim();
    if (!raw) {
      bulkParsedFrames = [];
      saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Lưu khung`;
      return;
    }

    try {
      const items = parsePastedFrameCode(raw);
      if (items.length === 0) throw new Error("Không tìm thấy dữ liệu khung hợp lệ");

      // Điền khung đầu tiên vào form để xem trước
      const first = items[0];
      if (!isEdit && first.id) idInput.value = String(first.id).trim();
      if (first.name) nameInput.value = String(first.name).trim();
      if (first.description !== undefined) descInput.value = String(first.description).trim();
      if (first.rarity) {
        const r = String(first.rarity).toLowerCase().trim();
        if (["common", "rare", "epic", "legendary"].includes(r)) {
          raritySelect.value = r;
        }
      }
      if (first.glowColor) {
        glowPicker.value = normalizeHexForPicker(first.glowColor, "#00e5ff");
      }
      if (Array.isArray(first.gradientColors) && first.gradientColors.length > 0) {
        grad1Picker.value = normalizeHexForPicker(first.gradientColors[0], glowPicker.value);
        grad2Picker.value = normalizeHexForPicker(
          first.gradientColors[1] || first.gradientColors[0],
          "#7000ff",
        );
      }
      if (first.animationUrl !== undefined || first.frameUrl !== undefined) {
        animUrlInput.value = String(first.animationUrl || first.frameUrl || "").trim();
      }
      if (first.isAudioReactive !== undefined) {
        reactiveCheck.checked = Boolean(first.isAudioReactive);
      }
      if (first.isActive !== undefined) {
        activeCheck.checked = Boolean(first.isActive);
      }

      updateLivePreview();

      if (items.length > 1 && !isEdit) {
        bulkParsedFrames = items;
        codeStatus.style.color = "var(--success)";
        codeStatus.innerHTML = `<i class="fa-solid fa-layer-group"></i> Phát hiện <strong>${items.length} khung</strong> trong đoạn code! Bấm nút bên dưới để lưu tất cả ${items.length} khung cùng lúc.`;
        saveBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Lưu tất cả ${items.length} khung ngay`;
      } else {
        bulkParsedFrames = [];
        codeStatus.style.color = "var(--success)";
        codeStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> Đã tự động điền thông tin khung <strong>"${escapeHtml(first.name || first.id || "")}"</strong>! Bấm "Lưu khung" để hoàn tất.`;
        saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Lưu khung`;
      }

      if (showToastFeedback) {
        showToast(
          items.length > 1
            ? `Đã nhận diện ${items.length} khung từ cấu trúc code!`
            : `Đã điền tự động khung "${first.name || first.id}"!`,
          "success",
        );
      }
    } catch (err) {
      bulkParsedFrames = [];
      codeStatus.style.color = "var(--danger)";
      codeStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Cấu trúc chưa khớp hoặc thiếu dấu ngoặc: ${escapeHtml(err.message)}`;
      if (showToastFeedback) {
        showToast("Không phân tích được đoạn code: " + err.message, "error");
      }
    }
  }

  codePasteArea.addEventListener("input", () => applyPastedCode(false));
  document.getElementById("btnParseFrameCode").addEventListener("click", () => applyPastedCode(true));

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);

  // Xử lý nút Lưu Khung (Hỗ trợ cả Lưu 1 khung lẫn Lưu hàng loạt nhiều khung từ Code)
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;

    try {
      // TRƯỜNG HỢP 1: Người dùng dán nhiều khung cùng lúc vào ô Code
      if (bulkParsedFrames.length > 1 && !isEdit) {
        const batch = writeBatch(db);
        for (const item of bulkParsedFrames) {
          const customId = item.id ? String(item.id).trim() : "";
          const docRef = customId
            ? doc(db, "avatar_frames", customId)
            : doc(collection(db, "avatar_frames"));

          const glow = normalizeHexForPicker(item.glowColor, "#00e5ff").toUpperCase();
          const grads =
            Array.isArray(item.gradientColors) && item.gradientColors.length >= 2
              ? [
                  normalizeHexForPicker(item.gradientColors[0], glow).toUpperCase(),
                  normalizeHexForPicker(item.gradientColors[1], glow).toUpperCase(),
                ]
              : [glow, "#7000FF"];

          batch.set(
            docRef,
            {
              name: String(item.name || "Khung Cyber").trim(),
              description: String(item.description || "Khung trang trí SoundSphere.").trim(),
              rarity: ["common", "rare", "epic", "legendary"].includes(
                String(item.rarity || "").toLowerCase(),
              )
                ? String(item.rarity).toLowerCase()
                : "common",
              glowColor: glow,
              gradientColors: grads,
              animationUrl: String(item.animationUrl || item.frameUrl || "").trim(),
              isAudioReactive: Boolean(item.isAudioReactive),
              isActive: item.isActive !== false,
              createdAt: Date.now(),
              createdAtServer: serverTimestamp(),
            },
            { merge: true },
          );
        }

        await batch.commit();
        showToast(`Đã nạp thành công ${bulkParsedFrames.length} khung Avatar!`, "success");
        closeModal();
        loadFrames();
        return;
      }

      // TRƯỜNG HỢP 2: Lưu 1 khung theo các ô trên Form (đã được auto-fill hoặc nhập tay)
      const customId = idInput.value.trim();
      const name = nameInput.value.trim();
      const rarity = raritySelect.value;
      const description = descInput.value.trim();
      const glowColor = glowPicker.value.toUpperCase();
      const grad1 = grad1Picker.value.toUpperCase();
      const grad2 = grad2Picker.value.toUpperCase();
      let animUrl = animUrlInput.value.trim();
      const fileInput = document.getElementById("modalFrameAnimFile");
      const isAudioReactive = reactiveCheck.checked;
      const isActive = activeCheck.checked;

      if (!name) {
        showToast("Vui lòng điền tên khung avatar hoặc dán cấu trúc vào ô trên.", "error");
        saveBtn.disabled = false;
        return;
      }

      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const progressWrap = document.getElementById("modalFrameProgressWrap");
        const progressFill = document.getElementById("modalFrameProgressFill");
        const progressText = document.getElementById("modalFrameProgressText");

        progressWrap.classList.add("active");
        progressText.classList.add("active");
        progressText.textContent = "Đang tải ảnh hiệu ứng lên Cloudinary...";

        const result = await uploadToCloudinary(file, "image", (pct) => {
          progressFill.style.width = `${pct}%`;
        });
        animUrl = result.url;
      }

      const payload = {
        name,
        description: description || "Khung trang trí SoundSphere.",
        rarity,
        glowColor,
        gradientColors: [grad1, grad2],
        animationUrl: animUrl,
        isAudioReactive,
        isActive,
      };

      if (isEdit) {
        await updateDoc(doc(db, "avatar_frames", frame.docId), payload);
      } else if (customId) {
        // Nếu có 'id' trong cấu trúc dán (vd: 'frame_cyber_shock'), dùng đúng ID đó làm Document ID
        await setDoc(
          doc(db, "avatar_frames", customId),
          {
            ...payload,
            createdAt: Date.now(),
            createdAtServer: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        await addDoc(collection(db, "avatar_frames"), {
          ...payload,
          createdAt: Date.now(),
          createdAtServer: serverTimestamp(),
        });
      }

      showToast(`Đã lưu thành công khung "${name}"!`, "success");
      closeModal();
      loadFrames();
    } catch (e) {
      console.error(e);
      showToast("Lỗi khi lưu khung: " + e.message, "error");
      saveBtn.disabled = false;
    }
  });

  if (isEdit) {
    document.getElementById("modalDeleteFrameBtn").addEventListener("click", async () => {
      if (!confirm(`Bạn có chắc chắn muốn xóa khung "${frame.name}" khỏi hệ thống?`)) return;
      try {
        await deleteDoc(doc(db, "avatar_frames", frame.docId));
        showToast("Đã xóa khung thành công.", "success");
        closeModal();
        loadFrames();
      } catch (e) {
        showToast("Lỗi khi xóa: " + e.message, "error");
      }
    });
  }
}

// =========================================================================
// USERS (Danh sách người dùng đã đăng nhập vào trang chính)
// =========================================================================

async function loadUsers() {
  try {
    const snap = await getDocs(collection(db, "users"));
    usersCache = [];
    snap.forEach((d) => usersCache.push({ docId: d.id, ...d.data() }));
    usersCache.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderUsersTable(usersCache);
  } catch (e) {
    console.error(e);
    showToast("Không tải được danh sách người dùng: " + e.message, "error");
  }
}

function renderUsersTable(list) {
  el.usersEmptyState.style.display = list.length ? "none" : "block";
  el.usersTableBody.innerHTML = list
    .map((u) => {
      const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString("vi-VN") : "—";
      const locked = !!u.locked;
      return `
        <tr>
          <td>${escapeHtml(u.email || u.docId)}</td>
          <td>${joined}</td>
          <td><span class="badge ${locked ? "locked" : "active"}">${locked ? "Đã khóa" : "Hoạt động"}</span></td>
          <td>
            <button type="button" class="icon-btn ${locked ? "" : "danger"}" data-toggle-lock="${u.docId}" title="${locked ? "Mở khóa" : "Khóa tài khoản"}">
              <i class="fa-solid ${locked ? "fa-lock-open" : "fa-lock"}"></i>
            </button>
          </td>
        </tr>`;
    })
    .join("");

  el.usersTableBody.querySelectorAll("[data-toggle-lock]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const docId = btn.dataset.toggleLock;
      const user = usersCache.find((u) => u.docId === docId);
      if (!user) return;
      try {
        await updateDoc(doc(db, "users", docId), { locked: !user.locked });
        showToast(user.locked ? "Đã mở khóa tài khoản." : "Đã khóa tài khoản.", "success");
        loadUsers();
      } catch (e) {
        showToast("Lỗi: " + e.message, "error");
      }
    });
  });
}

el.searchUsers.addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q ? usersCache.filter((u) => (u.email || "").toLowerCase().includes(q)) : usersCache;
  renderUsersTable(filtered);
});

// =========================================================================
// STORAGE (Tình trạng lưu trữ + phát hiện trùng lặp toàn kho)
// =========================================================================

function renderStoragePage() {
  el.statAudioFileCount.textContent = allSongsCache.filter((s) => s.audioUrl).length.toLocaleString("vi-VN");
  el.statDuplicateSongs.textContent = "—";
  el.storageDuplicateResults.innerHTML = "";
}

el.btnScanDuplicates.addEventListener("click", () => {
  const seen = new Map();
  allSongsCache.forEach((s) => {
    const key = `${normalizeForCompare(s.title)}|||${normalizeForCompare(s.artist)}`;
    if (!key || key === "|||") return;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(s);
  });

  const dupGroups = Array.from(seen.values()).filter((group) => group.length > 1);
  const totalDupSongs = dupGroups.reduce((sum, g) => sum + g.length, 0);

  el.statDuplicateSongs.textContent = totalDupSongs.toLocaleString("vi-VN");

  if (dupGroups.length === 0) {
    el.storageDuplicateResults.innerHTML = `<div class="hint-note" style="margin:0"><i class="fa-solid fa-circle-check" style="color: var(--success)"></i> Không phát hiện bài hát trùng lặp nào.</div>`;
    return;
  }

  el.storageDuplicateResults.innerHTML = `
    <div class="hint-note" style="margin-top:0">Tìm thấy ${dupGroups.length} nhóm bài hát nghi trùng (${totalDupSongs} bài). Vào trang "Bài hát" để xóa bản trùng không cần thiết.</div>
    ${dupGroups
      .map(
        (group) => `
        <div class="banner-slot">
          <img src="${group[0].cover || group[0].coverUrl || ""}" onerror="this.style.opacity=0" />
          <div class="banner-info">
            <div class="s-title">${escapeHtml(group[0].title)} —${escapeHtml(group[0].artist)}</div>
            <div class="s-artist">Xuất hiện ${group.length} lần (ID: ${group.map((s) => s.id).join(", ")})</div>
          </div>
        </div>`,
      )
      .join("")}
  `;
});

// =========================================================================
// HOMEPAGE (Banner & nội dung trang chủ — quản lý ghim album/playlist)
// =========================================================================

async function loadHomepageSettings() {
  if (albumsCache.length === 0) await loadAlbums();
  if (playlistsCache.length === 0) await loadPlaylists();
  renderPinnedLists();
}

function renderPinnedLists() {
  const pinnedAlbums = albumsCache.filter((a) => a.pinned);
  const pinnedPlaylists = playlistsCache.filter((p) => p.pinned);

  el.pinnedAlbumsList.innerHTML = pinnedAlbums.length
    ? pinnedAlbums
        .map(
          (a) => `
        <div class="banner-slot">
          <img src="${a.coverUrl || ""}" onerror="this.style.opacity=0" />
          <div class="banner-info">
            <div class="s-title">${escapeHtml(a.title)}</div>
            <div class="s-artist">${(a.songIds || []).length} bài hát</div>
          </div>
        </div>`,
        )
        .join("")
    : `<div class="hint-note" style="margin:0">Chưa ghim album nào.</div>`;

  el.pinnedPlaylistsList.innerHTML = pinnedPlaylists.length
    ? pinnedPlaylists
        .map(
          (p) => `
        <div class="banner-slot">
          <img src="${p.coverUrl || ""}" onerror="this.style.opacity=0" />
          <div class="banner-info">
            <div class="s-title">${escapeHtml(p.title)}</div>
            <div class="s-artist">${(p.songIds || []).length} bài hát</div>
          </div>
        </div>`,
        )
        .join("")
    : `<div class="hint-note" style="margin:0">Chưa ghim playlist nào.</div>`;
}

el.btnManagePinnedAlbums.addEventListener("click", () => goToPage("albums"));
el.btnManagePinnedPlaylists.addEventListener("click", () => goToPage("playlists"));

// =========================================================================
// ADMIN ROLES (Quản trị viên — chỉ Super Admin gốc thấy và dùng được trang này)
// =========================================================================

async function loadAdminRoles() {
  el.superAdminEmailLabel.textContent = SUPER_ADMIN_EMAIL;
  try {
    const snap = await getDocs(collection(db, "adminEmails"));
    adminEmailsCache = [];
    snap.forEach((d) => adminEmailsCache.push({ docId: d.id, ...d.data() }));
    renderAdminRolesTable();
  } catch (e) {
    console.error(e);
    showToast("Không tải được danh sách quản trị viên: " + e.message, "error");
  }
}

function renderAdminRolesTable() {
  const superAdminRow = `
    <tr>
      <td>${escapeHtml(SUPER_ADMIN_EMAIL)}</td>
      <td><span class="badge active">Super Admin</span></td>
      <td>—</td>
      <td></td>
    </tr>`;

  const addedRows = adminEmailsCache
    .map((a) => {
      const addedDate = a.createdAt ? new Date(a.createdAt).toLocaleDateString("vi-VN") : "—";
      return `
        <tr>
          <td>${escapeHtml(a.email)}</td>
          <td><span class="badge active">Quản trị viên</span></td>
          <td>${addedDate}</td>
          <td>
            <button type="button" class="icon-btn danger" data-remove-admin="${a.docId}" title="Xóa quyền admin">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>`;
    })
    .join("");

  el.adminRolesTableBody.innerHTML = superAdminRow + addedRows;

  el.adminRolesTableBody.querySelectorAll("[data-remove-admin]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const docId = btn.dataset.removeAdmin;
      const admin = adminEmailsCache.find((a) => a.docId === docId);
      if (!admin) return;
      if (!confirm(`Xóa quyền quản trị của "${admin.email}"? Người này sẽ không thể truy cập trang admin nữa.`)) return;
      try {
        await deleteDoc(doc(db, "adminEmails", docId));
        showToast(`Đã xóa quyền quản trị của "${admin.email}".`, "success");
        loadAdminRoles();
      } catch (e) {
        showToast("Lỗi khi xóa: " + e.message, "error");
      }
    });
  });
}

el.btnAddAdminEmail.addEventListener("click", async () => {
  const email = el.newAdminEmailInput.value.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    showToast("Vui lòng nhập email hợp lệ.", "error");
    return;
  }
  if (email === SUPER_ADMIN_EMAIL.toLowerCase()) {
    showToast("Email này đã là Super Admin gốc.", "error");
    return;
  }
  if (adminEmailsCache.some((a) => (a.email || "").toLowerCase() === email)) {
    showToast("Email này đã có quyền quản trị.", "error");
    return;
  }

  try {
    await setDoc(doc(db, "adminEmails", email), {
      email,
      createdAt: Date.now(),
      createdAtServer: serverTimestamp(),
      addedBy: SUPER_ADMIN_EMAIL,
    });
    showToast(
      `Đã thêm "${email}" làm quản trị viên. Người này cần đăng nhập (lần đầu hoặc đăng nhập lại) để quyền có hiệu lực.`,
      "success",
    );
    el.newAdminEmailInput.value = "";
    loadAdminRoles();
  } catch (e) {
    showToast("Lỗi khi thêm: " + e.message, "error");
  }
});

// =========================================================================
// MODAL DÙNG CHUNG (Artists / Albums / Playlists / Frames)
// =========================================================================

function openModal() {
  el.modalOverlay.classList.add("active");
}
function closeModal() {
  el.modalOverlay.classList.remove("active");
  el.modalBox.innerHTML = "";
}
el.modalOverlay.addEventListener("click", (e) => {
  if (e.target === el.modalOverlay) closeModal();
});

// --- UPLOAD HELPER ---
function uploadToCloudinary(file, resourceType, onProgress) {
  return new Promise((resolve, reject) => {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress((e.loaded / e.total) * 100);
      }
    };

    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && res.secure_url) {
          resolve({ url: res.secure_url, publicId: res.public_id });
        } else {
          const msg =
            (res.error && res.error.message) ||
            `Cloudinary trả về lỗi (mã ${xhr.status})`;
          reject(new Error(msg));
        }
      } catch (e) {
        reject(new Error("Không đọc được phản hồi từ Cloudinary"));
      }
    };

    xhr.onerror = () => reject(new Error("Lỗi kết nối tới Cloudinary"));
    xhr.send(formData);
  });
}

// =========================================================================
// SỬA 1 BÀI HÁT
// =========================================================================

function openEditSongModal(song) {
  let newAudioFile = null;
  let newCoverFile = null;

  el.modalBox.innerHTML = `
    <h3>
      Sửa bài hát
      <span class="modal-close" id="modalCloseBtn"><i class="fa-solid fa-xmark"></i></span>
    </h3>

    <div class="drop-row">
      <div class="dropzone" id="editAudioDropzone" style="min-height: 110px">
        <input type="file" id="editAudioInput" accept="audio/*" />
        <i class="fa-solid fa-music dz-icon"></i>
        <div class="dz-label" style="font-size: 0.82rem">File mp3 hiện tại</div>
        <div class="dz-hint">Bấm để chọn file mới (giữ nguyên nếu không đổi)</div>
      </div>
      <div class="dropzone" id="editCoverDropzone" style="min-height: 110px">
        <img class="preview-img" src="${song.coverUrl || ""}" onerror="this.style.opacity=0" />
        <input type="file" id="editCoverInput" accept="image/*" />
        <div class="dz-hint">Bấm để chọn ảnh mới (giữ nguyên nếu không đổi)</div>
      </div>
    </div>

    <div class="row-2">
      <div class="field">
        <label>Tên bài hát *</label>
        <input type="text" id="editTitle" value="${escapeHtml(song.title || "")}" />
      </div>
      <div class="field">
        <label>Ca sĩ / Nghệ sĩ *</label>
        <input type="text" id="editArtist" value="${escapeHtml(song.artist || "")}" />
      </div>
    </div>

    <div class="row-2">
      <div class="field">
        <label>Thể loại</label>
        <select id="editGenre">
          <option value="Pop">Pop</option>
          <option value="Lofi Chill">Lofi Chill</option>
          <option value="EDM">EDM</option>
          <option value="Rap Việt">Rap Việt</option>
          <option value="Ballad">Ballad</option>
          <option value="Khác">Khác</option>
        </select>
      </div>
      <div class="field">
        <label>ID bài hát</label>
        <input type="number" id="editId" value="${song.id ?? ""}" />
      </div>
    </div>

    <div class="field">
      <label>Lời bài hát (định dạng [mm:ss.ss] giống lyrics.js)</label>
      <textarea id="editLyrics">${escapeHtml(song.lyrics || "")}</textarea>
    </div>

    <div class="progress-wrap" id="editProgressWrap">
      <div class="progress-fill" id="editProgressFill"></div>
    </div>
    <div class="progress-text" id="editProgressText"></div>

    <div class="submit-row" style="justify-content: space-between">
      <button class="btn btn-ghost" id="modalDeleteBtn" style="color: var(--danger)">
        <i class="fa-solid fa-trash"></i> Xóa bài hát
      </button>
      <button class="btn btn-primary" id="modalSaveBtn">
        <i class="fa-solid fa-floppy-disk"></i> Lưu thay đổi
      </button>
    </div>
  `;
  openModal();

  document.getElementById("editGenre").value = song.genre || "Pop";

  const audioDz = document.getElementById("editAudioDropzone");
  const audioInput = document.getElementById("editAudioInput");
  audioDz.addEventListener("click", () => audioInput.click());
  audioInput.addEventListener("change", () => {
    if (audioInput.files[0]) {
      newAudioFile = audioInput.files[0];
      audioDz.querySelector(".dz-label").textContent = newAudioFile.name;
      audioDz.querySelector(".dz-hint").textContent = "File mới — sẽ thay file cũ khi lưu";
    }
  });

  const coverDz = document.getElementById("editCoverDropzone");
  const coverInput = document.getElementById("editCoverInput");
  const coverPreviewImg = coverDz.querySelector(".preview-img");
  coverDz.addEventListener("click", () => coverInput.click());
  coverInput.addEventListener("change", () => {
    if (coverInput.files[0]) {
      newCoverFile = coverInput.files[0];
      coverPreviewImg.src = URL.createObjectURL(newCoverFile);
      coverDz.querySelector(".dz-hint").textContent = "Ảnh mới — sẽ thay ảnh cũ khi lưu";
    }
  });

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);

  document.getElementById("modalDeleteBtn").addEventListener("click", () => {
    closeModal();
    confirmDeleteSong(song.docId);
  });

  document.getElementById("modalSaveBtn").addEventListener("click", async () => {
    const title = document.getElementById("editTitle").value.trim();
    const artist = document.getElementById("editArtist").value.trim();
    const genre = document.getElementById("editGenre").value;
    const idRaw = document.getElementById("editId").value.trim();
    const lyrics = document.getElementById("editLyrics").value.trim();

    if (!title || !artist) {
      showToast("Vui lòng nhập tên bài hát và ca sĩ.", "error");
      return;
    }

    let songId = Number(idRaw);
    if (!idRaw || isNaN(songId)) songId = song.id;
    if (songId !== song.id) {
      const dup = allSongsCache.some((s) => s.docId !== song.docId && Number(s.id) === songId);
      if (dup) {
        showToast(`ID ${songId} đã được dùng cho bài hát khác.`, "error");
        return;
      }
    }

    const saveBtn = document.getElementById("modalSaveBtn");
    saveBtn.disabled = true;
    const progressWrap = document.getElementById("editProgressWrap");
    const progressFill = document.getElementById("editProgressFill");
    const progressText = document.getElementById("editProgressText");
    progressWrap.classList.add("active");
    progressText.classList.add("active");

    try {
      const updatePayload = { title, artist, genre, id: songId, lyrics: lyrics || "" };

      if (newAudioFile) {
        progressText.textContent = "Đang tải lên file âm thanh mới...";
        const audioResult = await uploadToCloudinary(newAudioFile, "video", (pct) => {
          progressFill.style.width = `${pct * (newCoverFile ? 0.5 : 1)}%`;
        });
        updatePayload.audioUrl = audioResult.url;
        updatePayload.audioPublicId = audioResult.publicId;
      }

      if (newCoverFile) {
        progressText.textContent = "Đang tải lên ảnh bìa mới...";
        const coverResult = await uploadToCloudinary(newCoverFile, "image", (pct) => {
          const base = newAudioFile ? 50 : 0;
          const portion = newAudioFile ? 0.5 : 1;
          progressFill.style.width = `${base + pct * portion}%`;
        });
        updatePayload.coverUrl = coverResult.url;
        updatePayload.coverPublicId = coverResult.publicId;
      }

      progressText.textContent = "Đang lưu thông tin...";
      await updateDoc(doc(db, "songs", song.docId), updatePayload);

      showToast(`Đã lưu thay đổi cho "${title}".`, "success");
      closeModal();
      loadSongList();
    } catch (e) {
      console.error(e);
      showToast("Lỗi khi lưu: " + e.message, "error");
      saveBtn.disabled = false;
      progressWrap.classList.remove("active");
      progressText.classList.remove("active");
      progressFill.style.width = "0%";
    }
  });
}

// =========================================================================
// SỬA HÀNG LOẠT
// =========================================================================

el.btnBulkEditOpen.addEventListener("click", () => openBulkEditModal());

function openBulkEditModal() {
  const count = selectedSongIds.size;
  if (count === 0) return;

  let newCoverFile = null;

  el.modalBox.innerHTML = `
    <h3>
      Sửa hàng loạt (${count} bài hát)
      <span class="modal-close" id="modalCloseBtn"><i class="fa-solid fa-xmark"></i></span>
    </h3>

    <div class="hint-note" style="margin-top: 0">
      Chỉ điền trường nào bạn muốn đổi — để trống nghĩa là giữ nguyên giá trị cũ của từng bài.
      Áp dụng cho tất cả ${count} bài hát đã chọn.
    </div>

    <div class="field">
      <label>Đổi nghệ danh / tên ca sĩ thành</label>
      <input type="text" id="bulkEditArtist" placeholder="Để trống = giữ nguyên" />
    </div>

    <div class="field">
      <label>Đổi thể loại thành</label>
      <select id="bulkEditGenre">
        <option value="">— Giữ nguyên —</option>
        <option value="Pop">Pop</option>
        <option value="Lofi Chill">Lofi Chill</option>
        <option value="EDM">EDM</option>
        <option value="Rap Việt">Rap Việt</option>
        <option value="Ballad">Ballad</option>
        <option value="Khác">Khác</option>
      </select>
    </div>

    <div class="field">
      <label>Đổi ảnh cover chung cho tất cả (tuỳ chọn)</label>
      <div class="dropzone" id="bulkEditCoverDropzone" style="min-height: 100px">
        <input type="file" id="bulkEditCoverInput" accept="image/*" />
        <i class="fa-solid fa-image dz-icon"></i>
        <div class="dz-label" style="font-size: 0.82rem">Bấm để chọn ảnh áp dụng cho tất cả bài đã chọn</div>
        <div class="dz-hint">Để trống = giữ nguyên ảnh riêng của từng bài</div>
      </div>
    </div>

    <div class="progress-wrap" id="bulkEditProgressWrap">
      <div class="progress-fill" id="bulkEditProgressFill"></div>
    </div>
    <div class="progress-text" id="bulkEditProgressText"></div>

    <div class="submit-row">
      <button class="btn btn-primary" id="modalSaveBtn">
        <i class="fa-solid fa-floppy-disk"></i> Áp dụng cho ${count} bài hát
      </button>
    </div>
  `;
  openModal();

  const coverDz = document.getElementById("bulkEditCoverDropzone");
  const coverInput = document.getElementById("bulkEditCoverInput");
  coverDz.addEventListener("click", () => coverInput.click());
  coverInput.addEventListener("change", () => {
    if (coverInput.files[0]) {
      newCoverFile = coverInput.files[0];
      renderDropzoneFile(coverDz, newCoverFile, true);
    }
  });

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);

  document.getElementById("modalSaveBtn").addEventListener("click", async () => {
    const newArtist = document.getElementById("bulkEditArtist").value.trim();
    const newGenre = document.getElementById("bulkEditGenre").value;

    if (!newArtist && !newGenre && !newCoverFile) {
      showToast("Bạn chưa thay đổi trường nào.", "error");
      return;
    }

    const saveBtn = document.getElementById("modalSaveBtn");
    saveBtn.disabled = true;
    const progressWrap = document.getElementById("bulkEditProgressWrap");
    const progressFill = document.getElementById("bulkEditProgressFill");
    const progressText = document.getElementById("bulkEditProgressText");
    progressWrap.classList.add("active");
    progressText.classList.add("active");

    try {
      let sharedCoverResult = null;
      if (newCoverFile) {
        progressText.textContent = "Đang tải lên ảnh cover chung...";
        sharedCoverResult = await uploadToCloudinary(newCoverFile, "image", (pct) => {
          progressFill.style.width = `${pct * 0.4}%`;
        });
      }

      const targetDocIds = Array.from(selectedSongIds);
      let done = 0;

      for (const docId of targetDocIds) {
        const payload = {};
        if (newArtist) payload.artist = newArtist;
        if (newGenre) payload.genre = newGenre;
        if (sharedCoverResult) {
          payload.coverUrl = sharedCoverResult.url;
          payload.coverPublicId = sharedCoverResult.publicId;
        }

        await updateDoc(doc(db, "songs", docId), payload);
        done++;
        const basePct = newCoverFile ? 40 : 0;
        const remainingPct = newCoverFile ? 60 : 100;
        progressFill.style.width = `${basePct + (done / targetDocIds.length) * remainingPct}%`;
        progressText.textContent = `Đang cập nhật ${done}/${targetDocIds.length} bài hát...`;
      }

      showToast(`Đã cập nhật ${done} bài hát.`, "success");
      selectedSongIds.clear();
      updateBulkEditToolbar();
      closeModal();
      loadSongList();
    } catch (e) {
      console.error(e);
      showToast("Lỗi khi cập nhật hàng loạt: " + e.message, "error");
      saveBtn.disabled = false;
      progressWrap.classList.remove("active");
      progressText.classList.remove("active");
      progressFill.style.width = "0%";
    }
  });
}

// --- SUBMIT BÀI HÁT ĐƠN ---
el.btnSubmit.addEventListener("click", async () => {
  const title = el.inputTitle.value.trim();
  const artist = el.inputArtist.value.trim();
  const genre = el.inputGenre.value;
  const idRaw = el.inputId.value.trim();
  const lyrics = el.inputLyrics.value.trim();

  if (!title || !artist) {
    showToast("Vui lòng nhập tên bài hát và ca sĩ.", "error");
    return;
  }
  if (!selectedAudioFile) {
    showToast("Vui lòng chọn file mp3.", "error");
    return;
  }
  if (!selectedCoverFile) {
    showToast("Vui lòng chọn ảnh bìa.", "error");
    return;
  }

  let songId = Number(idRaw);
  if (!idRaw || isNaN(songId)) {
    songId = computeNextId();
  }
  const isDuplicate = allSongsCache.some((s) => Number(s.id) === songId);
  if (isDuplicate) {
    showToast(
      `ID ${songId} đã được dùng cho bài hát khác. Hãy đổi ID hoặc bấm nút làm mới.`,
      "error",
    );
    return;
  }

  el.btnSubmit.disabled = true;
  el.progressWrap.classList.add("active");
  el.progressText.classList.add("active");

  try {
    el.progressText.textContent = "Đang tải lên file âm thanh (Cloudinary)...";
    const audioResult = await uploadToCloudinary(
      selectedAudioFile,
      "video",
      (pct) => {
        el.progressFill.style.width = `${pct * 0.5}%`;
      },
    );

    el.progressText.textContent = "Đang tải lên ảnh bìa (Cloudinary)...";
    const coverResult = await uploadToCloudinary(
      selectedCoverFile,
      "image",
      (pct) => {
        el.progressFill.style.width = `${50 + pct * 0.5}%`;
      },
    );

    el.progressText.textContent = "Đang lưu vào database...";
    await addDoc(collection(db, "songs"), {
      id: songId,
      title,
      artist,
      genre,
      audioUrl: audioResult.url,
      audioPublicId: audioResult.publicId,
      coverUrl: coverResult.url,
      coverPublicId: coverResult.publicId,
      lyrics: lyrics || "",
      createdAt: Date.now(),
      createdAtServer: serverTimestamp(),
    });

    showToast(`Đã thêm "${title}" thành công!`, "success");
    resetForm();
    loadSongList();
  } catch (e) {
    console.error(e);
    showToast("Lỗi khi lưu bài hát: " + e.message, "error");
  } finally {
    el.btnSubmit.disabled = false;
    setTimeout(() => {
      el.progressWrap.classList.remove("active");
      el.progressText.classList.remove("active");
      el.progressFill.style.width = "0%";
    }, 800);
  }
});

function resetForm() {
  el.inputTitle.value = "";
  el.inputArtist.value = "";
  el.inputGenre.value = "Pop";
  fillNextId();
  el.inputLyrics.value = "";
  selectedAudioFile = null;
  selectedCoverFile = null;

  el.audioDropzone.innerHTML = `
    <input type="file" id="audioInput" accept="audio/*" />
    <i class="fa-solid fa-music dz-icon"></i>
    <div class="dz-label">Kéo-thả file MP3 vào đây</div>
    <div class="dz-hint">hoặc bấm để chọn file</div>`;
  el.coverDropzone.innerHTML = `
    <input type="file" id="coverInput" accept="image/*" />
    <i class="fa-solid fa-image dz-icon"></i>
    <div class="dz-label">Kéo-thả ảnh bìa vào đây</div>
    <div class="dz-hint">JPG, PNG — hoặc bấm để chọn</div>`;

  el.audioInput = document.getElementById("audioInput");
  el.coverInput = document.getElementById("coverInput");
  bindAudioDropzone();
  bindCoverDropzone();
}

// --- DANH SÁCH BÀI HÁT ---
async function loadSongList() {
  try {
    const snap = await getDocs(collection(db, "songs"));
    allSongsCache = [];
    snap.forEach((d) => allSongsCache.push({ docId: d.id, ...d.data() }));
    allSongsCache.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderSongTable(allSongsCache);
    fillNextId();
  } catch (e) {
    console.error(e);
    showToast("Không tải được danh sách bài hát: " + e.message, "error");
  }
}

function computeNextId() {
  let maxId = 0;
  allSongsCache.forEach((s) => {
    const n = Number(s.id);
    if (!isNaN(n) && n > maxId) maxId = n;
  });
  return maxId + 1;
}

function fillNextId() {
  el.inputId.value = computeNextId();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSongTable(list) {
  el.songCount.textContent = list.length;
  el.songTableBody.innerHTML = "";
  el.emptyState.style.display = list.length ? "none" : "block";

  list.forEach((song) => {
    const tr = document.createElement("tr");
    const isChecked = selectedSongIds.has(song.docId);
    tr.innerHTML = `
      <td><input type="checkbox" class="bulk-checkbox song-row-checkbox" data-docid="${song.docId}" ${isChecked ? "checked" : ""} /></td>
      <td><img class="thumb" src="${song.coverUrl || ""}" onerror="this.style.opacity=0" /></td>
      <td>
        <div class="s-title">${escapeHtml(song.title || "")}</div>
        <div class="s-artist">${escapeHtml(song.artist || "")}</div>
      </td>
      <td><span class="genre-tag">${escapeHtml(song.genre || "Pop")}</span></td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Sửa" data-edit-docid="${song.docId}">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="icon-btn danger" title="Xóa" data-docid="${song.docId}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    el.songTableBody.appendChild(tr);
  });

  el.songTableBody.querySelectorAll(".icon-btn.danger").forEach((btn) => {
    btn.addEventListener("click", () => confirmDeleteSong(btn.dataset.docid));
  });

  el.songTableBody.querySelectorAll("[data-edit-docid]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const song = allSongsCache.find((s) => s.docId === btn.dataset.editDocid);
      if (song) openEditSongModal(song);
    });
  });

  el.songTableBody.querySelectorAll(".song-row-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      if (e.target.checked) {
        selectedSongIds.add(e.target.dataset.docid);
      } else {
        selectedSongIds.delete(e.target.dataset.docid);
      }
      updateBulkEditToolbar();
    });
  });

  const visibleIds = list.map((s) => s.docId);
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => selectedSongIds.has(id));
  el.checkAllSongs.checked = allVisibleChecked;
}

function updateBulkEditToolbar() {
  const count = selectedSongIds.size;
  if (count > 0) {
    el.bulkEditToolbar.style.display = "flex";
    el.bulkEditSelectedCount.textContent = `Đã chọn ${count} bài hát`;
  } else {
    el.bulkEditToolbar.style.display = "none";
  }
}

el.checkAllSongs.addEventListener("change", (e) => {
  const rows = el.songTableBody.querySelectorAll(".song-row-checkbox");
  rows.forEach((cb) => {
    cb.checked = e.target.checked;
    if (e.target.checked) {
      selectedSongIds.add(cb.dataset.docid);
    } else {
      selectedSongIds.delete(cb.dataset.docid);
    }
  });
  updateBulkEditToolbar();
});

el.btnBulkEditClear.addEventListener("click", () => {
  selectedSongIds.clear();
  updateBulkEditToolbar();
  renderSongTable(currentVisibleSongList());
});

function currentVisibleSongList() {
  const q = el.searchSongs.value.trim().toLowerCase();
  if (!q) return allSongsCache;
  return allSongsCache.filter(
    (s) => (s.title || "").toLowerCase().includes(q) || (s.artist || "").toLowerCase().includes(q),
  );
}

async function confirmDeleteSong(docId) {
  const song = allSongsCache.find((s) => s.docId === docId);
  if (!song) return;
  if (
    !confirm(
      `Xóa bài hát "${song.title}"?\n\nLưu ý: bài hát sẽ biến mất khỏi trang nghe nhạc ngay, nhưng file mp3/ảnh gốc vẫn còn trên Cloudinary (không tốn thêm chi phí gì, chỉ chiếm dung lượng). Có thể xóa file gốc thủ công trong Cloudinary Media Library nếu muốn dọn dẹp.`,
    )
  )
    return;

  try {
    await deleteDoc(doc(db, "songs", docId));
    selectedSongIds.delete(docId);
    updateBulkEditToolbar();
    showToast(`Đã xóa "${song.title}" khỏi danh sách.`, "success");
    loadSongList();
  } catch (e) {
    console.error(e);
    showToast("Lỗi khi xóa: " + e.message, "error");
  }
}

el.searchSongs.addEventListener("input", () => {
  renderSongTable(currentVisibleSongList());
});
