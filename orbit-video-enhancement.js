// ORBIT desktop video quality assistant. This only styles native video picture output; it never changes audio.
function attachOrbitVideoEnhancement(video) {
  if (!video || !document.documentElement.classList.contains("orbit-desktop-app") || video.dataset.orbitEnhancementReady === "1") return;
  video.dataset.orbitEnhancementReady = "1";
  const frame = video.closest(".global-tv-screen, #film-player-panel") || video.parentElement;
  if (!frame || !frame.parentElement) return;

  const panel = document.createElement("section");
  panel.className = "orbit-video-enhance-controls";
  panel.setAttribute("aria-label", "ORBIT video quality assistant");
  const heading = document.createElement("strong");
  heading.className = "orbit-video-assistant-title";
  heading.textContent = "ORBIT Video Quality Assistant";
  const label = document.createElement("label");
  label.textContent = "Picture mode";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Video picture quality mode");
  const modes = [
    ["original", "Original source"],
    ["clarity", "Clarity boost"],
    ["4k", "4K display target"],
    ["8k", "8K display target"]
  ];
  modes.forEach(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  });
  const source = document.createElement("span");
  source.className = "orbit-video-source-resolution";
  const display = document.createElement("span");
  display.className = "orbit-video-capability-line";
  const gpu = document.createElement("span");
  gpu.className = "orbit-video-capability-line";
  const decode = document.createElement("span");
  decode.className = "orbit-video-capability-line";
  const note = document.createElement("small");
  note.className = "orbit-video-enhance-note";
  const warning = document.createElement("small");
  warning.className = "orbit-video-enhance-warning";
  panel.append(heading, label, select, source, display, gpu, decode, note, warning);
  frame.insertAdjacentElement("afterend", panel);

  let hardware = null;
  let decodeResults = {};
  const px = n => Math.max(0, Math.round(Number(n) || 0));
  const resolutionLabel = (w, h) => w >= 7680 && h >= 4320 ? "8K" : w >= 3840 && h >= 2160 ? "4K" : w >= 2560 && h >= 1440 ? "1440p" : w >= 1920 && h >= 1080 ? "1080p" : "below 1080p";

  async function probeDecode(width, height) {
    if (!navigator.mediaCapabilities?.decodingInfo) return { supported: null, smooth: null, powerEfficient: null };
    try {
      return await navigator.mediaCapabilities.decodingInfo({
        type: "file",
        video: {
          contentType: width >= 7680 ? 'video/mp4; codecs="avc1.64003d"' : 'video/mp4; codecs="avc1.640033"',
          width, height, bitrate: Math.round(width * height * 1.5), framerate: 30
        }
      });
    } catch { return { supported: null, smooth: null, powerEfficient: null }; }
  }

  async function inspectHardware() {
    try {
      if (window.orbitDesktop?.getVideoCapabilities) hardware = await window.orbitDesktop.getVideoCapabilities();
    } catch { hardware = null; }
    const d = hardware?.display;
    if (d?.width && d?.height) {
      display.textContent = "Detected display: " + d.width + " × " + d.height + " (" + resolutionLabel(d.width, d.height) + ")";
    } else {
      const w = px(screen.width * (devicePixelRatio || 1));
      const h = px(screen.height * (devicePixelRatio || 1));
      display.textContent = "Display estimate: " + (w && h ? w + " × " + h : "not available");
    }
    const names = (hardware?.gpu?.devices || []).map(x => [x.vendorString, x.deviceString].filter(Boolean).join(" ")).filter(Boolean);
    gpu.textContent = "Graphics: " + (names.join("; ") || "hardware details unavailable") +
      (hardware?.gpu?.hardwareAcceleration === false ? " (hardware acceleration unavailable)" : "");
    const probes = await Promise.all([[3840, 2160], [7680, 4320]].map(([w, h]) => probeDecode(w, h)));
    decodeResults = { "4k": probes[0], "8k": probes[1] };
    const fmt = x => x.supported === null ? "probe unavailable" : !x.supported ? "not reported as supported" : x.smooth ? "supported; reported smooth" : "supported; smooth playback not assured";
    decode.textContent = "Decoder probe (H.264 / 30 fps): 4K " + fmt(probes[0]) + " · 8K " + fmt(probes[1]);
    updateInfo();
  }

  function evaluate(mode) {
    const d = hardware?.display;
    const dw = d?.width || px(screen.width * (devicePixelRatio || 1));
    const dh = d?.height || px(screen.height * (devicePixelRatio || 1));
    const display4k = dw >= 3840 && dh >= 2160;
    const display8k = dw >= 7680 && dh >= 4320;
    const gpuNames = (hardware?.gpu?.devices || []).map(x => (x.deviceString || "") + " " + (x.vendorString || "")).join(" ").toLowerCase();
    const weakGpu = /mx150|uhd 6|hd graphics|microsoft basic display/.test(gpuNames);
    const result = decodeResults[mode];
    const issues = [];
    if (mode === "4k" && !display4k) issues.push("Your detected screen is below native 4K, so this cannot show true 4K detail.");
    if (mode === "8k" && !display8k) issues.push("Your detected screen is below native 8K, so this cannot show true 8K detail.");
    if (weakGpu) issues.push("Your detected graphics hardware is entry-level for high-resolution video; expect possible dropped frames.");
    if (result?.supported === false) issues.push("The H.264 decoder probe did not report support at this resolution.");
    else if (result?.smooth === false) issues.push("The decoder probe does not predict consistently smooth playback at this resolution.");
    if (mode === "8k") issues.push("8K playback can use substantial memory and processing power.");
    if (mode === "4k" || mode === "8k") issues.push("This mode scales the picture; it does not reconstruct missing detail or perform AI super-resolution.");
    return issues;
  }

  function updateInfo() {
    const w = video.videoWidth || 0, h = video.videoHeight || 0;
    source.textContent = w && h ? "Video source: " + w + " × " + h : "Video source: waiting for video";
    const mode = select.value;
    const issues = mode === "4k" || mode === "8k" ? evaluate(mode) : [];
    note.textContent = mode === "clarity"
      ? "A lightweight contrast and colour filter is applied. No AI processing; source and audio remain unchanged."
      : mode === "original" ? "Original picture. No enhancement filter is applied."
      : mode.toUpperCase() + " display target selected. This does not force higher-resolution decoding or create missing detail; the player still uses the source stream and available display size.";
    warning.textContent = issues.length ? "Capability advice: " + issues.join(" ") : (mode === "4k" || mode === "8k")
      ? "Capability advice: no major limitation was identified by the available checks. Actual playback still depends on the video codec, stream and system load."
      : "Choose a mode to see the capability advice. Original is always available.";
    warning.classList.toggle("is-caution", issues.length > 0);
  }

  select.addEventListener("change", () => {
    const mode = select.value;
    video.style.filter = mode === "clarity" ? "contrast(1.08) saturate(1.06) brightness(1.015)" : mode === "4k" ? "contrast(1.035) saturate(1.025)" : "";
    updateInfo();
  });
  video.addEventListener("loadedmetadata", updateInfo);
  video.addEventListener("resize", updateInfo);
  inspectHardware();
  updateInfo();
}
