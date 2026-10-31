/**
 * Rainy Window - Now Playing display.
 *
 * Shows the song title and artist currently playing on the system.
 * powered by Lively's "--system-nowplaying" (livelyCurrentTrack()).
 * Hidden when no track is available. Sits just below the mirrored
 * dot columns of the audio visualizer.
 */
class NowPlaying {
  constructor(visualizer) {
    this.el = document.createElement("div");
    this.el.id = "nowplaying";
    this.el.innerHTML = '<div class="np-title"></div><div class="np-artist"></div>';
    document.body.appendChild(this.el);

    this.titleEl = this.el.querySelector(".np-title");
    this.artistEl = this.el.querySelector(".np-artist");
    this.visualizer = visualizer;

    this.settings = {
      enabled: true,
      size: 1.0,
      color: "#ffffff",
      opacity: 0.9,
    };

    this.track = null;
    this.idle = false;

    this.applyLayout();
    this.applyStyle();
    window.addEventListener("resize", () => this.applyLayout());
  }

  // Running inside Lively: no track means silence, never a placeholder.
  setLivelyMode() {
    this.render();
  }

  setTrack(data) {
    let obj;
    if (typeof data === "string") {
      try {
        obj = JSON.parse(data);
      } catch {
        obj = null;
      }
    } else obj = data || null;
    this.track = obj;
    this.render();
  }

  // Called when the visualizer enters/leaves idle (no audible media).
  setIdle(idle) {
    idle = !!idle;
    if (this.idle === idle) return;
    this.idle = idle;
    this.render();
  }

  render() {
    const s = this.settings;
    const title = this.track && (this.track.Title || this.track.title) || "";
    const artist = this.track && (this.track.Artist || this.track.artist || this.track.Subtitle) || "";

    if (s.enabled && (title || this.idle)) {
      this.titleEl.textContent = title || "Waiting for media";
      this.artistEl.textContent = artist;
      this.artistEl.style.display = artist ? "block" : "none";
      this.el.style.display = "block";
      this.el.style.opacity = s.opacity;
    } else {
      this.el.style.display = "none";
    }
  }

  applyStyle() {
    const s = this.settings;
    this.el.style.color = s.color;
    //scale with rem-free px so it also resizes via the update loop
    this.el.style.fontSize = Math.round(40 * s.size) + "px";
    this.render();
  }

  // Keep the text just under the visualizer's mirrored dot columns.
  applyLayout() {
    const v = this.visualizer.settings;
    const numDots = v.sortingMode === 0 ? 128 : 256;
    const dotSize = v.dotScale * (window.innerWidth / numDots);
    const depth = v.amplitude * dotSize * 2;
    this.el.style.left = "50%";
    this.el.style.top = `calc(50% + ${depth}px + 1.2em)`;
    this.el.style.transform = "translateX(-50%)";
  }
}
