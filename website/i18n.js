// imakio – Sprachumschalter Deutsch/Englisch für die Startseite.
// Deutsch steht im HTML; Englisch liegt hier als Liste [Selektor, HTML]. Mehrere Treffer eines Selektors werden der Reihe nach belegt.
// Die Wahl wird im Browser gemerkt; ohne gemerkte Wahl entscheidet die Browsersprache (alles außer Deutsch → Englisch).
(() => {
  "use strict";
  const EN = [
    ['.nav a[href="#idee"]', "Idea"], ['.nav a[href="#funke"]', "Spark"], ['.nav a[href="#bauen"]', "Workshop"], ['.nav a[href="#cliplab"]', "Projects"], ['.nav a[href="blog/"]', "Blog"], ['.nav a[href="#kontakt"]', "Contact"],
    [".top > .pill", "Submit an idea"],
    // Bühne
    ['.head[data-step="0"] .kicker', "imakio · a workshop for ideas"], ['.head[data-step="0"] h1', "Dreams that get <em>finished.</em>"],
    ['.head[data-step="0"] > p:not(.kicker)', "Every good thing started as a daydream. At imakio, daydreams aren’t laughed at – they get built."],
    ['.head[data-step="0"] .pill:not(.ghost)', "Submit an idea"], ['.head[data-step="0"] .pill.ghost', "What we build"],
    ['.head[data-step="1"] .kicker', "02 · Spark"], ['.head[data-step="1"] h2', "One spark <em>is enough.</em>"], ['.head[data-step="1"] > p:not(.kicker)', "Out of a thousand loose thoughts, one stays. That’s the one we hold on to."],
    ['.head[data-step="2"] .kicker', "03 · World"], ['.head[data-step="2"] h2', "Made <em>for the</em> whole world."], ['.head[data-step="2"] > p:not(.kicker)', "Good ideas know no borders. We build them to land anywhere – in Mainz, Lagos or Osaka."],
    ['.head[data-step="3"] .kicker', "04 · Build"], ['.head[data-step="3"] h2', "Built <em>piece</em> by piece."], ['.head[data-step="3"] > p:not(.kicker)', "The dream becomes a frame, the frame becomes a product that really works."],
    ['.head[data-step="4"] .kicker', "05 · Live"], ['.head[data-step="4"] h2', "And suddenly <em>it’s</em> there."], ['.head[data-step="4"] > p:not(.kicker)', "With its own address and real people using it. The next dream is already waiting."],
    ['.head[data-step="4"] .pill', "See the projects →"],
    [".phases li", "Dream"], [".phases li", "Spark"], [".phases li", "World"], [".phases li", "Build"], [".phases li", "Live"],
    [".scrollhint", "Scroll"], ["#heroHint", "move your mouse ✦"], [".marquee .eyebrow", "Partners &amp; friends from Mainz"],
    // Manifest
    ["#idee .eyebrow", '<span class="chap">06</span>The idea behind imakio'], ["#idee-t", "A workshop <em>for daydreams.</em>"],
    ["#idee .lede", "imakio means: I make it. Under this name, tools, apps and projects come to life – from thoughts that would otherwise have stayed in a drawer."],
    [".tri h3", "Dream"], [".tri h3", "Build"], [".tri h3", "Share"],
    [".tri p", "Think big first, sort later. No idea is too wild for a first draft."], [".tri p", "Start small, show something real quickly, then make it better – piece by piece."], [".tri p", "Once it’s ready, it goes out into the world – for everyone who can use it, wherever they are."],
    // Weg
    ["#weg .eyebrow", "The journey of an idea"], ["#weg-t", "From a napkin <em>into the world.</em>"],
    [".stops b", "Dream"], [".stops b", "Spark"], [".stops b", "Sketch"], [".stops b", "Prototype"], [".stops b", "Live"],
    [".stops span", "A thought in the shower."], [".stops span", "It won’t let you go."], [".stops span", "First on paper, then on screen."], [".stops span", "Something real to try."], [".stops span", "Out into the world."],
    // Funke
    ["#funke .eyebrow", '<span class="chap">07</span>Idea spark'], ["#funke-t", "What <em>if …</em>"], ["#sparkNext", "New spark ✦"], ["#sparkMail", "Submit this idea"],
    ["#funke .hint-line", "Or send us your own – the best one becomes the next project."], [".s-spark", 'click me <svg viewBox="0 0 60 40" width="46" height="30"><path d="M4 6c18 2 34 10 44 26M48 32l-9-3M48 32l2-10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
    // Himmel
    ["#himmel .eyebrow", "Sky of ideas"], ["#himmel-t", "Every idea <em>becomes a star.</em>"], ["#himmel .lede", "Hover over the stars. Submitted ideas appear here once we’ve approved them – with first name and city, if you like."],
    // Wand
    ["#bauen .eyebrow", '<span class="chap">08</span>What we build'], ["#bauen-t", "Six ways <em>ideas land.</em>"],
    [".wt b", "ClipLab"], [".wt small", "Live"], [".wcap h3", "ClipLab"], [".wtag", "Live"], [".wcap p", "Finds the strongest moments in long videos, cuts them to vertical and plays them out on TikTok, Instagram and YouTube."],
    [".wt b", "Automation"], [".wt small", "Ideas welcome"], [".wcap h3", "Automation"], [".wtag", "Ideas welcome"], [".wcap p", "Repetitive chores that a program takes over. Fewer clicks, more time for what matters."],
    [".wt b", "Web apps"], [".wt small", "Ideas welcome"], [".wcap h3", "Web apps"], [".wtag", "Ideas welcome"], [".wcap p", "Tools in the browser that run without installing anything – on a computer and on a phone."],
    [".wt b", "Mobile apps"], [".wt small", "Planned"], [".wcap h3", "Mobile apps"], [".wtag", "Planned"], [".wcap p", "When an idea belongs in your pocket: apps for iOS and Android."],
    [".wt b", "Websites"], [".wt small", "Ideas welcome"], [".wcap h3", "Websites"], [".wtag", "Ideas welcome"], [".wcap p", "Clear, fast sites with character – like this one."],
    [".wt b", "Your idea"], [".wt small", "Open"], [".wcap h3", "Your idea"], [".wtag", "Open"], [".wcap p", "Got a thought that deserves to be built? Tell us – it might become the next project."],
    [".wcap .golink", "cliplab.imakio.de →"], [".wcap .golink", "Submit an idea →"],
    [".numbers.strip dt", "Project live"], [".numbers.strip dt", "Ways ideas land"], [".numbers.strip dt", "Percent self-built"], [".numbers.strip dt", "Cookies on this site"],
    // ClipLab
    ["#cliplab .product-head .eyebrow", '<span class="chap">09</span>Project 01 · Live'], ["#cliplab-t", "ClipLab. <em>Clips that run.</em>"],
    ["#cliplab .lede", "Long videos become short clips: stream, podcast or recording in – ClipLab finds the strongest moments, cuts them to vertical, adds subtitles and a title and posts straight to TikTok, Instagram and YouTube."],
    ["#stepTabs b", "Video in"], ["#stepTabs b", "Check clips"], ["#stepTabs b", "Post"],
    ["#stepTabs small", "File or link (YouTube, Twitch, Kick, TikTok), pick a goal."], ["#stepTabs small", "Laughs and reactions detected, people in frame, title and subtitles on."], ["#stepTabs small", "One by one, all at once or on autopilot – with a log."],
    ["#cliplab .cta-row .pill.dark", "Open ClipLab"], ["#cliplab .cta-row .pill.ghost-dark", "More about ClipLab"],
    [".flow .eyebrow", "Sources"], [".flow .eyebrow", "Platforms"], [".flow-core small", "finds · cuts · subtitles"],
    // Blog, Kontakt, Fuß
    ["#blog .eyebrow", '<span class="chap">10</span>News from the workshop'], ["#blog-t", "Notes &amp; <em>thoughts.</em>"], ["#blog .row-head .pill", "To the blog"],
    ["#kontakt .eyebrow", '<span class="chap">11</span>Contact'], ["#kontakt-t", "Let’s build <em>yours.</em>"], ["#kontakt .lede", "For daydreams, half-formed thoughts and ideas that want to be built. Just write – in any language."],
    ['#kontakt .pill:not(.ghost)', "Submit an idea"], ["#kontakt .pill.ghost", "Write on WhatsApp"],
    [".foot-brand p", "A workshop for ideas from Mainz – made for the whole world."],
    ["#atelierBtn", '<span aria-hidden="true">✦</span> Studio']
  ];
  const PHASES = { de: ["Traum", "Funke", "Welt", "Bauen", "Live"], en: ["Dream", "Spark", "World", "Build", "Live"] };
  const store = new Map();
  let cur = "de";
  function apply(lang) {
    const seen = new Map();
    EN.forEach(([sel, html]) => {
      const n = seen.get(sel) || 0; seen.set(sel, n + 1);
      const el = document.querySelectorAll(sel)[n]; if (!el) return;
      if (!store.has(el)) store.set(el, el.innerHTML);
      el.innerHTML = lang === "en" ? html : store.get(el);
    });
    cur = lang; document.documentElement.lang = lang;
    const btn = document.getElementById("lang"); if (btn) btn.classList.toggle("en", lang === "en");
    try { localStorage.setItem("imakio-lang", lang); } catch (e) {}
    window.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
    window.dispatchEvent(new Event("scroll"));
  }
  window.imakioLang = { get: () => cur, phases: () => PHASES[cur] };
  let want = "de";
  try { want = localStorage.getItem("imakio-lang") || ((navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en"); } catch (e) {}
  const btn = document.getElementById("lang");
  if (btn) btn.addEventListener("click", () => apply(cur === "de" ? "en" : "de"));
  if (want === "en") apply("en");
})();
