# ClipLab

Clips automatisch aus langen Videos erstellen und auf TikTok und Instagram ausspielen – für mehrere Clipper.

- **Studio** (`/studio`): Video reinziehen, die lautesten Momente werden automatisch gefunden, ins Hochformat 9:16 geschnitten, mit Hook-Text und Account-Name versehen und im Browser gerendert. Kein Upload des Rohvideos nötig.
- **Server**: Clipper melden sich an, verbinden ihre TikTok- und Instagram-Accounts und planen Clips ein. Der Server veröffentlicht zur geplanten Zeit, verfolgt den Status und reicht veröffentlichte Posts auf Wunsch bei der Clipping-App ein.
- **Dashboard** (`/`): Accounts, Warteschlange, Fehler, API-Schlüssel, Nutzerverwaltung für Admins.

Keine Fremdpakete: läuft mit Node.js 20+ und optional ffmpeg.

## Schnellstart

```bash
cp .env.example .env          # Werte eintragen, mindestens APP_SECRET und PUBLIC_BASE_URL
node src/server.js            # oder: npm start
```

Dann `PUBLIC_BASE_URL` im Browser öffnen. Das erste Konto wird automatisch Admin. Weitere Clipper registrieren sich mit dem `INVITE_CODE`.

`ffmpeg` sollte installiert sein (`apt install ffmpeg`). Damit werden Browser-Aufnahmen in sauberes MP4 (H.264/AAC) umgewandelt, das Instagram zuverlässig annimmt.

## Betrieb

**Schnellste Variante:** frischer Ubuntu-Server (z. B. Hostinger VPS KVM 2), als root:

```bash
curl -fsSL https://raw.githubusercontent.com/Nils092/ClipLAB/main/deploy/install.sh | bash -s -- cliplab.de
```

Das Skript installiert Node.js, ffmpeg und Caddy, richtet HTTPS, Firewall und den Dienst ein und gibt am Ende den Einladungscode aus. Updates: `bash /opt/cliplab/deploy/update.sh`, Backups: `deploy/backup.sh`.

Manuell geht es so:

Der Server muss per **HTTPS** öffentlich erreichbar sein: TikTok und Meta leiten nach dem Login dorthin zurück, und Instagram lädt die Videos von dort herunter. Einfachster Weg: kleiner VPS (z. B. Hetzner) mit Caddy als Reverse Proxy.

```
# /etc/caddy/Caddyfile
clips.deinedomain.de {
    reverse_proxy localhost:3000
}
```

Dauerhaft laufen lassen mit systemd:

```ini
# /etc/systemd/system/cliplab.service
[Unit]
Description=ClipLab
After=network.target

[Service]
WorkingDirectory=/opt/cliplab
ExecStart=/usr/bin/node src/server.js
Restart=always
User=cliplab

[Install]
WantedBy=multi-user.target
```

Daten liegen in `DATA_DIR` (Datenbank `db.json` und Videos). Diesen Ordner sichern.

## Entwickler-Apps einrichten

### TikTok

1. Auf developers.tiktok.com eine App anlegen, Produkte **Login Kit** und **Content Posting API** hinzufügen, Direct Post aktivieren.
2. Redirect URI: `https://DEINE-DOMAIN/auth/tiktok/callback`
3. Scopes: `user.info.basic`, `video.upload`, `video.publish`
4. Client Key und Secret in die `.env`.

Ohne Audit sind Direkt-Posts nur privat sichtbar, und höchstens 5 Nutzer dürfen pro Tag posten. Deshalb steht `TIKTOK_UNAUDITED=true`: Clips landen dann als **Entwurf in der TikTok-App** und werden dort mit einem Tipp veröffentlicht (innerhalb von 24 Stunden). Nach bestandenem Audit auf `false` stellen.

Für das Audit verlangt TikTok unter anderem, dass Nutzer vor dem Posten eine Vorschau sehen und die Caption selbst bearbeiten können. Das Studio erfüllt das, weil jeder Clip vom Clipper selbst geprüft und gesendet wird.

### Instagram

1. Auf developers.facebook.com eine App anlegen, Produkt **Instagram API with Instagram Login** hinzufügen.
2. Berechtigungen: `instagram_business_basic`, `instagram_business_content_publish`
3. Redirect URI: `https://DEINE-DOMAIN/auth/instagram/callback`
4. App-ID und App-Secret (Instagram) in die `.env`.

Nur Professional-Accounts (Business oder Creator) können per API posten. Damit andere Clipper ihre Accounts verbinden können, muss die App von Meta geprüft werden (App Review). Bis dahin funktioniert es für Accounts, die in der App als Tester eingetragen sind. Limit: 50 bis 100 API-Posts pro Account und Tag.

Beide Plattformen verlangen eine Datenschutzerklärung. Eine Vorlage liegt unter `/datenschutz` (`public/datenschutz.html`) und muss mit deinen Angaben gefüllt werden.

## Clipping-App anbinden

Sobald die App deines Freundes `POST /api/submissions` anbietet:

1. `CLIPPING_APP_URL` in der `.env` setzen.
2. Jeder Clipper trägt im Dashboard seinen Schlüssel für die Clipping-App ein.
3. Beim Senden im Studio eine Kampagnen-ID angeben.

Nach der Veröffentlichung schickt der Server automatisch:

```json
POST {CLIPPING_APP_URL}/api/submissions
Authorization: Bearer <Schlüssel des Clippers>
{ "post_url": "...", "platform": "tiktok", "campaign_id": "...", "account_name": "@..." }
```

## API für eigene Skripte

Im Dashboard einen API-Schlüssel erzeugen, dann:

```bash
curl -H "Authorization: Bearer cl_..." \
  -F video=@clip.mp4 \
  -F 'caption=Text #hashtag' \
  -F 'accountIds=["acc_..."]' \
  -F scheduledAt=2026-11-03T18:00:00Z \
  -F tiktokMode=inbox \
  https://DEINE-DOMAIN/api/clips
```

Weitere Endpunkte: `GET /api/accounts`, `GET /api/posts`, `POST /api/posts/:id/retry`, `DELETE /api/posts/:id`.

## Studio ändern

Das Studio liegt in `public/studio-body.html`. Nach Änderungen `node scripts/build-studio.js` ausführen, das erzeugt `public/studio.html`.

## Wichtig

Nur Inhalte clippen, für die du die Rechte hast oder die der Creator ausdrücklich zum Clipping freigegeben hat. Massenhaftes Posten gleicher Inhalte auf vielen Accounts kann zu Sperren führen.
