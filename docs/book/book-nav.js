// Injects the book's contents tree as a sticky sidebar on every book page, and
// highlights the current page. Included via <script src="/book/book-nav.js" defer>.
// Nodes: { label, href?, icon?, children? } - a node with no href renders as a
// (sub)group header; nesting is shown by indentation; icon is inline SVG / a char.
(() => {
  // --- glyphs ---------------------------------------------------------------
  const I = {
    book:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C9.5 5 6.5 4.7 4 5.2V19c2.5-.5 5.5-.2 8 1.3"/><path d="M12 6.5C14.5 5 17.5 4.7 20 5.2V19c-2.5-.5-5.5-.2-8 1.3"/></svg>',
    map:
      '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="7" r="1.5"/><circle cx="14" cy="5" r="1.5"/><circle cx="18.5" cy="11" r="1.5"/><circle cx="9.5" cy="13" r="1.5"/><circle cx="5.5" cy="18" r="1.5"/><circle cx="16" cy="18.5" r="1.5"/></svg>',
    layers:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3 21 8 12 13 3 8Z"/><path d="M3 13 12 18 21 13"/></svg>',
    areas:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>',
    keys:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/></svg>',
    eraser:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16 13 8a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-4 4H9z"/><path d="M9 20h11"/></svg>',
    arch:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M6.5 10v4.5H14" stroke-linecap="round"/></svg>',
    pencil:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4L15 6l3 3L8 19z"/><path d="M13 8l3 3"/></svg>',
    pen:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><circle cx="11" cy="11" r="2"/></svg>',
    link:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8.7" y1="15.3" x2="15.3" y2="8.7"/><circle cx="6.3" cy="17.7" r="3" fill="currentColor" stroke="none"/><circle cx="17.7" cy="6.3" r="3" fill="currentColor" stroke="none"/></svg>',
    toolbar:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="8" width="18" height="8" rx="2.5"/><circle cx="7" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="11" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/></svg>',
    sliders:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h8M16 7h4M4 17h4M12 17h8"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    image:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 16l-5-5L5 20"/></svg>',
    gear:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    view:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-3.6-3.6M8.5 11h5M11 8.5v5"/></svg>',
    // brushes - the app's own glyphs
    round: "●",
    squares: "▭",
    circles: "◯",
    marker:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3 L21 8 L10 19 L4 19 L4 13 Z"/><path d="M13 6 L18 11"/><path d="M4 13 L10 19"/></svg>',
    symmetry:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3 V21 M3 12 H21 M5.6 5.6 L18.4 18.4 M18.4 5.6 L5.6 18.4"/></svg>',
    invisible:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 2"><circle cx="8" cy="8" r="5"/></svg>',
    // connections - the app's own glyphs
    classic:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M2 6 L12 11 M4 11.5 L13 5 M3 9 L11 9"/></svg>',
    web:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="2"/><path d="M12 3 V21 M3 12 H21 M6 6 L18 18 M18 6 L6 18"/><path d="M12 6 A6 6 0 0 1 18 12 M12 6 A6 6 0 0 0 6 12"/></svg>',
    arc:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 12 A6 6 0 0 1 14 12"/><circle cx="2" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="14" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
    shaded:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M3 10 L8 5 M5 12.5 L11 6 M8 13 L13 8"/></svg>',
    fur:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M3 13 Q4 7 5 4 M6 13 Q7 7 8 4 M9 13 Q10 7 11 4 M12 13 Q12.5 8 13 5"/></svg>',
    lace:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M2 8 A2 2 0 0 1 6 8 A2 2 0 0 1 10 8 A2 2 0 0 1 14 8"/><circle cx="2" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="14" cy="8" r="0.9" fill="currentColor" stroke="none"/></svg>',
  };

  const TREE = [
    { label: "Book home", href: "/book/", icon: I.book },
    {
      label: "Core concepts",
      children: [
        { label: "Memory maps", href: "/book/map.html", icon: I.map },
        { label: "Layers", href: "/book/layers.html", icon: I.layers },
      ],
    },
    {
      label: "Interface",
      children: [
        { label: "Toolbar", href: "/book/ui/toolbar.html", icon: I.toolbar },
        { label: "Navigating the canvas", href: "/book/ui/canvas-view.html", icon: I.view },
        { label: "Paste an image", href: "/book/ui/paste-image.html", icon: I.image },
        {
          label: "Panels",
          children: [
            { label: "Brush & Connecting settings", href: "/book/ui/settings.html", icon: I.sliders },
            { label: "Layers panel", href: "/book/ui/layers-panel.html", icon: I.layers },
            { label: "Memory Maps panel", href: "/book/ui/maps-panel.html", icon: I.map },
            { label: "Symmetry panel", href: "/book/ui/symmetry-panel.html", icon: I.symmetry },
            { label: "Application settings", href: "/book/ui/app-settings.html", icon: I.gear },
            { label: "Shortcuts panel", href: "/book/ui/shortcuts-panel.html", icon: I.keys },
          ],
        },
      ],
    },
    {
      label: "Drawing tools",
      children: [
        {
          label: "Brushes",
          children: [
            { label: "Round", href: "/book/brushes/classic-round.html", icon: I.round },
            { label: "Squares", href: "/book/brushes/squares.html", icon: I.squares },
            { label: "Circles", href: "/book/brushes/circles.html", icon: I.circles },
            { label: "Marker", href: "/book/brushes/marker.html", icon: I.marker },
          ],
        },
        { label: "Symmetry", href: "/book/symmetry.html", icon: I.symmetry },
        { label: "Pen & pressure", href: "/book/pen.html", icon: I.pen },
        {
          label: "Connections",
          href: "/book/connections.html",
          icon: I.link,
          children: [
            {
              label: "Classic",
              children: [
                { label: "Airy", href: "/book/connections.html#classic", icon: I.classic },
                { label: "String Art", href: "/book/brushes/web.html", icon: I.web },
                { label: "Shading", href: "/book/connections.html#shaded", icon: I.shaded },
              ],
            },
            {
              label: "More",
              children: [
                { label: "Fur", href: "/book/textures.html#fur", icon: I.fur },
                { label: "Lace", href: "/book/textures.html#lace", icon: I.lace },
                { label: "Arc", href: "/book/connections.html#arc", icon: I.arc },
              ],
            },
            { label: "Custom", href: "/book/connections.html#custom", icon: I.link },
          ],
        },
      ],
    },
    {
      label: "Utilities",
      children: [
        { label: "Invisible", href: "/book/brushes/invisible.html", icon: I.invisible },
        { label: "Eraser", href: "/book/eraser.html", icon: I.eraser },
      ],
    },
    {
      label: "Developers",
      children: [
        { label: "Architecture", href: "/book/dev/architecture.html", icon: I.arch },
        { label: "Writing a brush", href: "/book/dev/brushes.html", icon: I.pencil },
        { label: "Writing a connection", href: "/book/dev/connections.html", icon: I.link },
        { label: "Writing a symmetry tool", href: "/book/dev/symmetry.html", icon: I.symmetry },
      ],
    },
    {
      label: "Misc",
      children: [
        { label: "Covering bigger areas", href: "/book/bigger-areas.html", icon: I.areas },
        { label: "Shortcuts & gestures", href: "/book/shortcuts.html", icon: I.keys },
      ],
    },
  ];

  const norm = (p) => p.replace(/index\.html$/, "").replace(/\/$/, "") || "/book";
  const here = norm(location.pathname);
  const hereHash = location.hash; // "" or "#anchor"
  const pad = (depth) => `${10 + depth * 12}px`;

  // A nav entry is active when its page matches the current path. Anchor links
  // (href with a #fragment) also require the fragment to match, so on a page
  // like connections.html only the bare page link lights up - not every anchor.
  const isActive = (href) => {
    const i = href.indexOf("#");
    const path = i < 0 ? href : href.slice(0, i);
    const hash = i < 0 ? "" : href.slice(i);
    if (norm(path) !== here) return false;
    return hash ? hash === hereHash : true;
  };

  const aside = document.createElement("aside");
  aside.className = "book-sidebar";
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Book contents");

  const renderNodes = (nodes, depth) => {
    for (const node of nodes) {
      if (node.href) {
        const a = document.createElement("a");
        a.className = "book-nav-link";
        a.href = node.href;
        a.style.paddingLeft = pad(depth);
        const ic = document.createElement("span");
        ic.className = "book-nav-icon";
        ic.innerHTML = node.icon || "";
        a.appendChild(ic);
        a.appendChild(document.createTextNode(node.label));
        if (isActive(node.href)) a.classList.add("active");
        nav.appendChild(a);
      } else {
        const h = document.createElement("div");
        h.className = depth === 0 ? "book-nav-group" : "book-nav-subgroup";
        h.textContent = node.label;
        if (depth > 0) h.style.paddingLeft = pad(depth);
        nav.appendChild(h);
      }
      if (node.children) renderNodes(node.children, depth + 1);
    }
  };
  renderNodes(TREE, 0);
  aside.appendChild(nav);

  // --- lightweight TS/JS syntax highlighting -------------------------------
  // Self-contained (no CDN): tokenize the code in <pre><code> blocks and wrap
  // tokens in spans (coloured by docs.css). Skips .filetree blocks (the module
  // map is prose, not code). Reads textContent and re-escapes, so it round-trips
  // any &lt; in the source safely.
  const KEYWORDS = new Set(
    ("const let var function return if else for while do switch case break " +
      "continue new class extends implements interface type enum import export " +
      "from as default public private protected readonly static async await " +
      "yield void null undefined true false typeof instanceof in of throw try " +
      "catch finally get set abstract override declare namespace this super")
      .split(" "),
  );
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const TOKEN =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\w.]*)|([A-Za-z_$][\w$]*)/g;
  const highlightTS = (code) => {
    let out = "";
    let last = 0;
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(code))) {
      out += esc(code.slice(last, m.index));
      const [whole, comment, str, num, ident] = m;
      if (comment != null) out += `<span class="tok-c">${esc(comment)}</span>`;
      else if (str != null) out += `<span class="tok-s">${esc(str)}</span>`;
      else if (num != null) out += `<span class="tok-n">${esc(num)}</span>`;
      else {
        let cls = "";
        if (KEYWORDS.has(ident)) cls = "tok-k";
        else if (/^[A-Z]/.test(ident)) cls = "tok-t";
        else if (code[m.index + whole.length] === "(") cls = "tok-f";
        out += cls ? `<span class="${cls}">${esc(ident)}</span>` : esc(ident);
      }
      last = m.index + whole.length;
    }
    return out + esc(code.slice(last));
  };
  const highlightCode = () => {
    for (const code of document.querySelectorAll("pre:not(.filetree) code")) {
      if (code.dataset.hl) continue;
      code.dataset.hl = "1";
      code.innerHTML = highlightTS(code.textContent);
    }
  };

  const mount = () => {
    highlightCode();
    const main = document.querySelector("main");
    if (!main) return;
    const shell = document.createElement("div");
    shell.className = "book-shell";
    main.parentNode.insertBefore(shell, main);
    shell.appendChild(aside);
    shell.appendChild(main);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
