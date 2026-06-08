(function () {
  const input = document.getElementById("globalSearch");
  if (!input) return;

  const pages = [
    { title: "Home", url: "index.html", keywords: ["home", "mission", "about", "start"] },
    { title: "Personalized", url: "personalized.html", keywords: ["personal", "personalized", "worksheet", "worksheets", "test", "generate"] },
    { title: "Baseline", url: "baseline.html", keywords: ["baseline", "base", "default"] },
    { title: "Marker", url: "image.html", keywords: ["marker", "mark", "image", "scan", "grade", "worksheet marker"] },
    { title: "Notes", url: "presentation.html", keywords: ["notes", "presentation", "slides", "deck"] },
    { title: "Docs", url: "documentation.html", keywords: ["docs", "documentation", "help", "guide"] },
    { title: "Account", url: "login.html", keywords: ["login", "signin", "sign in", "account", "profile", "create", "sign out"] },
    
  ];

  const styleId = "global-search-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .global-search{ position: relative; }
      .global-search-menu{
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        right: 0;
        z-index: 9999;
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 12px;
        overflow: hidden;
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(10px);
        box-shadow: 0 18px 45px rgba(0,0,0,0.35);
        display: none;
      }
      .global-search-item{
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        cursor: pointer;
        user-select: none;
        font-size: 0.95rem;
        
      }
      .global-search-item small{ opacity: 0.72; }
      .global-search-item:hover,
      .global-search-item[aria-selected="true"]{
        background: rgba(37, 99, 235, 0.20);
      }
      .global-search-empty{
        padding: 10px 12px;
        opacity: 0.75;
        font-size: 0.9rem;
      }
    `;
    document.head.appendChild(style);
  }

  const host = input.closest(".global-search") || input.parentElement || document.body;
  const menu = document.createElement("div");
  menu.className = "global-search-menu";
  menu.setAttribute("role", "listbox");
  host.appendChild(menu);

  let activeIndex = -1;
  let currentItems = [];

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function pageMatches(query, page) {
    if (!query) return true;
    const haystack = normalize([page.title, ...(page.keywords || [])].join(" "));
    const tokens = query.split(" ").filter(Boolean);
    for (const token of tokens) {
      if (!haystack.includes(token)) return false;
    }
    return true;
  }

  function openMenu() {
    if (menu.style.display !== "block") menu.style.display = "block";
  }

  function closeMenu() {
    menu.style.display = "none";
    activeIndex = -1;
    currentItems = [];
  }

  function setActive(nextIndex) {
    if (!currentItems.length) return;
    activeIndex = Math.max(0, Math.min(nextIndex, currentItems.length - 1));
    for (let i = 0; i < currentItems.length; i++) {
      currentItems[i].setAttribute("aria-selected", i === activeIndex ? "true" : "false");
    }
  }

  function navigateTo(url) {
    if (!url) return;
    window.location.href = url;
  }

  function render() {
    const query = normalize(input.value);
    const matches = pages.filter((p) => pageMatches(query, p)).slice(0, 6);

    menu.innerHTML = "";
    currentItems = [];
    activeIndex = -1;

    if (!query) {
      closeMenu();
      return;
    }

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "global-search-empty";
      empty.textContent = "No matching pages.";
      menu.appendChild(empty);
      openMenu();
      return;
    }

    matches.forEach((page, idx) => {
      const item = document.createElement("div");
      item.className = "global-search-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.innerHTML = `<span>${page.title}</span>`;
      item.addEventListener("mousedown", (e) => {
        // Prevent blur from closing the menu before the click runs.
        e.preventDefault();
      });
      item.addEventListener("click", () => navigateTo(page.url));
      menu.appendChild(item);
      currentItems.push(item);

      if (idx === 0) setActive(0);
    });

    openMenu();
  }

  function goFirstMatch() {
    const query = normalize(input.value);
    if (!query) return;
    const match = pages.find((p) => pageMatches(query, p));
    if (match) navigateTo(match.url);
  }

  input.addEventListener("input", render);
  input.addEventListener("focus", render);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      return;
    }

    if (e.key === "ArrowDown") {
      if (menu.style.display !== "block") render();
      setActive(activeIndex + 1);
      e.preventDefault();
      return;
    }

    if (e.key === "ArrowUp") {
      if (menu.style.display !== "block") render();
      setActive(activeIndex - 1);
      e.preventDefault();
      return;
    }

    if (e.key === "Enter") {
      if (menu.style.display === "block" && currentItems.length && activeIndex >= 0) {
        const query = normalize(input.value);
        const matches = pages.filter((p) => pageMatches(query, p)).slice(0, 6);
        navigateTo(matches[activeIndex]?.url);
        return;
      }
      goFirstMatch();
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target === input) return;
    if (host.contains(e.target)) return;
    closeMenu();
  });
})();
