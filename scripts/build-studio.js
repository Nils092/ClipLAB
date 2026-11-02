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
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
<p style="text-align:center;font-size:12px;opacity:.7"><a href="/">Zum Dashboard</a></p>
</body>
</html>
`;
fs.writeFileSync(path.join(pub, "studio.html"), html);
console.log("public/studio.html gebaut");
