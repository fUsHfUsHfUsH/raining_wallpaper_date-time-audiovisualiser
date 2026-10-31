const container = document.getElementById("container");
let clock = new THREE.Clock();
const gui = new dat.GUI();
let isPaused = false,
  elapsedResetTime = 21600,
  elapsedPreviousTime = 0;
let previousFrameTime = performance.now();
let devicePixelRatio = window.devicePixelRatio || 1;

let scene, camera, renderer, material;
let settings = { fps: 30, scale: 1.0, parallaxVal: 1, parallaxStrength: 1, parallaxDistance: 90, parallaxDamp: 0.07 };
let videoElement;

//audio visualizer & date/time overlay
const visualizer = new RainVisualizer(document.getElementById("visualizer"));
const rainClock = new RainClock();
const nowPlaying = new NowPlaying(visualizer);
//idle wave / "Waiting for media" hand-off between visualizer and track text
visualizer.onIdleChange = (idle) => nowPlaying.setIdle(idle);

//custom events
const sceneLoadedEvent = new Event("sceneLoaded");

async function init() {
  renderer = new THREE.WebGLRenderer({
    antialias: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(settings.scale * devicePixelRatio);
  container.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  material = new THREE.ShaderMaterial({
    uniforms: {
      u_tex0: { type: "t" },
      u_time: { value: 0, type: "f" },
      u_intensity: { value: 0.4, type: "f" },
      u_speed: { value: 0.25, type: "f" },
      u_brightness: { value: 0.8, type: "f" },
      u_cloud: { value: 0, type: "f" },
      u_normal: { value: 0.5, type: "f" },
      u_zoom: { value: 2.61, type: "f" },
      u_blur_intensity: { value: 0.5, type: "f" },
      u_blur_iterations: { value: 16, type: "i" },
      u_panning: { value: false, type: "b" },
      u_post_processing: { value: true, type: "b" },
      u_lightning: { value: false, type: "b" },
      u_texture_fill: { value: true, type: "b" },
      u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight), type: "v2" },
      u_tex0_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight), type: "v2" },
    },
    vertexShader: `
          varying vec2 vUv;        
          void main() {
              vUv = uv;
              gl_Position = vec4( position, 1.0 );    
          }
        `,
  });
  //bump when editing shaders - browser otherwise caches rain.frag aggressively
  const shaderVersion = 4;
  material.fragmentShader = await (await fetch(`shaders/rain.frag?v=${shaderVersion}`)).text();
  resize();

  material.uniforms.u_tex0_resolution.value = new THREE.Vector2(1920, 1080);
  material.uniforms.u_tex0.value = await new THREE.TextureLoader().loadAsync("media/image.webp");

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 1, 1), material);
  scene.add(quad);

  window.addEventListener("resize", (e) => resize());
  render();
  datUI();

  document.dispatchEvent(sceneLoadedEvent);
}

function setScale(userScale) {
  settings.scale = userScale;
  const finalScale = devicePixelRatio * settings.scale;
  if (renderer.getPixelRatio() == finalScale)
    return;

  renderer.setPixelRatio(finalScale);
  material.uniforms.u_resolution.value = new THREE.Vector2(
    window.innerWidth * finalScale,
    window.innerHeight * finalScale
  );
}

function resize() {
  if (window.devicePixelRatio !== devicePixelRatio) {
    devicePixelRatio = window.devicePixelRatio || 1;
    setScale(settings.scale);
  }
  const finalScale = devicePixelRatio * settings.scale;

  renderer.setSize(window.innerWidth, window.innerHeight);
  material.uniforms.u_resolution.value = new THREE.Vector2(
    window.innerWidth * finalScale,
    window.innerHeight * finalScale
  );
}

