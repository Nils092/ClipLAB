// Schlanker SMTP-Versand (ohne Zusatzpakete) – z. B. über das IONOS-Postfach info@imakio.de.
// Port 465 = verschlüsselt ab der ersten Sekunde (empfohlen), Port 587 = STARTTLS.
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");
const config = require("./config");

const enabled = () => Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);

function client(sock) {
  let buf = "", waiting = null;
  const lines = [];
  const onData = (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      lines.push(buf.slice(0, i).replace(/\r$/, ""));
      buf = buf.slice(i + 1);
    }
    flush();
  };
  // Antwort ist vollständig, wenn eine Zeile "123 " (Leerzeichen statt Bindestrich) kommt
  function flush() {
    if (!waiting) return;
    const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
    if (end < 0) return;
    const resp = lines.splice(0, end + 1);
    const w = waiting; waiting = null;
    w.resolve({ code: Number(resp[end].slice(0, 3)), text: resp.join("\n") });
  }
  const fail = (e) => { if (waiting) { const w = waiting; waiting = null; w.reject(e || new Error("SMTP-Verbindung getrennt")); } };
  const onClose = () => fail();
  sock.on("data", onData);
  sock.on("error", fail);
  sock.on("close", onClose);
  const read = () => new Promise((resolve, reject) => { waiting = { resolve, reject }; flush(); });
  return {
    read,
    detach: () => { sock.off("data", onData); sock.off("error", fail); sock.off("close", onClose); },
    async cmd(line, expect) {
      if (line != null) sock.write(line + "\r\n");
      const r = await read();
      if (!expect.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.split("\n").pop().slice(4, 200)}`);
      return r;
    },
  };
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap = (s) => s.replace(/.{1,76}/g, "$&\r\n");

function message({ from, to, subject, text, html }) {
  const boundary = "cl_" + crypto.randomBytes(12).toString("hex");
  const domain = (from.match(/@([^>\s]+)/) || [, "cliplab"])[1];
  const name = /<.*>/.test(from) ? from.replace(/\s*<.*>/, "") : "";
  const addr = (from.match(/<([^>]+)>/) || [, from])[1];
  return [
    `From: ${name ? `${encWord(name)} <${addr}>` : addr}`,
    `To: <${to}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function send({ to, subject, text, html }, { tlsOptions = {} } = {}) {
  if (!enabled()) throw new Error("E-Mail-Versand ist nicht eingerichtet (SMTP_* in der .env)");
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error("Ungültige E-Mail-Adresse");
  const { host, port, user, pass, from } = config.smtp;
  const implicit = Number(port) === 465;
  let sock = await new Promise((resolve, reject) => {
    const s = implicit
      ? tls.connect({ host, port, servername: host, ...tlsOptions }, () => resolve(s))
      : net.connect({ host, port }, () => resolve(s));
    s.setTimeout(30_000, () => s.destroy(new Error("SMTP-Zeitüberschreitung")));
    s.once("error", reject);
  });
  let c = client(sock);
  const me = (config.baseUrl.match(/\/\/([^/:]+)/) || [, "cliplab"])[1];
  try {
    await c.cmd(null, [220]);
    await c.cmd(`EHLO ${me}`, [250]);
    if (!implicit) {
      await c.cmd("STARTTLS", [220]);
      c.detach();
      sock = await new Promise((resolve, reject) => {
        const s = tls.connect({ socket: sock, servername: host, ...tlsOptions }, () => resolve(s));
        s.once("error", reject);
      });
      c = client(sock);
      await c.cmd(`EHLO ${me}`, [250]);
    }
    await c.cmd("AUTH LOGIN", [334]);
    await c.cmd(b64(user), [334]);
    await c.cmd(b64(pass), [235]);
    const fromAddr = (from.match(/<([^>]+)>/) || [, from])[1];
    await c.cmd(`MAIL FROM:<${fromAddr}>`, [250]);
    await c.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await c.cmd("DATA", [354]);
    const body = message({ from, to, subject, text, html }).replace(/^\./gm, "..");
    await c.cmd(body + "\r\n.", [250]);
    await c.cmd("QUIT", [221]).catch(() => {});
  } finally {
    sock.end();
  }
}

// Bestätigungs-Mail für neue Clipper
function sendVerification(user, link) {
  const name = user.name || "du";
  return send({
    to: user.email,
    subject: "Bitte bestätige deine E-Mail für ClipLab",
    text: `Hallo ${name},\n\nwillkommen bei ClipLab! Bitte bestätige deine E-Mail-Adresse mit diesem Link:\n\n${link}\n\nDer Link ist 48 Stunden gültig. Wenn du dich nicht registriert hast, kannst du diese Mail einfach ignorieren.\n\nClipLab – ein Projekt von imakio\nhttps://imakio.de`,
    html: `<!doctype html><html><body style="margin:0;background:#0A0A0A;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;color:#F4F4F4">
<div style="max-width:480px;margin:0 auto;background:#121212;border:1px solid #2a2a2a;border-radius:14px;padding:28px">
<p style="font-size:22px;font-weight:700;margin:0 0 18px;letter-spacing:-.5px">Clip<span style="border-bottom:3px solid #F4F4F4">Lab</span></p>
<p style="font-size:15px;line-height:1.55;margin:0 0 20px">Hallo ${name.replace(/[<>&"]/g, "")},<br>willkommen bei ClipLab! Bitte bestätige deine E-Mail-Adresse.</p>
<p style="margin:0 0 22px"><a href="${link}" style="display:inline-block;background:#F4F4F4;color:#0A0A0A;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">E-Mail bestätigen</a></p>
<p style="font-size:12.5px;line-height:1.5;color:#8F8F8F;margin:0">Der Link ist 48 Stunden gültig. Wenn du dich nicht registriert hast, ignoriere diese Mail einfach.<br><br>ClipLab ist ein Projekt von <a href="https://imakio.de" style="color:#8F8F8F">imakio</a></p>
</div></body></html>`,
  });
}

module.exports = { enabled, send, sendVerification, message };
