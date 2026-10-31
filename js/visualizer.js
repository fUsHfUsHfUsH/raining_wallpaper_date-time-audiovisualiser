/**
 * Rainy Window - Audio visualizer overlay (dot spectrum).
 *
 * Ported from the Media.Parallax wallpaper (rocksdanister): mirrored dot columns
 * around the vertical center of the screen, dots tapering with height.
 *
 * Audio sources (first available wins):
 *   1. Lively system audio - livelyAudioListener() callback, enabled via "--audio"
 *      in LivelyInfo.json. Returns a 128 length array, values typically 0-1.
 *   2. Microphone          - Web Audio API, opt-in from the GUI (browser preview).
 *   3. Demo spectrum       - synthesised beat, used for local browser preview.
 *
 * Raw FFT bins are linear, so music energy sits in the first few bins and the
 * columns hug the left edge. The spectrum is resampled on a log curve, lifted
 * towards the highs and softened with a gamma curve so the whole width moves.
 * A depth fade dims and tapers the dot tips.
 */
class RainVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    this.settings = {
      enabled: true,
      amplitude: 8, //dots drawn per full-volume column (verticalScale)
      dotScale: 0.5, //dot size multiplier
      sortingMode: 2, //0: concentrated, 1: center-split, 2: keep original
      color: "#ffffff",
      rainbow: false,
      depth: 0.65, //0: flat dots, 1: tips fade out completely
      balance: 0.6, //high frequency lift, 0: raw spectrum, 1: strong
    };

    this.rainbowColors = ["#bc626b", "#cf876f", "#eacb8a", "#a3bd8d", "#88c0cf", "#b38ead"];
    this.cssWidth = window.innerWidth;
    this.cssHeight = window.innerHeight;
    this.currentArray = [];

    this.isLively = /lively/i.test(navigator.userAgent);
    this.source = "demo"; // "lively" | "mic" | "demo"
    this.livelyData = null;
    this.audioCtx = null;
    this.micStream = null;
    this.micAnalyser = null;
    this.micFreqData = null;
    this.micLevels = new Float32Array(128);
    this.demoSpectrum = new Float32Array(128);
    this.demoTime = 0;

    //display bands (columns) resampled from the raw FFT bins
    this.bandCount = 128;
    this.bands = new Float32Array(this.bandCount);
    this.tilted = new Float32Array(this.bandCount);
    this.spectrumPeak = 0;

    //idle mode: nothing audible -> wave animation + "waiting" state
    this.waveBands = new Float32Array(this.bandCount);
    this.waveTime = 0;
    this.silentTime = 0;
    this.idle = false;
    this.lastIdle = false;
    this.forceIdle = false; //browser preview of the idle wave
    this.onIdleChange = null;

    //audio diagnostics (debug overlay)
    this.audioDebug = false;
    this.livelyPackets = 0;
    this.livelyMax = NaN;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssWidth = window.innerWidth;
    this.cssHeight = window.innerHeight;
    this.canvas.width = Math.floor(this.cssWidth * dpr);
    this.canvas.height = Math.floor(this.cssHeight * dpr);
    this.canvas.style.width = this.cssWidth + "px";
    this.canvas.style.height = this.cssHeight + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    //canvas resize clears it - redraw the frozen frame if paused
    if (this.currentArray.length) this.renderAnimation(this.currentArray);
  }

  // Lively system audio: 128 length array, values typically 0-1.
  setLivelyData(audioArray) {
    this.livelyData = audioArray;
    this.source = "lively";
    //diagnostics for the audio-debug overlay
    this.livelyPackets++;
    this.livelyMax = audioArray ? Math.max(...audioArray) : NaN;
  }

  // Running inside Lively: no audio data means silence, never the demo beat.
  setLivelyMode() {
    this.isLively = true;
    if (this.source === "demo") this.source = "lively";
  }

  async useMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
      this.micStream = stream;
      this.micAnalyser = this.audioCtx.createAnalyser();
      this.micAnalyser.fftSize = 256; // -> 128 bins, same as Lively
      this.micAnalyser.smoothingTimeConstant = 0.55;
      // not connected to destination: listen only, no feedback
      this.audioCtx.createMediaStreamSource(stream).connect(this.micAnalyser);
      this.micFreqData = new Uint8Array(this.micAnalyser.frequencyBinCount);
      this.source = "mic";
    } catch (e) {
      console.warn("Microphone unavailable:", e);
      this.useDemo();
    }
  }

  useDemo() {
    this.stopMicrophone();
    //inside Lively the demo beat is unwanted, hand control back to system audio
    this.source = this.isLively ? "lively" : "demo";
  }

  stopMicrophone() {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    this.micAnalyser = null;
  }

  // Synthesised spectrum so the visualizer is alive in browser preview.
  updateDemo(dt) {
    this.demoTime += dt;
    const t = this.demoTime;
    const beatT = (t * 2) % 1; // 120bpm kick
    const kick = Math.pow(Math.max(0, 1 - beatT * 4), 3);
    const hatT = (t * 4 + 0.5) % 1; // off-beat hats
    const hat = Math.pow(Math.max(0, 1 - hatT * 8), 4);
    const swell = 0.5 + 0.5 * Math.sin(t * 0.9); // slow melodic swell

    for (let i = 0; i < this.demoSpectrum.length; i++) {
      const f = i / (this.demoSpectrum.length - 1);
      let v = kick * Math.exp(-f * 9) * 0.95; // bass hits
      v += hat * (0.25 + 0.4 * Math.random()) * Math.pow(f, 0.7) * 0.7; // noise hats
      v += swell * 0.35 * Math.exp(-Math.pow((f - 0.3 - 0.15 * Math.sin(t * 0.37)) * 5, 2)); // moving mid swell
      v += 0.06 * Math.abs(Math.sin(i * 12.9898 + t * 3.1)); // floor texture
      this.demoSpectrum[i] = Math.min(1, v);
    }
  }

  // Returns the active spectrum normalized to 0-1, or null when silent.
  getRawSpectrum(dt) {
    if (this.source === "lively" && this.livelyData) return this.livelyData;
    if (this.source === "mic" && this.micAnalyser) {
      this.micAnalyser.getByteFrequencyData(this.micFreqData);
      for (let i = 0; i < this.micFreqData.length; i++) this.micLevels[i] = this.micFreqData[i] / 255;
      return this.micLevels;
    }
    // Under Lively, no data yet means silence; in the browser fall back to the demo beat.
    if (this.isLively) return null;
    this.updateDemo(dt);
    return this.demoSpectrum;
  }

  // Resample the raw linear FFT bins onto log-spaced display bands, lift the
  // highs, normalize globally and apply a gamma curve so quiet bands stay
  // visible without every column ending up the same height.
  analyse(raw) {
    const bands = this.bands;
    const tilted = this.tilted;
    const bins = raw.length;
    const count = bands.length;
    const usable = Math.max(8, Math.floor(bins * 0.75)); //skip near-silent top bins
    const balance = this.settings.balance;
    let loudest = 0;

    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const pos = Math.pow(usable, t) - 1; //log frequency position
      const lo = Math.min(bins - 1, Math.floor(pos));
      const hi = Math.min(bins - 1, lo + 1);
      const frac = pos - lo;
      let v = raw[lo] * (1 - frac) + raw[hi] * frac;
      v *= 1 + balance * 2.2 * t; //tilt towards the highs
      tilted[i] = v;
      if (v > loudest) loudest = v;
    }

    //slow decay keeps quiet passages from blowing back up to full height
    this.spectrumPeak = Math.max(loudest, this.spectrumPeak * 0.995);
    const peak = Math.max(this.spectrumPeak, 0.0001);
    const level = Math.min(1, peak * 1.6);
    const gate = peak * 0.02;

    for (let i = 0; i < count; i++) {
      let v = tilted[i];
      if (v < gate) v = 0;
      const target = Math.pow(Math.min(1, v / peak), 0.55) * level;
      const current = bands[i];
      //fast attack, slow release
      bands[i] = current + (target - current) * (target > current ? 0.6 : 0.1);
    }
    return bands;
  }

  // Idle wave when no media can be heard: a single hump travels left to
  // right and back again in a loop.
  updateWave(dt) {
    this.waveTime += dt;
    //ping-pong position 0 -> 1 -> 0, one full sweep every 7 seconds
    const c = 0.5 - 0.5 * Math.cos((this.waveTime / 7) * Math.PI * 2);
    const bands = this.waveBands;
    const count = bands.length;

    for (let i = 0; i < count; i++) {
      const p = i / (count - 1);
      const target = 0.5 * Math.exp(-Math.pow((p - c) / 0.14, 2));
      //ease so entering/exiting idle mode blends in smoothly
      bands[i] += (target - bands[i]) * 0.35;
    }
  }

  //spectrum sorting, ported from Media.Parallax
  concentratedSort(audioArray) {
    audioArray.sort((a, b) => a - b).splice(0, audioArray.length * 0.75);
    audioArray.push(...[...audioArray].reverse());
    return audioArray;
  }

  centeredSort(audioArray) {
    const newHalf = audioArray.splice(0, audioArray.length * 0.5);
    audioArray.reverse().push(...newHalf);
    return audioArray;
  }

  applySort(array) {
    switch (this.settings.sortingMode) {
      case 0:
        return this.concentratedSort(array);
      case 1:
        return this.centeredSort(array);
      default:
        return array;
    }
  }

  //dot columns mirrored around the vertical center, ported from Media.Parallax
  renderAnimation(audioArray) {
    const { ctx, settings } = this;
    const TAU = Math.PI * 2;
    const width = this.cssWidth;
    const midY = this.cssHeight / 2;
    const verticalScale = settings.amplitude;
    const numDots = settings.sortingMode === 0 ? 128 : 256;
    const dotSize = settings.dotScale * (width / numDots);
    const depth = Math.max(0, Math.min(1, settings.depth));

    ctx.clearRect(0, 0, width, this.cssHeight);

    for (let x = 0; x < audioArray.length; x++) {
      const soundVal = audioArray[x];
      if (soundVal <= 0.005) continue; //below this a column is just a noise dot
      if (settings.rainbow) ctx.fillStyle = this.rainbowColors[x % this.rainbowColors.length] || settings.color;
      else ctx.fillStyle = settings.color;

      const dots = soundVal * verticalScale;
      const xPos = (x / audioArray.length) * width;

      for (let y = 0; y < dots; y++) {
        const t = y / dots; //0 at the center, 1 at the tip
        const yPos = y * dotSize * 2;
        //taper with height, not with volume, so quiet columns stay visible
        const arcRadius = dotSize * (1 - 0.7 * t);
        ctx.globalAlpha = 1 - depth * t;

        ctx.beginPath();
        ctx.arc(xPos, midY - yPos, arcRadius, 0, TAU);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(xPos, midY + yPos, arcRadius, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  render(dt) {
    if (!this.settings.enabled) {
      this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
      return;
    }
    if (dt <= 0) return; //paused: keep the last frame

    const raw = this.getRawSpectrum(dt);
    //no audible content for a moment -> idle wave + "waiting for media"
    const rawMax = raw ? Math.max(...raw) : 0;
    if (rawMax < 0.012) this.silentTime += dt;
    else this.silentTime = 0;
    this.idle = this.forceIdle || (this.source !== "demo" && this.silentTime > 0.75);

    if (this.idle) {
      this.updateWave(dt);
      this.currentArray = this.applySort(Array.from(this.waveBands));
    } else if (raw) {
      this.currentArray = this.applySort(Array.from(this.analyse(raw)));
    }
    this.renderAnimation(this.currentArray);

    if (this.idle !== this.lastIdle) {
      if (this.idle) this.waveTime = 0; //always start the sweep from the left
      this.lastIdle = this.idle;
      if (this.onIdleChange) this.onIdleChange(this.idle);
    }
  }
}