function render() {
  setTimeout(function () {
    requestAnimationFrame(render);
  }, 1000 / settings.fps);

  //reset every 6hr
  const elapsed = clock.getElapsedTime();
  if (elapsed > elapsedResetTime) clock = new THREE.Clock();
  material.uniforms.u_time.value = clock.getElapsedTime();

  //visualizer timestep (freezes on pause)
  const now = performance.now();
  const dt = Math.min((now - previousFrameTime) / 1000, 0.1); //clamp to avoid huge jumps
  previousFrameTime = now;
  visualizer.render(isPaused ? 0 : dt);

  //storm cloud: a long, leisurely roll-in; clears quickly afterwards
  const cloudTarget = material.uniforms.u_lightning.value ? 1 : 0;
  const cloud = material.uniforms.u_cloud;
  const cloudRate = cloudTarget ? 0.22 : 0.9;
  cloud.value += (cloudTarget - cloud.value) * Math.min(1, dt * cloudRate);

  renderer.render(scene, camera);
}

function livelyWallpaperPlaybackChanged(data) {
  var obj = JSON.parse(data);
  isPaused = obj.IsPaused;

  if (isPaused) {
    elapsedPreviousTime = clock.getElapsedTime();
    elapsedPreviousTime = elapsedPreviousTime > elapsedResetTime ? 0 : elapsedPreviousTime;
    clock.stop();
  } else {
    clock.start();
    clock.elapsedTime = elapsedPreviousTime;
  }
}

//lively current track (LivelyInfo.json "--system-nowplaying")
function livelyCurrentTrack(data) {
  nowPlaying.setTrack(data);
}

//lively system audio (LivelyInfo.json "--audio")
//128 length array, values typically 0-1
function livelyAudioListener(audioArray) {
  //some Lively builds deliver this as a JSON string instead of an array
  if (typeof audioArray === "string") {
    try {
      audioArray = JSON.parse(audioArray);
    } catch (e) {
      return; //not json, ignore
    }
    if (!Array.isArray(audioArray)) return;
  }
  visualizer.setLivelyData(audioArray);
}

//audio diagnostics overlay: shows what livelyAudioListener is actually receiving
const audioDebugEl = document.createElement("div");
audioDebugEl.style.cssText =
  "position:fixed;bottom:58px;left:12px;z-index:70;padding:8px 12px;border-radius:8px;" +
  "background:rgba(0,0,0,.6);color:#a8e6c3;font:13px/1.5 Consolas,monospace;" +
  "white-space:pre;display:none;pointer-events:none;";
document.body.appendChild(audioDebugEl);
setInterval(() => {
  if (!visualizer || !visualizer.audioDebug) {
    audioDebugEl.style.display = "none";
    return;
  }
  audioDebugEl.style.display = "block";
  const v = visualizer;
  audioDebugEl.textContent =
    `Lively audio diagnostics\n` +
    `source: ${v.source}\n` +
    `packets received: ${v.livelyPackets}\n` +
    `loudest bin (last packet): ${isNaN(v.livelyMax) ? "none" : v.livelyMax.toFixed(4)}\n` +
    `idle wave: ${v.idle}`;
}, 500);

init();

