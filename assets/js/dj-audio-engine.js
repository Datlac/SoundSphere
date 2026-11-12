/* =========================================================================
   SOUNDSPHERE WEB — DUAL-DECK DJ CROSSFADE & GAPLESS AUDIO ENGINE (FIXED)
   Kiến trúc: 2 Deck (A/B) + Equal-Power Volume Curve (Cos/Sin) + Seek Safe
   ========================================================================= */

class SoundSphereDJEngine {
  constructor(primaryAudioElement, options = {}) {
    this.crossfadeDuration = this._loadSavedDuration(); // Mặc định 5 giây
    this.manualFadeDuration = 0.45; // Hòa âm nhanh 0.45s khi bấm Next/chọn bài thủ công
    this.preloadLeadSeconds = 15; // Tải đệm trước bài kế tiếp khi còn 15s
    this.masterVolumeValue = options.initialVolume ?? 0.8;

    // Callbacks kết nối với main.js
    this.onNeedAutoNext = options.onNeedAutoNext || (() => {});
    this.onNeedPreloadNext = options.onNeedPreloadNext || (() => null);
    this.isRepeatOne = options.isRepeatOne || (() => false);
    this.isGuestInRoom = options.isGuestInRoom || (() => false);

    // Khởi tạo 2 Deck HTML5 Audio độc lập (không ép CORS để tua mượt mọi link & chạy nền ổn định)
    const deckBAudio = new Audio();
    deckBAudio.preload = "auto";
    primaryAudioElement.preload = "auto";

    this.decks = {
      A: this._initDeck("A", primaryAudioElement),
      B: this._initDeck("B", deckBAudio),
    };

    this.activeDeckId = "A";
    this.isCrossfading = false;
    this.preloadedSrc = "";
    this.nextTransitionMode = "manual"; // 'auto' | 'manual' | 'instant'
    this._pendingCrossfade = null;
    this._suppressEventsOnDeck = null;

    this._fadeRaf = null;
    this._fadeBackupInterval = null;
    this._monitorRaf = null;

    // Kho lưu trữ listener đăng ký thông qua audioProxy (cho main.js & room.js)
    this._listeners = new Map();

    // Facade giả lập HTMLAudioElement
    this.audioProxy = this._createAudioProxy();

    this._bindDeckEvents("A");
    this._bindDeckEvents("B");
    this._startMonitorLoop();
  }

  _loadSavedDuration() {
    const saved = localStorage.getItem("ss_crossfade_sec");
    if (saved !== null && !isNaN(Number(saved))) {
      return Math.max(0, Math.min(12, Number(saved)));
    }
    return 5;
  }

  _initDeck(id, audioEl) {
    return {
      id,
      audio: audioEl,
      currentSrc: "",
    };
  }

  get activeDeck() {
    return this.decks[this.activeDeckId];
  }

  get standbyDeck() {
    return this.decks[this.activeDeckId === "A" ? "B" : "A"];
  }

