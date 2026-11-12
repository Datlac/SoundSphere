/* =========================================================================
   SOUNDSPHERE WEB — DUAL-DECK DJ CROSSFADE & GAPLESS AUDIO ENGINE
   Kiến trúc: 2 Deck (A/B) + Web Audio API Equal-Power Curve (Cos/Sin)
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

    this.ctx = null;
    this.masterGain = null;
    this.analyser = null;
    this.useWebAudio = true;

    // Khởi tạo 2 mâm đĩa Deck A & Deck B
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
    this._fadeCleanupTimer = null;
    this._fallbackRaf = null;
    this._monitorRaf = null;

    // Kho lưu trữ listener đăng ký thông qua audioProxy (cho main.js & room.js)
    this._listeners = new Map();

    // Facade giả lập HTMLAudioElement để main.js & room.js dùng không cần sửa cấu trúc
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
      sourceNode: null,
      gainNode: null,
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
   * Tạo Proxy mô phỏng thẻ <audio> chuẩn để tương thích 100% với main.js và room.js
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
        const audio = engine.activeDeck.audio;
        if (Number.isFinite(val)) {
          audio.currentTime = val;
        }
      },
      get duration() {
        return engine.activeDeck.audio.duration;
      },
      get paused() {
        return engine.activeDeck.audio.paused;
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
        engine.decks.A.audio.playbackRate = val;
        engine.decks.B.audio.playbackRate = val;
      },
      fastSeek(time) {
        const audio = engine.activeDeck.audio;
        if (typeof audio.fastSeek === "function") {
          audio.fastSeek(time);
        } else {
          audio.currentTime = time;
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
        engine._listeners.get(type).add(listener);
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
    ];

    forwardedEvents.forEach((evtName) => {
      audio.addEventListener(evtName, (e) => {
        // Chỉ phát sự kiện ra UI từ Deck đang giữ vai trò chính
        if (this.activeDeckId !== deckId) return;

        // Khi đang hòa âm, bỏ qua sự kiện pause từ Deck cũ đang tắt dần
        if (evtName === "pause" && this.isCrossfading) return;

        this._emitToProxy(evtName, e);
      });
    });
  }

  /**
   * Khởi tạo Web Audio API AudioContext & 2 GainNode sau thao tác chạm đầu tiên
   */
  async _ensureAudioContext() {
    if (!this.useWebAudio) return;

    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
          this.useWebAudio = false;
          return;
        }
        this.ctx = new AudioCtx();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.masterVolumeValue;

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.82;

        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        ["A", "B"].forEach((key) => {
          const deck = this.decks[key];
          deck.audio.crossOrigin = "anonymous";
          deck.sourceNode = this.ctx.createMediaElementSource(deck.audio);
          deck.gainNode = this.ctx.createGain();
          deck.gainNode.gain.value = key === this.activeDeckId ? 1.0 : 0.0;

          deck.sourceNode.connect(deck.gainNode);
          deck.gainNode.connect(this.masterGain);
        });
      }

      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }
    } catch (err) {
      console.warn("[SoundSphere DJ] Chuyển sang HTML5 Audio Fallback:", err);
      this.useWebAudio = false;
    }
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
    if (this.useWebAudio && this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(
        this.masterVolumeValue,
        this.ctx.currentTime,
      );
    } else if (!this.isCrossfading) {
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

    // Nếu đang có crossfade dở dang từ trước, dọn dẹp ngay
    this._cancelOngoingCrossfade();

    // Xác định thời lượng hòa âm cho lần chuyển bài này
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

    // Đặt lại cờ về manual cho các lần bấm sau
    this.nextTransitionMode = "manual";

    // Nếu không cần hòa âm (lần đầu mở web, hoặc tắt Crossfade, hoặc Guest Listen Room)
    if (fadeSec <= 0) {
      incomingDeck.audio.pause();
      incomingDeck.audio.currentTime = 0;
      this._setDeckGain(incomingDeck, 0.0);

      outgoingDeck.audio.pause();
      if (this.useWebAudio) {
        outgoingDeck.audio.crossOrigin = "anonymous";
      } else {
        outgoingDeck.audio.removeAttribute("crossorigin");
      }
      outgoingDeck.audio.src = newUrl;
      outgoingDeck.currentSrc = newUrl;
      this._setDeckGain(outgoingDeck, 1.0);
      this._pendingCrossfade = null;
      this.preloadedSrc = "";
      return;
    }

    // Có hòa âm: Đảo sang Standby Deck làm Active Deck mới
    this.activeDeckId = incomingDeck.id;

    // Nếu bài này chưa được preload sẵn vào incomingDeck thì nạp ngay
    const normalizedNew = new URL(newUrl, document.baseURI).href;
    const normalizedPreloaded = incomingDeck.audio.src
      ? new URL(incomingDeck.audio.src, document.baseURI).href
      : "";

    if (normalizedPreloaded !== normalizedNew) {
      if (this.useWebAudio) {
        incomingDeck.audio.crossOrigin = "anonymous";
      } else {
        incomingDeck.audio.removeAttribute("crossorigin");
      }
      incomingDeck.audio.src = newUrl;
      incomingDeck.currentSrc = newUrl;
    }

    incomingDeck.audio.currentTime = 0;
    this._setDeckGain(incomingDeck, 0.0);
    this.preloadedSrc = "";

    // Lưu thông tin phiên hòa âm để thực thi ngay khi playActiveDeck() được gọi
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
      if (this.useWebAudio) {
        targetDeck.audio.crossOrigin = "anonymous";
      } else {
        targetDeck.audio.removeAttribute("crossorigin");
      }
      targetDeck.audio.src = nextUrl;
      targetDeck.currentSrc = nextUrl;
      targetDeck.audio.load();
    } catch (e) {
      this.preloadedSrc = "";
    }
  }

  /**
   * Phát nhạc và kích hoạt đường cong hòa âm Equal-Power (Cos/Sin) nếu có
   */
  async playActiveDeck() {
    await this._ensureAudioContext();

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

    this._setDeckGain(this.activeDeck, 1.0);
    return activeAudio.play();
  }

  pauseAllDecks() {
    this._cancelOngoingCrossfade();
    this.decks.A.audio.pause();
    this.decks.B.audio.pause();
    this._setDeckGain(this.activeDeck, 1.0);
    this._setDeckGain(this.standbyDeck, 0.0);
  }

  _buildEqualPowerCurves(steps = 64) {
    const fadeOut = new Float32Array(steps);
    const fadeIn = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      fadeOut[i] = Math.cos(t * 0.5 * Math.PI);
      fadeIn[i] = Math.sin(t * 0.5 * Math.PI);
    }
    return { fadeOut, fadeIn };
  }

  async _runEqualPowerCrossfade(outgoingDeck, incomingDeck, durationSec) {
    // Khống chế thời gian fade không vượt quá phần còn lại của bài cũ
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

    if (
      this.useWebAudio &&
      this.ctx &&
      outgoingDeck.gainNode &&
      incomingDeck.gainNode
    ) {
      const now = this.ctx.currentTime;
      const { fadeOut, fadeIn } = this._buildEqualPowerCurves(64);

      outgoingDeck.gainNode.gain.cancelScheduledValues(now);
      incomingDeck.gainNode.gain.cancelScheduledValues(now);

      outgoingDeck.gainNode.gain.setValueAtTime(1.0, now);
      incomingDeck.gainNode.gain.setValueAtTime(0.0, now);

      outgoingDeck.gainNode.gain.setValueCurveAtTime(
        fadeOut,
        now,
        effectiveSec,
      );
      incomingDeck.gainNode.gain.setValueCurveAtTime(fadeIn, now, effectiveSec);

      outgoingDeck.gainNode.gain.setValueAtTime(0.0, now + effectiveSec + 0.02);
      incomingDeck.gainNode.gain.setValueAtTime(1.0, now + effectiveSec + 0.02);

      const playPromise = incomingDeck.audio.play();

      this._fadeCleanupTimer = setTimeout(
        () => {
          outgoingDeck.audio.pause();
          outgoingDeck.audio.currentTime = 0;
          this.isCrossfading = false;
        },
        effectiveSec * 1000 + 50,
      );

      return playPromise;
    } else {
      // Fallback mượt mà bằng requestAnimationFrame nếu trình duyệt chạy HTML5 Audio thường
      outgoingDeck.audio.volume = this.masterVolumeValue;
      incomingDeck.audio.volume = 0;

      const playPromise = incomingDeck.audio.play();
      const startTime = performance.now();
      const durationMs = effectiveSec * 1000;

      const step = (now) => {
        if (!this.isCrossfading) return;
        const t = Math.min((now - startTime) / durationMs, 1.0);

        outgoingDeck.audio.volume =
          Math.cos(t * 0.5 * Math.PI) * this.masterVolumeValue;
        incomingDeck.audio.volume =
          Math.sin(t * 0.5 * Math.PI) * this.masterVolumeValue;

        if (t < 1.0) {
          this._fallbackRaf = requestAnimationFrame(step);
        } else {
          outgoingDeck.audio.pause();
          outgoingDeck.audio.currentTime = 0;
          outgoingDeck.audio.volume = 0;
          incomingDeck.audio.volume = this.masterVolumeValue;
          this.isCrossfading = false;
        }
      };

      this._fallbackRaf = requestAnimationFrame(step);
      return playPromise;
    }
  }

  _cancelOngoingCrossfade() {
    if (this._fadeCleanupTimer) {
      clearTimeout(this._fadeCleanupTimer);
      this._fadeCleanupTimer = null;
    }
    if (this._fallbackRaf) {
      cancelAnimationFrame(this._fallbackRaf);
      this._fallbackRaf = null;
    }
    if (this.isCrossfading) {
      const inactive = this.standbyDeck;
      inactive.audio.pause();
      inactive.audio.currentTime = 0;
      this._setDeckGain(inactive, 0.0);
      this._setDeckGain(this.activeDeck, 1.0);
      this.isCrossfading = false;
    }
  }

  _setDeckGain(deck, value) {
    if (this.useWebAudio && this.ctx && deck.gainNode) {
      const now = this.ctx.currentTime;
      deck.gainNode.gain.cancelScheduledValues(now);
      deck.gainNode.gain.setValueAtTime(value, now);
    } else {
      deck.audio.volume = value * this.masterVolumeValue;
    }
  }

  /**
   * Vòng lặp giám sát 60FPS: Kích hoạt Preload (15s cuối) và Auto-Crossfade
   */
  _startMonitorLoop() {
    const tick = () => {
      const audio = this.activeDeck.audio;

      if (
        !audio.paused &&
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