//lively api
//docs: https://github.com/rocksdanister/lively/wiki/Web-Guide-IV-:-Interaction
function livelyPropertyListener(name, val) {
  visualizer.setLivelyMode(); //Lively calls this on startup - no demo beat inside Lively
  nowPlaying.setLivelyMode();
  switch (name) {
    case "blurIntensity":
      material.uniforms.u_blur_intensity.value = val / 100;
      break;
    case "blurQuality":
      material.uniforms.u_blur_iterations.value = [1, 16, 32, 64][val];
      break;
    case "rainIntensity":
      material.uniforms.u_intensity.value = val / 100;
      break;
    case "rainSpeed":
      material.uniforms.u_speed.value = val / 100;
      break;
    case "brightness":
      material.uniforms.u_brightness.value = val / 100;
      break;
    case "rainNormal":
      material.uniforms.u_normal.value = val / 100;
      break;
    case "rainZoom":
      material.uniforms.u_zoom.value = val / 100;
      break;
    case "mediaSelect":
      {
        let ext = getExtension(val);
        disposeVideoElement(videoElement);
        material.uniforms.u_tex0.value?.dispose();
        if (ext == "jpg" || ext == "jpeg" || ext == "png") {
          new THREE.TextureLoader().load(val, function (tex) {
            material.uniforms.u_tex0.value = tex;
            material.uniforms.u_tex0_resolution.value = new THREE.Vector2(tex.image.width, tex.image.height);
          });
        } else if (ext == "webm") {
          videoElement = createVideoElement(val);
          let videoTexture = new THREE.VideoTexture(videoElement);
          videoElement.addEventListener(
            "loadedmetadata",
            function (e) {
              material.uniforms.u_tex0_resolution.value = new THREE.Vector2(
                videoTexture.image.videoWidth,
                videoTexture.image.videoHeight
              );
            },
            false
          );
          material.uniforms.u_tex0.value = videoTexture;
        }
      }
      break;
    case "mediaScaling":
      material.uniforms.u_texture_fill.value = [false, true][val];
      break;
    case "animateChk":
      material.uniforms.u_panning.value = val;
      break;
    case "lightningChk":
      material.uniforms.u_lightning.value = val;
      break;
    case "postProcessingChk":
      material.uniforms.u_post_processing.value = val;
      break;
    case "parallaxIntensity":
      settings.parallaxVal = val;
      break;
    case "parallaxStrength":
      settings.parallaxStrength = val;
      break;
    case "parallaxDistance":
      settings.parallaxDistance = val;
      break;
    case "parallaxDamp":
      settings.parallaxDamp = val;
      break;
    case "fpsLock":
      settings.fps = val ? 30 : 60;
      break;
    case "displayScaling":
      setScale(val);
      break;
    case "visualizerChk":
      visualizer.settings.enabled = val;
      break;
    case "audioDebugChk":
      visualizer.audioDebug = val;
      break;
    case "visualizerAmplitude":
      visualizer.settings.amplitude = val;
      nowPlaying.applyLayout();
      break;
    case "visualizerDotSize":
      visualizer.settings.dotScale = val;
      nowPlaying.applyLayout();
      break;
    case "visualizerMode":
      visualizer.settings.sortingMode = val;
      nowPlaying.applyLayout();
      break;
    case "visualizerColor":
      visualizer.settings.color = val;
      break;
    case "visualizerRainbowChk":
      visualizer.settings.rainbow = val;
      break;
    case "visualizerDepth":
      visualizer.settings.depth = val / 100;
      break;
    case "visualizerBalance":
      visualizer.settings.balance = val / 100;
      break;
    case "nowPlayingChk":
      nowPlaying.settings.enabled = val;
      nowPlaying.render();
      break;
    case "nowPlayingSize":
      nowPlaying.settings.size = val / 100;
      nowPlaying.applyStyle();
      break;
    case "nowPlayingColor":
      nowPlaying.settings.color = val;
      nowPlaying.applyStyle();
      break;
    case "nowPlayingOpacity":
      nowPlaying.settings.opacity = val / 100;
      nowPlaying.applyStyle();
      break;
    case "clockChk":
      rainClock.settings.enabled = val;
      rainClock.applyStyle();
      break;
    case "clockFormat":
      rainClock.settings.format24h = [true, false][val];
      rainClock.update();
      break;
    case "clockSecondsChk":
      rainClock.settings.showSeconds = val;
      rainClock.update();
      break;
    case "clockDateChk":
      rainClock.settings.showDate = val;
      rainClock.update();
      break;
    case "clockPosition":
      rainClock.settings.position = val;
      rainClock.applyStyle();
      break;
    case "clockSize":
      rainClock.settings.size = val / 100;
      rainClock.applyStyle();
      break;
    case "clockColor":
      rainClock.settings.color = val;
      rainClock.applyStyle();
      break;
    case "clockOpacity":
      rainClock.settings.opacity = val / 100;
      rainClock.applyStyle();
      break;
    case "debug":
      if (val) gui.show();
      else gui.hide();
      break;
  }
}