  /**
   * Proxy mô phỏng thẻ <audio> chuẩn, hỗ trợ đầy đủ ép kiểu số khi tua (seek)
   */
  _createAudioProxy() {
    const engine = this;
    return {
      get src() {
        return engine.activeDeck.audio.src;
      },
      set src(val) {
        engine._prepareActiveSrc(val);
      },
      get currentTime() {
        return engine.activeDeck.audio.currentTime;
      },
      set currentTime(val) {
        // Ép kiểu Number() vì input[type="range"].value luôn trả về String
        const num = Number(val);
        if (!Number.isFinite(num) || num < 0) return;

        // Nếu người dùng tua thủ công trong lúc đang crossfade -> hủy crossfade để giữ âm lượng chuẩn
        if (engine.isCrossfading) {
          engine._cancelOngoingCrossfade();
        }

        const audio = engine.activeDeck.audio;
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = Math.min(num, audio.duration);
        } else {
          audio.currentTime = num;
        }
      },
      get duration() {
        return engine.activeDeck.audio.duration;
      },
      get paused() {
        return engine.activeDeck.audio.paused;
      },
      get seeking() {
        return engine.activeDeck.audio.seeking;
      },
      get readyState() {
        return engine.activeDeck.audio.readyState;
      },
      get volume() {
        return engine.masterVolumeValue;
      },
      set volume(val) {
        engine.setMasterVolume(val);
      },
      get playbackRate() {
        return engine.activeDeck.audio.playbackRate;
      },
      set playbackRate(val) {
        const rate = Number(val) || 1.0;
        engine.decks.A.audio.playbackRate = rate;
        engine.decks.B.audio.playbackRate = rate;
      },
      fastSeek(time) {
        const num = Number(time);
        if (!Number.isFinite(num) || num < 0) return;
        const audio = engine.activeDeck.audio;
        if (typeof audio.fastSeek === "function") {
          audio.fastSeek(num);
        } else {
          audio.currentTime = num;
        }
      },
      play() {
        return engine.playActiveDeck();
      },
      pause() {
        engine.pauseAllDecks();
      },
      load() {
        engine.activeDeck.audio.load();
      },
      addEventListener(type, listener, options) {
        if (!listener) return;
        if (!engine._listeners.has(type)) {
          engine._listeners.set(type, new Set());
        }
        if (options && options.once) {
          const onceWrapper = function (e) {
            engine.audioProxy.removeEventListener(type, onceWrapper);
            listener.call(engine.audioProxy, e);
          };
          engine._listeners.get(type).add(onceWrapper);
        } else {
          engine._listeners.get(type).add(listener);
        }
      },
      removeEventListener(type, listener) {
        const set = engine._listeners.get(type);
        if (set) set.delete(listener);
      },
    };
  }

  _emitToProxy(type, event) {
    const set = this._listeners.get(type);
    if (!set) return;
    set.forEach((fn) => {
      try {
        fn.call(this.audioProxy, event);
      } catch (e) {
        console.error(`[DJ Engine] Lỗi listener "${type}":`, e);
      }
    });
  }

  _bindDeckEvents(deckId) {
    const deck = this.decks[deckId];
    const audio = deck.audio;
    const forwardedEvents = [
      "timeupdate",
      "loadedmetadata",
      "loadeddata",
      "loadstart",
      "playing",
      "play",
      "pause",
      "ended",
      "error",
      "waiting",
      "canplay",
      "seeking",
      "seeked",
    ];

    forwardedEvents.forEach((evtName) => {
      audio.addEventListener(evtName, (e) => {
        if (this.activeDeckId !== deckId) return;
        if (this._suppressEventsOnDeck === deckId) return;
        if (evtName === "pause" && this.isCrossfading) return;

        this._emitToProxy(evtName, e);
      });
    });
  }

  setNextTransitionMode(mode) {
    this.nextTransitionMode = mode; // 'auto' | 'manual' | 'instant'
  }

  setCrossfadeDuration(seconds) {
    const val = Math.max(0, Math.min(12, Number(seconds) || 0));
    this.crossfadeDuration = val;
    localStorage.setItem("ss_crossfade_sec", String(val));
  }

  setMasterVolume(val) {
    this.masterVolumeValue = Math.max(0, Math.min(1, Number(val) || 0));
    if (!this.isCrossfading) {
      this.activeDeck.audio.volume = this.masterVolumeValue;
    }
  }

  /**
   * Nạp nguồn bài hát mới vào hệ thống Dual-Deck
   */
  _prepareActiveSrc(newUrl) {
    if (!newUrl) return;

    const outgoingDeck = this.activeDeck;
    const incomingDeck = this.standbyDeck;
    const isGuest = this.isGuestInRoom();

    this._cancelOngoingCrossfade();

    const wasPlaying =
      !outgoingDeck.audio.paused && outgoingDeck.audio.currentTime > 0.2;
    let fadeSec = 0;

    if (!isGuest && wasPlaying && this.nextTransitionMode !== "instant") {
      if (this.nextTransitionMode === "auto") {
        fadeSec = this.crossfadeDuration;
      } else if (
        this.nextTransitionMode === "manual" &&
        this.crossfadeDuration > 0
      ) {
        fadeSec = this.manualFadeDuration;
      }
    }

    this.nextTransitionMode = "manual";

    // Trường hợp phát trực tiếp không chồng âm (mở bài đầu tiên, tắt crossfade, hoặc Guest phòng nghe chung)
    if (fadeSec <= 0) {
      this._suppressEventsOnDeck = outgoingDeck.id;
      outgoingDeck.audio.pause();
      this._suppressEventsOnDeck = null;

      incomingDeck.audio.pause();
      incomingDeck.audio.currentTime = 0;
      incomingDeck.audio.volume = 0;

      outgoingDeck.audio.src = newUrl;
      outgoingDeck.currentSrc = newUrl;
      outgoingDeck.audio.volume = this.masterVolumeValue;
      this._pendingCrossfade = null;
      this.preloadedSrc = "";
      return;
    }

    // Trường hợp có hòa âm DJ: Đảo sang Standby Deck làm Active Deck mới
    this.activeDeckId = incomingDeck.id;

    let normalizedNew = newUrl;
    let normalizedPreloaded = incomingDeck.audio.src || "";
    try {
      normalizedNew = new URL(newUrl, document.baseURI).href;
      if (normalizedPreloaded) {
        normalizedPreloaded = new URL(normalizedPreloaded, document.baseURI)
          .href;
      }
    } catch (_) {}

    if (normalizedPreloaded !== normalizedNew) {
      incomingDeck.audio.src = newUrl;
      incomingDeck.currentSrc = newUrl;
    }

    incomingDeck.audio.currentTime = 0;
    incomingDeck.audio.volume = 0;
    this.preloadedSrc = "";

    this._pendingCrossfade = {
      outgoingDeck,
      incomingDeck,
      durationSec: fadeSec,
    };
  }

  /**
   * Tải đệm ngầm bài tiếp theo vào Standby Deck trước khi hết bài 15s
   */
  preloadNextUrl(nextUrl) {
    if (!nextUrl || this.isCrossfading || this.isGuestInRoom()) return;
    if (this.preloadedSrc === nextUrl) return;

    const targetDeck = this.standbyDeck;
    if (!targetDeck.audio.paused) return;

    this.preloadedSrc = nextUrl;
    try {
      targetDeck.audio.src = nextUrl;
      targetDeck.currentSrc = nextUrl;
      targetDeck.audio.load();
    } catch (_) {
      this.preloadedSrc = "";
    }
  }

  /**
   * Phát nhạc và kích hoạt đường cong hòa âm Equal-Power (Cos/Sin)
   */
  playActiveDeck() {
    const activeAudio = this.activeDeck.audio;

    if (this._pendingCrossfade) {
      const { outgoingDeck, incomingDeck, durationSec } =
        this._pendingCrossfade;
      this._pendingCrossfade = null;
      return this._runEqualPowerCrossfade(
        outgoingDeck,
        incomingDeck,
        durationSec,
      );
    }

    activeAudio.volume = this.masterVolumeValue;
    return activeAudio.play();
  }

  pauseAllDecks() {
    this._cancelOngoingCrossfade();
    this.decks.A.audio.pause();
    this.decks.B.audio.pause();
    this.activeDeck.audio.volume = this.masterVolumeValue;
    this.standbyDeck.audio.volume = 0;
  }

  _runEqualPowerCrossfade(outgoingDeck, incomingDeck, durationSec) {
    const outRemaining =
      Number.isFinite(outgoingDeck.audio.duration) &&
      outgoingDeck.audio.duration > 0
        ? Math.max(
            0.35,
            outgoingDeck.audio.duration - outgoingDeck.audio.currentTime,
          )
        : durationSec;
    const effectiveSec = Math.min(durationSec, outRemaining);

    this.isCrossfading = true;
    outgoingDeck.audio.volume = this.masterVolumeValue;
    incomingDeck.audio.volume = 0;

    const playPromise = incomingDeck.audio.play();
    const startTime = performance.now();
    const durationMs = effectiveSec * 1000;

    const updateVolumes = () => {
      if (!this.isCrossfading) return;
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / durationMs, 1.0);

      // Đường cong Equal-Power (Cos / Sin) giữ tổng năng lượng âm thanh không bị hụt
      outgoingDeck.audio.volume = Math.max(
        0,
        Math.min(1, Math.cos(t * 0.5 * Math.PI) * this.masterVolumeValue),
      );
      incomingDeck.audio.volume = Math.max(
        0,
        Math.min(1, Math.sin(t * 0.5 * Math.PI) * this.masterVolumeValue),
      );

      if (t >= 1.0) {
        this._finishCrossfade(outgoingDeck, incomingDeck);
      } else {
        this._fadeRaf = requestAnimationFrame(updateVolumes);
      }
    };

    this._fadeRaf = requestAnimationFrame(updateVolumes);

    // Bộ đếm dự phòng chạy mỗi 60ms để crossfade vẫn mượt khi người dùng chuyển sang tab trình duyệt khác
    this._fadeBackupInterval = setInterval(() => {
      if (!this.isCrossfading) {
        clearInterval(this._fadeBackupInterval);
        this._fadeBackupInterval = null;
        return;
      }
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / durationMs, 1.0);
      outgoingDeck.audio.volume = Math.max(
        0,
        Math.min(1, Math.cos(t * 0.5 * Math.PI) * this.masterVolumeValue),
      );
      incomingDeck.audio.volume = Math.max(
        0,
        Math.min(1, Math.sin(t * 0.5 * Math.PI) * this.masterVolumeValue),
      );
      if (t >= 1.0) {
        this._finishCrossfade(outgoingDeck, incomingDeck);
      }
    }, 60);

    return playPromise;
  }

  _finishCrossfade(outgoingDeck, incomingDeck) {
    if (this._fadeRaf) {
      cancelAnimationFrame(this._fadeRaf);
      this._fadeRaf = null;
    }
    if (this._fadeBackupInterval) {
      clearInterval(this._fadeBackupInterval);
      this._fadeBackupInterval = null;
    }
    this.isCrossfading = false;
    outgoingDeck.audio.pause();
    outgoingDeck.audio.currentTime = 0;
    outgoingDeck.audio.volume = 0;
    incomingDeck.audio.volume = this.masterVolumeValue;
  }

  _cancelOngoingCrossfade() {
    if (this._fadeRaf) {
      cancelAnimationFrame(this._fadeRaf);
      this._fadeRaf = null;
    }
    if (this._fadeBackupInterval) {
      clearInterval(this._fadeBackupInterval);
      this._fadeBackupInterval = null;
    }
    if (this.isCrossfading) {
      const inactive = this.standbyDeck;
      inactive.audio.pause();
      inactive.audio.currentTime = 0;
      inactive.audio.volume = 0;
      this.activeDeck.audio.volume = this.masterVolumeValue;
      this.isCrossfading = false;
    }
  }

  /**
   * Vòng lặp giám sát: Kích hoạt Preload (15s cuối) và Auto-Crossfade
   */
  _startMonitorLoop() {
    const tick = () => {
      const audio = this.activeDeck.audio;

      if (
        !audio.paused &&
        !audio.seeking &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0 &&
        !this.isRepeatOne() &&
        !this.isGuestInRoom()
      ) {
        const remaining = audio.duration - audio.currentTime;

        // 1. Còn <= 15s -> Tải đệm ngầm bài tiếp theo vào Deck chờ
        if (
          remaining <= this.preloadLeadSeconds &&
          remaining > this.crossfadeDuration + 1
        ) {
          const nextSong = this.onNeedPreloadNext();
          if (nextSong && nextSong.src) {
            this.preloadNextUrl(nextSong.src);
          }
        }

        // 2. Còn <= crossfadeDuration -> Tự động kích hoạt hòa âm DJ sang bài kế tiếp
        if (
          this.crossfadeDuration > 0 &&
          !this.isCrossfading &&
          remaining <= this.crossfadeDuration &&
          remaining > 0.25
        ) {
          this.nextTransitionMode = "auto";
          this.onNeedAutoNext();
        }
      }

      this._monitorRaf = requestAnimationFrame(tick);
    };

    this._monitorRaf = requestAnimationFrame(tick);
  }
}

window.SoundSphereDJEngine = SoundSphereDJEngine;
