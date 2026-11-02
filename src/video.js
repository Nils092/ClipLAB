// Bringt hochgeladene Clips in ein Format, das TikTok und Instagram sicher annehmen:
// MP4, H.264 + AAC, "faststart". Browser-Aufnahmen (WebM oder fragmentiertes MP4) werden umgewandelt.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() || `ffmpeg ${code}`))));
  });
}

async function normalize(input, output, { isMp4 }) {
  if (!hasFfmpeg) {
    if (!isMp4) throw new Error("WebM-Videos brauchen ffmpeg auf dem Server. Bitte ffmpeg installieren oder MP4 hochladen.");
    await fs.promises.rename(input, output);
    return;
  }
  try {
    if (isMp4) await run(["-i", input, "-c", "copy", "-movflags", "+faststart", output]);
    else throw new Error("transcode");
  } catch {
    await run([
      "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
      "-r", "30", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-movflags", "+faststart", output,
    ]);
  }
  await fs.promises.rm(input, { force: true });
}

module.exports = { normalize, hasFfmpeg };