//web
function datUI() {
  let rain = gui.addFolder("Rain");
  let bg = gui.addFolder("Background");
  let viz = gui.addFolder("Visualizer");
  let clk = gui.addFolder("Clock");
  let np = gui.addFolder("Now Playing");
  let perf = gui.addFolder("Performance");
  let misc = gui.addFolder("More");
  rain.open();
  bg.open();
  viz.open();
  clk.open();
  np.open();
  perf.open();
  misc.open();
  rain.add(material.uniforms.u_intensity, "value", 0, 1, 0.01).name("Intensity");
  rain.add(material.uniforms.u_speed, "value", 0, 10, 0.01).name("Speed");
  rain.add(material.uniforms.u_brightness, "value", 0, 1, 0.01).name("Brightness");
  rain.add(material.uniforms.u_normal, "value", 0, 3, 0.01).name("Normal");
  rain.add(material.uniforms.u_zoom, "value", 0.1, 3.0, 0.01).name("Zoom");
  rain.add(material.uniforms.u_lightning, "value").name("Lightning");
  bg.add(
    {
      picker: function () {
        document.getElementById("filePicker").click();
      },
    },
    "picker"
  ).name("Change Background");
  bg.add(material.uniforms.u_blur_iterations, "value", 1, 64, 1).name("Blur Quality");
  bg.add(material.uniforms.u_blur_intensity, "value", 0, 10, 0.01).name("Blur");
  bg.add(settings, "parallaxVal", 0, 5, 1).name("Parallax");
  bg.add(material.uniforms.u_texture_fill, "value").name("Scale to Fill");
  bg.add(material.uniforms.u_panning, "value").name("Panning");
  bg.add(material.uniforms.u_post_processing, "value").name("Post Processing");
  viz.add(visualizer.settings, "enabled").name("Enabled");
  viz.add(visualizer.settings, "amplitude", 0, 50, 0.1).name("Amplitude");
  viz.add(visualizer.settings, "dotScale", 0, 5, 0.1).name("Dot Size");
  let tempVizMode = { value: ["Concentrated", "Center-split", "Keep original"][visualizer.settings.sortingMode] };
  viz
    .add(tempVizMode, "value", ["Concentrated", "Center-split", "Keep original"])
    .name("Spectrum Mode")
    .onChange(function () {
      visualizer.settings.sortingMode = ["Concentrated", "Center-split", "Keep original"].indexOf(tempVizMode.value);
    });
  viz.addColor(visualizer.settings, "color").name("Color");
  viz.add(visualizer.settings, "rainbow").name("Rainbow");
  viz.add(visualizer.settings, "depth", 0, 1, 0.01).name("Depth");
  viz.add(visualizer.settings, "balance", 0, 1, 0.01).name("High Freq");
  viz
    .add(
      {
        idle: function () {
          visualizer.forceIdle = !visualizer.forceIdle;
        },
      },
      "idle"
    )
    .name("Preview Idle Wave");
  viz
    .add(
      {
        mic: function () {
          visualizer.source === "mic" ? visualizer.useDemo() : visualizer.useMicrophone();
        },
      },
      "mic"
    )
    .name("Toggle Microphone");
  viz.add(visualizer, "audioDebug").name("Audio Diagnostics");
  clk.add(rainClock.settings, "enabled").name("Enabled").onChange(() => rainClock.applyStyle());
  clk.add(rainClock.settings, "format24h").name("24h Format");
  clk.add(rainClock.settings, "showSeconds").name("Seconds");
  clk.add(rainClock.settings, "showDate").name("Date");
  let tempClockPos = { value: ["Top Left", "Top Right", "Bottom Left", "Bottom Right", "Middle"][rainClock.settings.position] };
  clk
    .add(tempClockPos, "value", ["Top Left", "Top Right", "Bottom Left", "Bottom Right", "Middle"])
    .name("Position")
    .onChange(function () {
      rainClock.settings.position = ["Top Left", "Top Right", "Bottom Left", "Bottom Right", "Middle"].indexOf(tempClockPos.value);
      rainClock.applyStyle();
    });
  clk.add(rainClock.settings, "size", 0.4, 2.5, 0.05).name("Size").onChange(() => rainClock.applyStyle());
  clk.addColor(rainClock.settings, "color").name("Color").onChange(() => rainClock.applyStyle());
  clk.add(rainClock.settings, "opacity", 0, 1, 0.01).name("Opacity").onChange(() => rainClock.applyStyle());
  np.add(nowPlaying.settings, "enabled").name("Enabled").onChange(() => nowPlaying.render());
  np.add(nowPlaying.settings, "size", 0.4, 2.5, 0.05).name("Size").onChange(() => nowPlaying.applyStyle());
  np.addColor(nowPlaying.settings, "color").name("Color").onChange(() => nowPlaying.applyStyle());
  np.add(nowPlaying.settings, "opacity", 0, 1, 0.01).name("Opacity").onChange(() => nowPlaying.applyStyle());
  np
    .add(
      {
        demo: function () {
          nowPlaying.setTrack({ Title: "Demo Song", Artist: "Rainy Window" });
        },
      },
      "demo"
    )
    .name("Show Example Track");
  np
    .add(
      {
        clear: function () {
          nowPlaying.setTrack(null);
        },
      },
      "clear"
    )
    .name("Hide Track");
  perf.add(settings, "fps", 15, 120, 15).name("FPS");
  let tempScale = { value: settings.scale }; //don't update global value
  perf
    .add(tempScale, "value", 0.1, 2, 0.01)
    .name("Scale")
    .onChange(function () {
      setScale(tempScale.value);
    });
  misc
    .add(
      {
        lively: function () {
          window.open("https://www.rocksdanister.com/lively");
        },
      },
      "lively"
    )
    .name("Try It On Your Desktop!");
  misc
    .add(
      {
        source: function () {
          window.open("https://github.com/rocksdanister/rain");
        },
      },
      "source"
    )
    .name("Source Code");
  gui.close();
}

