# imakio.de – Website

Startseite von Imakio mit Scroll-Story, automatisch drehendem 3D-Karussell und Kontakt. Reines HTML, CSS und JavaScript, ohne Build-Schritt und ohne externe Dienste (Schriften liegen in `fonts/`, keine Cookies).

## Inhalt

- `index.html`, `style.css`, `app.js` – die Startseite
- `impressum.html`, `datenschutz.html` – Rechtstexte, **markierte Stellen vor dem Hochladen ausfüllen**
- `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` – Browser- und Homescreen-Icons
- `fonts/` – Poppins und Lora (SIL Open Font License), selbst gehostet
- `logo/` – Logo und App-Icon in Schwarz und Weiß als SVG und PNG (nicht nötig für die Website)

## Marketing-Seiten und Blog

- `blog/vorlage.html` ist die Vorlage für jede Marketing-Seite (Anleitung, Vergleich, Kampagnen-Auswertung). Kopieren, umbenennen, Texte und Bilder ersetzen.
- Neue Beiträge in `blog/index.html` und – wenn sie auf die Startseite sollen – in `index.html` im Abschnitt `#blog` eintragen (Karten mit `class="post"`; die Klasse `ph` kennzeichnet Platzhalter und zeichnet den Rahmen gestrichelt).
- `fuer/*.html` sind die Zielgruppen-Seiten (Clipper, Streamer, Podcasts, Agenturen); Bereiche mit `class="ph-note"` sind Platzhalter für Beispiele und Zitate.
- Abschnitte auf der Startseite mit `data-placeholder` (Stimmen, Preise, Blog) sind bewusst noch Platzhalter.
- Partner-Logos: SVG oder PNG als `partner/content-hero.svg` bzw. `partner/adhletic.svg` ablegen – das Laufband zeigt sie automatisch (bis dahin die Namen).

## Hochladen bei IONOS

Alle Dateien und den Ordner `fonts/` in das Verzeichnis des Webspace laden, auf das imakio.de zeigt (Webspace-Explorer oder SFTP). Der Ordner `logo/` und diese README müssen nicht mit hoch.

## Automatisch veröffentlichen

Bei jeder Änderung in `website/` lädt die GitHub Action `.github/workflows/deploy-website.yml` die Dateien per SFTP auf den IONOS-Webspace. Dafür einmalig im Repo unter **Settings → Secrets and variables → Actions** vier Secrets anlegen: `IONOS_SFTP_HOST`, `IONOS_SFTP_USER`, `IONOS_SFTP_PASSWORD` und `IONOS_SFTP_PATH` (z. B. `/imakio`). Starten lässt sie sich auch per Hand unter **Actions → Website veröffentlichen → Run workflow**.

## Lokal ansehen

`index.html` im Browser öffnen, oder im Ordner `python3 -m http.server` ausführen und http://localhost:8000 aufrufen.
