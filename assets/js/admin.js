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
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CHỈ EMAIL NÀY ĐƯỢC PHÉP TRUY CẬP TRANG QUẢN TRỊ ---
const ADMIN_EMAIL = "vnfake20@gmail.com";

// --- CẤU HÌNH CLOUDINARY (upload không cần backend, không cần thẻ, free) ---
// Cloud name lấy từ Dashboard Cloudinary > Product Environment Credentials
const CLOUDINARY_CLOUD_NAME = "drrjy5h2z";
// Tên upload preset KHÔNG DẤU (Unsigned) — xem hướng dẫn tạo preset trong file
// soundsphere_setup_guide.md. Đổi tên này nếu bạn đặt preset khác.
const CLOUDINARY_UPLOAD_PRESET = "soundsphere_unsigned";

// --- CÙNG CONFIG FIREBASE VỚI index.html (chỉ dùng cho Auth + Firestore) ---
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
  bulkTableBody: document.getElementById("bulkTableBody"),
  bulkArtistAll: document.getElementById("bulkArtistAll"),
  btnApplyArtistAll: document.getElementById("btnApplyArtistAll"),
  bulkGenreAll: document.getElementById("bulkGenreAll"),
  btnApplyGenreAll: document.getElementById("btnApplyGenreAll"),
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
  csvProgressText: document.getElementById("csvProgressText"),
  btnCsvImport: document.getElementById("btnCsvImport"),
};

let selectedAudioFile = null;
let selectedCoverFile = null;
let allSongsCache = [];

// State cho Upload Album
let bulkItems = []; // [{ audioFile, coverFile, title, artist, genre, id, status }]

// State cho CSV Import
let csvRows = []; // dữ liệu thô đọc từ file (array of objects, key = tên cột gốc)
let csvHeaders = [];

// --- CHUYỂN TAB ---
el.tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    el.tabButtons.forEach((b) => b.classList.remove("active"));
    el.tabPanels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
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

onAuthStateChanged(auth, (user) => {
  if (!user) {
    showScreen("loggedOut");
    return;
  }
  if ((user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    el.forbiddenEmail.textContent = user.email || "(không có email)";
    showScreen("forbidden");
    return;
  }
  el.adminEmailLabel.textContent = user.email;
  showScreen("app");
  loadSongList();
});

el.btnGoogleLogin.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    showToast("Đăng nhập thất bại: " + e.message, "error");
  }
});

el.btnSignOut.addEventListener("click", () => signOut(auth));
el.btnSignOutForbidden.addEventListener("click", () => signOut(auth));

// --- DROPZONE LOGIC (dùng chung cho audio & cover) ---
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

// =========================================================================
// TAB 2 — UPLOAD ALBUM (NHIỀU FILE CÙNG LÚC)
// =========================================================================

// Lấy tên file không phần mở rộng, dùng để gợi ý tên bài hát & để ghép cặp ảnh/mp3
function fileBaseName(name) {
  return name.replace(/\.[^/.]+$/, "");
}

// Dọn tên file thành tên bài hát dễ đọc: bỏ gạch dưới/gạch ngang, viết hoa đầu mỗi chữ
function prettifyFileName(name) {
  const base = fileBaseName(name).replace(/[_\-]+/g, " ").trim();
  return base
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
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

// Ghép cặp mp3 + ảnh theo thứ tự (sau khi sort theo tên) — đơn giản và dễ đoán
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
    title: prettifyFileName(audioFile.name),
    artist: "",
    genre: "Pop",
    id: null, // sẽ gán lúc render (vì cần biết allSongsCache)
    status: "pending", // pending | done | error
    statusMsg: "",
  }));

  renderBulkTable();
  el.bulkTableSection.style.display = "block";
}

