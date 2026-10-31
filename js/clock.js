/**
 * Rainy Window - Date/time display.
 *
 * A lightweight DOM overlay showing the current time and date.
 * Options: 12/24h format, seconds, date line, position, size, color, opacity.
 */
class RainClock {
  constructor() {
    this.el = document.createElement("div");
    this.el.id = "clock";
    this.el.innerHTML = '<div class="clock-time"></div><div class="clock-date"></div>';
    document.body.appendChild(this.el);

    this.timeEl = this.el.querySelector(".clock-time");
    this.dateEl = this.el.querySelector(".clock-date");

    this.settings = {
      enabled: true,
      format24h: true,
      showSeconds: true,
      showDate: true,
      position: 1, // 0..4, see POSITIONS (Top Right)
      size: 1.0,
      color: "#ffffff",
      opacity: 0.9,
    };

    // [vertical, horizontal, text-align] - 4 corners + middle
    this.POSITIONS = [
      ["top", "left", "left"],
      ["top", "right", "right"],
      ["bottom", "left", "left"],
      ["bottom", "right", "right"],
      ["center", "center", "center"],
    ];

    this.applyStyle();
    this.update();
    // 250ms keeps seconds ticking smoothly without re-rendering every frame
    setInterval(() => this.update(), 250);
  }

  update() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");

    //hours: 12h shows "9" not "09"; 24h keeps the leading zero
    let hours = now.getHours();
    let suffix = "";
    if (this.settings.format24h) {
      hours = pad(hours);
    } else {
      suffix = hours >= 12 ? " PM" : " AM";
      hours = (hours % 12) || 12;
    }

    let text = `${hours}:${pad(now.getMinutes())}`;
    if (this.settings.showSeconds) text += `:${pad(now.getSeconds())}`;
    this.timeEl.textContent = text + suffix;

    this.dateEl.textContent = now.toLocaleDateString([], {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    this.dateEl.style.display = this.settings.showDate ? "block" : "none";
  }

  applyStyle() {
    const s = this.settings;
    const [vertical, horizontal, align] = this.POSITIONS[s.position % this.POSITIONS.length];

    //reset anchors so switching positions never leaves a stale left/right/transform
    this.el.style.top = "auto";
    this.el.style.bottom = "auto";
    this.el.style.left = "auto";
    this.el.style.right = "auto";
    this.el.style.transform = "none";

    this.el.style.display = s.enabled ? "block" : "none";
    if (vertical === "center") {
      //middle of the screen
      this.el.style.top = "50%";
      this.el.style.left = "50%";
      this.el.style.transform = "translate(-50%, -50%)";
    } else if (horizontal === "center") {
      this.el.style[vertical] = "4vh";
      this.el.style.left = "50%";
      this.el.style.transform = "translateX(-50%)";
    } else {
      this.el.style[vertical] = "4vh";
      this.el.style[horizontal] = "2.5vw";
    }
    this.el.style.textAlign = align;
    this.el.style.color = s.color;
    this.el.style.opacity = s.opacity;
    //vh keeps the clock proportional on 1080p, 1440p and 4K displays
    this.el.style.fontSize = 6 * s.size + "vh";
  }
}
