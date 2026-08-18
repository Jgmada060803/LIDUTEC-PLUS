// ---------------------------------------------------------------------------
// Busca rápida + seta anterior/próximo de produto, no topbar. Compartilhado
// entre detalhes.html e as telas de ficha (moldagem/fusao-vazamento/
// macharia.html) — cada uma inclui este script e chama updateProductNav(id)
// depois de carregar o produto atual. Por padrão os links apontam pra
// detalhes.html; uma tela pode chamar setLinkBuilder(fn) pra apontar pra si
// mesma (ex.: moldagem.html?produto=<id> em vez de detalhes.html?id=<id>).
// Navegação por seleção (não preenche campo, navega) — por isso não usa o
// window.LIDUTEC_TYPEAHEAD genérico.
// ---------------------------------------------------------------------------
(function initializeProductHeaderNav(root) {
  const topbarProductNav = document.querySelector("#topbar-product-nav");
  const prevProductLink = document.querySelector("#prev-product-link");
  const nextProductLink = document.querySelector("#next-product-link");
  const headerProductSearch = document.querySelector("#header-product-search");
  const headerSearchResults = document.querySelector("#header-search-results");
  const headerSearchEmpty = document.querySelector("#header-search-empty");

  if (!topbarProductNav || !headerProductSearch) {
    return;
  }

  const state = { directory: [] };
  let buildLink = (id) => `./detalhes.html?id=${id}`;

  async function loadDirectory() {
    const { data, error } = await window.supabaseClient
      .from("produtos")
      .select("id, codigo, nome, codigo_cliente, part_number, clientes(nome)")
      .order("codigo");

    if (error) {
      console.error("Erro ao carregar lista de produtos para navegação:", error);
      return;
    }

    state.directory = data ?? [];
  }
  const directoryReady = loadDirectory();

  function matchesDirectoryEntry(product, search) {
    const searchable = [
      product.codigo,
      product.nome,
      product.codigo_cliente,
      product.part_number,
      product.clientes?.nome
    ].filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(search);
  }

  function closeHeaderSuggestions() {
    headerSearchResults.replaceChildren();
    headerSearchResults.hidden = true;
    headerSearchEmpty.hidden = true;
    headerProductSearch.setAttribute("aria-expanded", "false");
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function renderHeaderSuggestions(products) {
    headerSearchResults.replaceChildren();

    if (!products.length) {
      headerSearchResults.hidden = true;
      headerSearchEmpty.hidden = false;
      headerProductSearch.setAttribute("aria-expanded", "false");
      return;
    }

    headerSearchEmpty.hidden = true;
    headerSearchResults.hidden = false;
    headerProductSearch.setAttribute("aria-expanded", "true");

    headerSearchResults.innerHTML = products.slice(0, 20).map((product) => `
      <li role="none">
        <a href="./detalhes.html?id=${product.id}" role="option" class="quick-search-result">
          <span class="product-code">${escapeHtml(product.codigo)}</span>
          <span class="product-name">${escapeHtml(product.nome)}</span>
          <span class="product-secondary">
            ${escapeHtml(product.clientes?.nome ?? "Sem cliente vinculado")}
          </span>
        </a>
      </li>
    `).join("");
  }

  function getHeaderSearchMatches() {
    const search = headerProductSearch.value.trim().toLowerCase();
    if (!search) {
      return null;
    }
    return state.directory.filter((product) =>
      matchesDirectoryEntry(product, search)
    );
  }

  function handleHeaderSearchInput() {
    const matches = getHeaderSearchMatches();
    if (matches === null) {
      closeHeaderSuggestions();
      return;
    }
    renderHeaderSuggestions(matches);
  }

  function handleHeaderSearchSubmit() {
    const matches = getHeaderSearchMatches();
    if (matches && matches.length === 1) {
      window.location.href = `./detalhes.html?id=${matches[0].id}`;
      return;
    }
    handleHeaderSearchInput();
    headerProductSearch.focus();
  }

  async function updateProductNav(currentId) {
    await directoryReady;
    const directory = state.directory;
    const index = directory.findIndex(
      (item) => String(item.id) === String(currentId)
    );
    const prev = index > 0 ? directory[index - 1] : null;
    const next =
      index >= 0 && index < directory.length - 1
        ? directory[index + 1]
        : null;

    if (prev) {
      prevProductLink.href = buildLink(prev.id);
      prevProductLink.classList.remove("is-disabled");
      prevProductLink.removeAttribute("aria-disabled");
    } else {
      prevProductLink.removeAttribute("href");
      prevProductLink.classList.add("is-disabled");
      prevProductLink.setAttribute("aria-disabled", "true");
    }

    if (next) {
      nextProductLink.href = buildLink(next.id);
      nextProductLink.classList.remove("is-disabled");
      nextProductLink.removeAttribute("aria-disabled");
    } else {
      nextProductLink.removeAttribute("href");
      nextProductLink.classList.add("is-disabled");
      nextProductLink.setAttribute("aria-disabled", "true");
    }
  }

  headerProductSearch.addEventListener("input", handleHeaderSearchInput);
  headerProductSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleHeaderSearchSubmit();
    }
  });
  headerProductSearch.addEventListener("focus", () => {
    if (headerProductSearch.value.trim()) {
      handleHeaderSearchInput();
    }
  });
  headerProductSearch.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!headerProductSearch.matches(":focus") &&
          !headerSearchResults.contains(document.activeElement)) {
        closeHeaderSuggestions();
      }
    }, 150);
  });

  root.LIDUTEC_PRODUCT_HEADER_NAV = {
    updateProductNav,
    setLinkBuilder: (fn) => { buildLink = fn; },
    hide: () => { topbarProductNav.hidden = true; }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
