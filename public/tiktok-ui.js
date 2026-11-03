// TikTok-Posting-Dialog nach den TikTok-Richtlinien für die Content Posting API (Direct Post):
// Creator-Name anzeigen, Sichtbarkeit ohne Vorauswahl, Interaktionen standardmäßig aus (gesperrte ausgegraut),
// Werbe-Kennzeichnung mit Hinweisen, Zustimmungstext mit Links, Längen-Check, Hinweis auf Verarbeitung.
// Nutzung: const t = ClipLabTikTok.mount(container, { accountId, durationSec }); t.ready() → bool; t.value() → Optionen
window.ClipLabTikTok = (() => {
  const PRIVACY = {
    PUBLIC_TO_EVERYONE: "Öffentlich – jeder", MUTUAL_FOLLOW_FRIENDS: "Freunde (gegenseitig folgen)",
    FOLLOWER_OF_CREATOR: "Follower", SELF_ONLY: "Nur ich (privat)",
  };
  const MUC = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
  const BCP = "https://www.tiktok.com/legal/page/global/bc-policy/en";
  const css = `
  .tt { border: 1px solid var(--line, rgba(255,255,255,.12)); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,.03); font-size: 13px; }
  .tt .who { display: flex; align-items: center; gap: 10px; } .tt .who img { width: 28px; height: 28px; border-radius: 50%; }
  .tt .who b { font-weight: 600; } .tt .hint { color: var(--muted, #8F8F8F); font-size: 12.5px; margin: 0; }
  .tt label { display: flex; flex-direction: column; gap: 6px; color: var(--muted, #8F8F8F); font-size: 12px; }
  .tt select { font: inherit; color: var(--ink, #F4F4F4); background: var(--sunken, #0E0E0E); border: 1px solid var(--line, rgba(255,255,255,.12)); border-radius: 8px; padding: 9px 11px; }
  .tt .chk { display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .tt .chk label { flex-direction: row; align-items: center; gap: 7px; color: var(--ink, #F4F4F4); font-size: 13px; }
  .tt .chk label.off { opacity: .45; } .tt input[type=checkbox] { width: auto; accent-color: #fff; }
  .tt .warn { color: var(--warn, #E8C37A); } .tt .err { color: var(--err, #FF8A80); }
  .tt a { color: inherit; }`;
  if (!document.getElementById("tt-css")) { const s = document.createElement("style"); s.id = "tt-css"; s.textContent = css; document.head.append(s); }

  function mount(container, { accountId, durationSec }) {
    const root = document.createElement("div"); root.className = "tt";
    root.innerHTML = `<p class="hint">TikTok wird geladen …</p>`;
    container.append(root);
    let info = null, listeners = [];
    const dur = () => (typeof durationSec === "function" ? durationSec() : durationSec) || 0;
    const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v); } e.append(...kids.filter((x) => x != null)); return e; };
    const change = () => { render(); listeners.forEach((f) => f()); };
    let state = { privacy: "", allowComment: false, allowDuet: false, allowStitch: false, commercialOn: false, brand: false, branded: false };
    let consent = null, privacySel = null;

    function render() {
      root.innerHTML = "";
      if (!info) return root.append(el("p", { class: "hint err" }, "TikTok-Infos konnten nicht geladen werden. Bitte Account neu verbinden."));
      root.append(el("div", { class: "who" }, info.avatar ? el("img", { src: info.avatar, alt: "" }) : null,
        el("span", {}, "Wird gepostet als ", el("b", {}, info.nickname || info.username || "TikTok-Account"))));
      if (info.unaudited) root.append(el("p", { class: "hint warn" }, "Hinweis: Die ClipLab-App ist bei TikTok noch nicht geprüft. Bis dahin erlaubt TikTok nur die Sichtbarkeit „Nur ich“."));
      if (info.maxDuration && dur() > info.maxDuration) root.append(el("p", { class: "hint err" }, `Video ist ${Math.round(dur())} s lang – dein TikTok-Konto erlaubt höchstens ${info.maxDuration} s.`));

      // Sichtbarkeit: keine Vorauswahl
      privacySel = el("select", { onchange: (e) => { state.privacy = e.target.value; change(); } },
        el("option", { value: "", disabled: true, selected: !state.privacy }, "Bitte wählen …"),
        ...(info.privacyOptions || []).map((v) => el("option", { value: v, selected: state.privacy === v, disabled: v === "SELF_ONLY" && state.branded, title: v === "SELF_ONLY" && state.branded ? "Branded content visibility cannot be set to private" : null }, PRIVACY[v] || v)));
      root.append(el("label", {}, "Wer kann das Video sehen?", privacySel));

      // Interaktionen: standardmäßig aus, gesperrte ausgegraut
      const inter = (key, label, disabled) => el("label", { class: disabled ? "off" : "", title: disabled ? "In deinen TikTok-Einstellungen deaktiviert" : null },
        el("input", { type: "checkbox", checked: !disabled && state[key], disabled, onchange: (e) => { state[key] = e.target.checked; change(); } }), label);
      root.append(el("div", { class: "chk" }, inter("allowComment", "Kommentare erlauben", info.commentDisabled), inter("allowDuet", "Duett erlauben", info.duetDisabled), inter("allowStitch", "Stitch erlauben", info.stitchDisabled)));

      // Werbe-Kennzeichnung
      const comm = el("div", { class: "chk" }, el("label", {}, el("input", { type: "checkbox", checked: state.commercialOn, onchange: (e) => { state.commercialOn = e.target.checked; if (!state.commercialOn) { state.brand = state.branded = false; } change(); } }), "Dieses Video bewirbt etwas (Werbe-Kennzeichnung)"));
      root.append(comm);
      if (state.commercialOn) {
        root.append(el("div", { class: "chk" },
          el("label", {}, el("input", { type: "checkbox", checked: state.brand, onchange: (e) => { state.brand = e.target.checked; change(); } }), "Deine Marke"),
          el("label", {}, el("input", { type: "checkbox", checked: state.branded, onchange: (e) => { state.branded = e.target.checked; if (state.branded && state.privacy === "SELF_ONLY") state.privacy = ""; change(); } }), "Branded Content (bezahlte Partnerschaft)")));
        if (!state.brand && !state.branded) root.append(el("p", { class: "hint warn" }, "You need to indicate if your content promotes yourself, a third party, or both."));
        else root.append(el("p", { class: "hint" }, state.branded ? "Your video will be labeled as „Paid partnership“" : "Your video will be labeled as „Promotional content“"));
        if (state.branded) root.append(el("p", { class: "hint" }, "Branded content visibility cannot be set to private."));
      }

      // Zustimmung
      const links = state.branded
        ? ["By posting, you agree to TikTok's ", el("a", { href: BCP, target: "_blank", rel: "noopener" }, "Branded Content Policy"), " and ", el("a", { href: MUC, target: "_blank", rel: "noopener" }, "Music Usage Confirmation"), "."]
        : ["By posting, you agree to TikTok's ", el("a", { href: MUC, target: "_blank", rel: "noopener" }, "Music Usage Confirmation"), "."];
      consent = el("p", { class: "hint" }, ...links);
      root.append(consent);
      root.append(el("p", { class: "hint" }, "Nach dem Posten kann es ein paar Minuten dauern, bis das Video im Profil sichtbar ist."));
    }

    const api = {
      ready: () => Boolean(info && state.privacy && !(state.commercialOn && !state.brand && !state.branded) && !(info.maxDuration && dur() > info.maxDuration)),
      value: () => ({ privacy: state.privacy, allowComment: state.allowComment, allowDuet: state.allowDuet, allowStitch: state.allowStitch, commercial: { brand: state.brand, branded: state.branded } }),
      onChange: (f) => listeners.push(f),
      problem: () => !info ? "TikTok-Infos fehlen" : !state.privacy ? "Bitte bei TikTok die Sichtbarkeit wählen." : (state.commercialOn && !state.brand && !state.branded) ? "Bitte angeben, was das Video bewirbt." : (info.maxDuration && dur() > info.maxDuration) ? "Video zu lang für dein TikTok-Konto." : null,
    };
    fetch(`/api/accounts/${encodeURIComponent(accountId)}/tiktok-creator`, { credentials: "same-origin" })
      .then((r) => r.json()).then((j) => { info = j.error ? null : j; render(); listeners.forEach((f) => f()); })
      .catch(() => { info = null; render(); });
    return api;
  }
  return { mount };
})();
