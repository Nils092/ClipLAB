// Baut public/studio.html aus public/studio-body.html (derselbe Code wie das Claude-Artifact)
const fs = require("fs");
const path = require("path");
const pub = path.join(__dirname, "..", "public");
const body = fs.readFileSync(path.join(pub, "studio-body.html"), "utf8");
const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0A0A0A">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>:root{color-scheme:dark;background:#0A0A0A;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}header.top .brand h1{display:none}[hidden]{display:none!important}</style>
</head>
<body>
<script src="/nav.js?v=1"></script>
${body}
<p style="text-align:center;font:12px Poppins,system-ui,sans-serif;color:#8F8F8F"><a href="/" style="color:#8F8F8F">Zum Dashboard</a></p>
<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});</script>
</body>
</html>
`;
fs.writeFileSync(path.join(pub, "studio.html"), html);
console.log("public/studio.html gebaut");
