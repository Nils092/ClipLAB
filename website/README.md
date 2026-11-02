# imakio.de – Website

Startseite von Imakio mit Scroll-Story, automatisch drehendem 3D-Karussell und Kontakt. Reines HTML, CSS und JavaScript, ohne Build-Schritt und ohne externe Dienste (Schriften liegen in `fonts/`, keine Cookies).

## Inhalt

- `index.html`, `style.css`, `app.js` – die Startseite
- `impressum.html`, `datenschutz.html` – Rechtstexte, **markierte Stellen vor dem Hochladen ausfüllen**
- `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` – Browser- und Homescreen-Icons
- `fonts/` – Poppins und Lora (SIL Open Font License), selbst gehostet
- `logo/` – Logo und App-Icon in Schwarz und Weiß als SVG und PNG (nicht nötig für die Website)

## Hochladen bei IONOS

Alle Dateien und den Ordner `fonts/` in das Verzeichnis des Webspace laden, auf das imakio.de zeigt (Webspace-Explorer oder SFTP). Der Ordner `logo/` und diese README müssen nicht mit hoch.

## Lokal ansehen

`index.html` im Browser öffnen, oder im Ordner `python3 -m http.server` ausführen und http://localhost:8000 aufrufen.