document.getElementById("filePicker").addEventListener("change", function () {
  if (this.files[0] === undefined) return;
  let file = this.files[0];
  if (file.type == "image/jpg" || file.type == "image/jpeg" || file.type == "image/png") {
    disposeVideoElement(videoElement);
    material.uniforms.u_tex0.value?.dispose();

    new THREE.TextureLoader().load(URL.createObjectURL(file), function (tex) {
      material.uniforms.u_tex0.value = tex;
      material.uniforms.u_tex0_resolution.value = new THREE.Vector2(tex.image.width, tex.image.height);
    });
  } else if (file.type == "video/mp4" || file.type == "video/webm") {
    disposeVideoElement(videoElement);
    material.uniforms.u_tex0.value?.dispose();

    videoElement = createVideoElement(URL.createObjectURL(file));
    let videoTexture = new THREE.VideoTexture(videoElement);
    videoElement.addEventListener(
      "loadedmetadata",
      function (e) {
        material.uniforms.u_tex0_resolution.value = new THREE.Vector2(
          videoTexture.image.videoWidth,
          videoTexture.image.videoHeight
        );
      },
      false
    );
    material.uniforms.u_tex0.value = videoTexture;
  }
});

// parallax
if (settings.parallaxVal !== 0) {

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;

  document.addEventListener("mousemove", function (event) {
    targetX = (window.innerWidth  - event.pageX * settings.parallaxVal * settings.parallaxStrength) / settings.parallaxDistance;
    targetY = (window.innerHeight - event.pageY * settings.parallaxVal * settings.parallaxStrength) / settings.parallaxDistance;
  });

  function animateParallax() {
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    const speed = Math.hypot(dx, dy);
    const damp = Math.min(0.35, settings.parallaxDamp + speed * 0.012);

    currentX += dx * damp;
    currentY += dy * damp;

    container.style.transform =
      `translateX(${currentX}px) translateY(${currentY}px) scale(1.06)`;

    requestAnimationFrame(animateParallax);
  }

  animateParallax();
}

//helpers
function getExtension(filePath) {
  return filePath.substring(filePath.lastIndexOf(".") + 1, filePath.length).toLowerCase() || filePath;
}

function createVideoElement(src) {
  let htmlVideo = document.createElement("video");
  htmlVideo.src = src;
  htmlVideo.muted = true;
  htmlVideo.loop = true;
  htmlVideo.play();
  return htmlVideo;
}

//ref: https://stackoverflow.com/questions/3258587/how-to-properly-unload-destroy-a-video-element
function disposeVideoElement(video) {
  if (video != null && video.hasAttribute("src")) {
    video.pause();
    video.removeAttribute("src"); // empty source
    video.load();
  }
}