function renderBulkTable() {
  el.bulkFileCount.textContent = `${bulkItems.length} bài hát sẵn sàng`;

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
    row.className = "bulk-row";
    const coverPreview = item.coverFile
      ? `<img class="bulk-thumb" src="${URL.createObjectURL(item.coverFile)}" />`
      : `<div class="bulk-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)"><i class="fa-solid fa-image"></i></div>`;

    row.innerHTML = `
      ${coverPreview}
      <input type="text" class="bulk-title" value="${escapeHtml(item.title)}" />
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

    row.querySelector(".bulk-title").addEventListener("input", (e) => {
      bulkItems[idx].title = e.target.value;
    });
    row.querySelector(".bulk-artist").addEventListener("input", (e) => {
      bulkItems[idx].artist = e.target.value;
    });
    row.querySelector(".bulk-genre").addEventListener("change", (e) => {
      bulkItems[idx].genre = e.target.value;
    });
    row.querySelector(".bulk-id").addEventListener("input", (e) => {
      bulkItems[idx].id = Number(e.target.value);
    });
    row.querySelector(".bulk-remove").addEventListener("click", () => {
      bulkItems.splice(idx, 1);
      renderBulkTable();
    });

    el.bulkTableBody.appendChild(row);
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

el.btnBulkSubmit.addEventListener("click", async () => {
  if (bulkItems.length === 0) {
    showToast("Chưa có bài hát nào để lưu.", "error");
    return;
  }

  // Validate: tên bài hát + ca sĩ bắt buộc, ID không trùng nhau trong chính lô này
  const missingInfo = bulkItems.some((it) => !it.title.trim() || !it.artist.trim());
  if (missingInfo) {
    showToast("Vui lòng điền đủ tên bài hát và ca sĩ cho tất cả các dòng.", "error");
    return;
  }
  const idSet = new Set();
  for (const it of bulkItems) {
    if (idSet.has(it.id)) {
      showToast(`ID ${it.id} bị trùng trong danh sách đang upload. Hãy sửa lại.`, "error");
      return;
    }
    idSet.add(it.id);
  }

  el.btnBulkSubmit.disabled = true;
  let successCount = 0;

  for (let i = 0; i < bulkItems.length; i++) {
    const item = bulkItems[i];
    el.bulkProgressText.textContent = `Đang xử lý ${i + 1}/${bulkItems.length}: ${item.title}...`;
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
      // Tiếp tục với bài tiếp theo thay vì dừng toàn bộ
    }
  }

  el.bulkProgressText.textContent = `Hoàn tất: ${successCount}/${bulkItems.length} bài hát đã lưu thành công.`;
  showToast(`Đã thêm ${successCount}/${bulkItems.length} bài hát.`, "success");
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
// TAB 3 — NHẬP TỪ CSV/EXCEL (DI CHUYỂN DỮ LIỆU CŨ, KHÔNG UPLOAD LẠI FILE)
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

// Tự đoán cột dựa trên tên cột phổ biến, người dùng vẫn có thể đổi lại
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

  // Tóm tắt: đếm dòng thiếu dữ liệu bắt buộc theo mapping hiện tại
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
}

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

  const validRows = csvRows.filter(
    (row) => row[titleCol] && row[artistCol] && row[coverCol] && row[srcCol],
  );

  if (validRows.length === 0) {
    showToast("Không có dòng hợp lệ nào để nhập.", "error");
    return;
  }

  el.btnCsvImport.disabled = true;

  let successCount = 0;
  let failCount = 0;
  const BATCH_SIZE = 400; // Firestore giới hạn 500 ghi/batch, để dư cho an toàn

  for (let start = 0; start < validRows.length; start += BATCH_SIZE) {
    const chunk = validRows.slice(start, start + BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach((row) => {
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

    el.csvProgressText.textContent = `Đang nhập ${Math.min(start + BATCH_SIZE, validRows.length)}/${validRows.length} bài hát...`;

    try {
      await batch.commit();
      successCount += chunk.length;
    } catch (e) {
      console.error(e);
      failCount += chunk.length;
    }
  }

  el.csvProgressText.textContent = `Hoàn tất: ${successCount} bài hát đã nhập thành công${failCount > 0 ? `, ${failCount} bài lỗi` : ""}.`;
  showToast(`Đã nhập ${successCount} bài hát từ file.`, "success");
  el.btnCsvImport.disabled = false;

  csvRows = [];
  csvHeaders = [];
  el.csvMappingSection.style.display = "none";
  el.csvInput.value = "";
  loadSongList();
});

// --- UPLOAD HELPER: upload 1 file lên Cloudinary (unsigned), trả về secure_url, báo % tiến trình ---
// Dùng resource_type khác nhau: "video" cho audio (Cloudinary coi audio như video),
// "image" cho ảnh bìa.
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

// --- SUBMIT: validate -> upload audio -> upload cover -> save Firestore doc ---
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

  // ID: dùng giá trị trên ô input nếu hợp lệ, không thì tự tính lại
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
      "video", // Cloudinary dùng resource_type "video" cho cả file audio
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

  // Re-bind vì innerHTML đã thay input cũ bằng node mới
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

// Tính ID kế tiếp = ID số lớn nhất hiện có trong danh sách + 1 (bắt đầu từ 1 nếu trống)
function computeNextId() {
  let maxId = 0;
  allSongsCache.forEach((s) => {
    const n = Number(s.id);
    if (!isNaN(n) && n > maxId) maxId = n;
  });
  return maxId + 1;
}

// Điền sẵn ô ID với giá trị tự động tính được (không ghi đè nếu người dùng đang gõ tay)
function fillNextId() {
  el.inputId.value = computeNextId();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderSongTable(list) {
  el.songCount.textContent = list.length;
  el.songTableBody.innerHTML = "";
  el.emptyState.style.display = list.length ? "none" : "block";

  list.forEach((song) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><img class="thumb" src="${song.coverUrl || ""}" onerror="this.style.opacity=0" /></td>
      <td>
        <div class="s-title">${escapeHtml(song.title || "")}</div>
        <div class="s-artist">${escapeHtml(song.artist || "")}</div>
      </td>
      <td><span class="genre-tag">${escapeHtml(song.genre || "Pop")}</span></td>
      <td>
        <div class="row-actions">
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
    showToast(`Đã xóa "${song.title}" khỏi danh sách.`, "success");
    loadSongList();
  } catch (e) {
    console.error(e);
    showToast("Lỗi khi xóa: " + e.message, "error");
  }
}

// --- TÌM KIẾM TRONG DANH SÁCH ---
el.searchSongs.addEventListener("input", () => {
  const q = el.searchSongs.value.trim().toLowerCase();
  if (!q) {
    renderSongTable(allSongsCache);
    return;
  }
  const filtered = allSongsCache.filter(
    (s) =>
      (s.title || "").toLowerCase().includes(q) ||
      (s.artist || "").toLowerCase().includes(q),
  );
  renderSongTable(filtered);
});
