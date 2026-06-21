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

  progressWrap: document.getElementById("progressWrap"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  btnSubmit: document.getElementById("btnSubmit"),

  songTableBody: document.getElementById("songTableBody"),
  songCount: document.getElementById("songCount"),
  emptyState: document.getElementById("emptyState"),
  searchSongs: document.getElementById("searchSongs"),

  toast: document.getElementById("toast"),
};

let selectedAudioFile = null;
let selectedCoverFile = null;
let allSongsCache = [];

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
      id: idRaw ? Number(idRaw) : Date.now(),
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
  el.inputId.value = "";
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
  } catch (e) {
    console.error(e);
    showToast("Không tải được danh sách bài hát: " + e.message, "error");
  }
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
