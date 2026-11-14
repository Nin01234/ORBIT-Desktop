const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function validateYouTubeUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("Invalid YouTube video link."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Only secure YouTube video links are supported.");
  const host = url.hostname.toLowerCase();
  if (!["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
    throw new Error("Only YouTube video links are supported by this download action.");
  }
  let id = host === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) throw new Error("This link does not contain a valid YouTube video ID.");
  return "https://www.youtube.com/watch?v=" + id;
}

function downloadYouTube({ url, title, directory, ffmpegPath, onProgress }) {
  const safeUrl = validateYouTubeUrl(url);
  fs.mkdirSync(directory, { recursive: true });
  const id = require("node:crypto").randomUUID();
  const output = path.join(directory, id + ".%(ext)s");
  const args = [
    "--no-playlist", "--no-warnings", "--newline",
    "--format", "bv*+ba/b", "--merge-output-format", "mp4",
    "--max-filesize", "500M", "--restrict-filenames",
    "--output", output, "--print", "after_move:filepath",
    "--progress", safeUrl
  ];
  if (ffmpegPath && fs.existsSync(ffmpegPath)) args.splice(args.length - 1, 0, "--ffmpeg-location", ffmpegPath);
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const timeout = setTimeout(() => child.kill(), 30 * 60 * 1000);
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      if (error) reject(error); else resolve(result);
    };
    child.stdout.on("data", chunk => {
      const text = chunk.toString(); stdout += text;
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (match) onProgress?.({ state: "progress", percent: Math.min(100, Number(match[1])), title });
      }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once("error", error => {
      if (error.code === "ENOENT") finish(new Error("yt-dlp is not installed or is not on PATH. Install yt-dlp, restart ORBIT, and try again."));
      else finish(error);
    });
    child.once("close", code => {
      if (code !== 0) { finish(new Error(stderr.trim() || "yt-dlp could not download this video. It may be unavailable or downloads may be restricted.")); return; }
      const filepath = stdout.split(/\r?\n/).map(x => x.trim()).filter(Boolean).at(-1);
      if (!filepath || !path.resolve(filepath).startsWith(path.resolve(directory) + path.sep) || !fs.existsSync(filepath)) {
        finish(new Error("yt-dlp finished but ORBIT could not locate the downloaded file.")); return;
      }
      const stat = fs.statSync(filepath);
      if (!stat.size || stat.size > 500 * 1024 * 1024) {
        try { fs.unlinkSync(filepath); } catch {}
        finish(new Error("The downloaded file is empty or exceeds ORBIT's 500 MB limit.")); return;
      }
      finish(null, { filepath, bytes: stat.size });
    });
  });
}

module.exports = { validateYouTubeUrl, downloadYouTube };
