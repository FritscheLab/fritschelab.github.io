(function () {
  "use strict";

  document.querySelectorAll("[data-author-byline]").forEach(function (byline, bylineIndex) {
    const authors = Array.from(byline.querySelectorAll("[data-author-name]"));
    if (authors.length <= 50) return;

    // Keep edge consortium names alongside the first and last individuals.
    const individuals = authors.filter(function (author) { return !author.hasAttribute("data-group-author"); });
    const firstIndividualIndex = individuals.length ? authors.indexOf(individuals[0]) : authors.length - 1;
    const lastIndividualIndex = individuals.length ? authors.indexOf(individuals[individuals.length - 1]) : 0;

    const groups = [];
    let start = null;
    authors.forEach(function (author, index) {
      const keep = index <= firstIndividualIndex || index >= lastIndividualIndex ||
        author.hasAttribute("data-leading-author") || author.hasAttribute("data-team-author");
      if (!keep && start === null) start = index;
      if (keep && start !== null) {
        // Leave short gaps visible instead of surrounding one or two names with controls.
        if (index - start >= 3) groups.push({ start: start, end: index - 1 });
        start = null;
      }
    });

    groups.forEach(function (range, groupIndex) {
      const count = range.end - range.start + 1;
      const first = authors[range.start];
      const last = authors[range.end];
      const group = document.createElement("span");
      group.id = "byline-authors-" + (bylineIndex + 1) + "-" + (groupIndex + 1);
      group.setAttribute("data-author-group", "");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "author-toggle";
      toggle.setAttribute("aria-controls", group.id);

      function setExpanded(expanded) {
        group.hidden = !expanded;
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.textContent = (expanded ? "Hide " : "") + count + " authors";
        toggle.setAttribute("aria-label", (expanded ? "Hide " : "Show ") + count +
          " authors, positions " + (range.start + 1) + " to " + (range.end + 1));
      }

      toggle.addEventListener("click", function () {
        setExpanded(toggle.getAttribute("aria-expanded") !== "true");
      });
      byline.insertBefore(toggle, first);
      byline.insertBefore(group, first);
      let node = first;
      while (node) {
        const next = node.nextSibling;
        group.appendChild(node);
        if (node === last) break;
        node = next;
      }
      setExpanded(false);
    });
  });

  const logoNote = document.querySelector("[data-logo-note]");
  if (logoNote) {
    const logoLink = logoNote.querySelector(".site-brand");
    const tooltip = logoNote.querySelector('[role="tooltip"]');
    let hoveringLogo = false;
    let logoNoteTimer = null;

    function scheduleLogoNote() {
      if (!tooltip.hidden || logoNoteTimer !== null) return;
      logoNoteTimer = window.setTimeout(function () {
        logoNoteTimer = null;
        if (hoveringLogo || logoLink.matches(":focus-visible")) tooltip.hidden = false;
      }, 750);
    }

    function hideLogoNote() {
      window.clearTimeout(logoNoteTimer);
      logoNoteTimer = null;
      tooltip.hidden = true;
    }

    logoNote.addEventListener("pointerenter", function (event) {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      hoveringLogo = true;
      scheduleLogoNote();
    });
    logoNote.addEventListener("pointerleave", function () {
      hoveringLogo = false;
      if (!logoLink.matches(":focus-visible")) hideLogoNote();
    });
    logoLink.addEventListener("focus", function () {
      if (logoLink.matches(":focus-visible")) scheduleLogoNote();
    });
    logoLink.addEventListener("blur", function () {
      if (!hoveringLogo) hideLogoNote();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") hideLogoNote();
    });
  }

  const navToggle = document.querySelector("[data-nav-toggle]");
  const primaryNav = document.querySelector("[data-primary-nav]");
  const submenuToggle = document.querySelector("[data-submenu-toggle]");
  const siteHeader = document.querySelector("[data-site-header]");
  let lastHeaderFocus = null;

  document.addEventListener("focusin", function (event) {
    lastHeaderFocus = siteHeader && siteHeader.contains(event.target) ? event.target : null;
  });

  function closeSubmenu(restoreFocus) {
    if (!submenuToggle) return;
    submenuToggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) submenuToggle.focus();
  }

  function closeNavigation(restoreFocus) {
    closeSubmenu(false);
    if (!navToggle || !primaryNav) return;
    navToggle.setAttribute("aria-expanded", "false");
    primaryNav.classList.remove("is-open");
    if (restoreFocus) navToggle.focus();
  }

  if (navToggle && primaryNav) {
    document.documentElement.classList.add("nav-ready");
    navToggle.addEventListener("click", function () {
      const open = navToggle.getAttribute("aria-expanded") === "true";
      if (open) {
        closeNavigation(false);
        return;
      }
      navToggle.setAttribute("aria-expanded", String(!open));
      primaryNav.classList.toggle("is-open", !open);
    });
  }

  if (submenuToggle) {
    submenuToggle.addEventListener("click", function () {
      const open = submenuToggle.getAttribute("aria-expanded") === "true";
      submenuToggle.setAttribute("aria-expanded", String(!open));
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (submenuToggle && submenuToggle.getAttribute("aria-expanded") === "true") {
      closeSubmenu(true);
    } else if (navToggle && navToggle.getAttribute("aria-expanded") === "true") {
      closeNavigation(true);
    }
  });

  document.addEventListener("click", function (event) {
    if (siteHeader && !siteHeader.contains(event.target)) {
      lastHeaderFocus = null;
      closeNavigation(false);
    }
  });
  if (primaryNav) {
    primaryNav.addEventListener("focusout", function (event) {
      if (!event.relatedTarget || primaryNav.contains(event.relatedTarget)) return;
      if (siteHeader && !siteHeader.contains(event.relatedTarget)) {
        closeNavigation(false);
      } else {
        closeSubmenu(false);
      }
    });
  }
  window.matchMedia("(max-width: 980px)").addEventListener("change", function (event) {
    const focused = document.activeElement === document.body ? lastHeaderFocus : document.activeElement;
    const focusInNavigation = primaryNav && primaryNav.contains(focused);
    const focusInSubmenu = focusInNavigation && focused.closest(".submenu");
    closeNavigation(Boolean(focusInNavigation && event.matches));
    if (!event.matches) {
      if (focused === navToggle && primaryNav) primaryNav.querySelector("a").focus();
      else if (focusInSubmenu && submenuToggle) submenuToggle.focus();
    }
  });

  const publicationList = document.querySelector("[data-publication-list]");
  if (!publicationList) return;

  const publications = Array.from(publicationList.querySelectorAll("[data-publication]"));
  const viewControls = Array.from(document.querySelectorAll('[name="publication-view"]'));
  const search = document.querySelector("[data-publication-search]");
  const yearFrom = document.querySelector("[data-publication-year-from]");
  const yearTo = document.querySelector("[data-publication-year-to]");
  const topic = document.querySelector("[data-publication-topic]");
  const count = document.querySelector("[data-publication-count]");
  const empty = document.querySelector("[data-publication-empty]");
  const topicDefinitions = document.querySelector("[data-publication-topic-definitions]");
  const filterForm = document.querySelector("[data-publication-filters]");

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function containsPhrase(text, phrase) {
    return Boolean(phrase) && (" " + text + " ").includes(" " + phrase + " ");
  }

  function collectAliasGroups(value, groups, isExplicitGroup) {
    if (Array.isArray(value)) {
      const directAliases = value.filter(function (alias) {
        return typeof alias === "string";
      });
      if (isExplicitGroup && directAliases.length > 1) groups.push(directAliases);
      value.filter(Array.isArray).forEach(function (aliases) {
        collectAliasGroups(aliases, groups, true);
      });
      return;
    }

    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (alias) {
        const equivalents = Array.isArray(value[alias]) ? value[alias] : [value[alias]];
        groups.push([alias].concat(equivalents));
      });
    }
  }

  function readAliasGroups() {
    if (!topicDefinitions) return [];

    try {
      const definitions = JSON.parse(topicDefinitions.textContent);
      const groups = [];
      definitions.forEach(function (definition) {
        collectAliasGroups(definition.search_aliases, groups, false);
      });
      return groups
        .map(function (group) {
          return Array.from(new Set(group.map(normalizeSearchText).filter(Boolean)));
        })
        .filter(function (group) {
          return group.length > 1;
        });
    } catch (_error) {
      return [];
    }
  }

  const aliasGroups = readAliasGroups();
  const publicationSearchTokens = new WeakMap();

  publications.forEach(function (item) {
    const searchableText = normalizeSearchText(item.dataset.search || item.textContent);
    const expandedText = [searchableText];

    aliasGroups.forEach(function (group) {
      if (group.some(function (alias) { return containsPhrase(searchableText, alias); })) {
        expandedText.push(group.join(" "));
      }
    });

    publicationSearchTokens.set(
      item,
      new Set(normalizeSearchText(expandedText.join(" ")).split(" ").filter(Boolean))
    );
  });

  function selectedYear(control) {
    if (!control || !control.value) return null;
    const value = Number(control.value);
    return Number.isFinite(value) ? value : null;
  }

  function matchesSearchToken(indexedTokens, queryToken) {
    if (indexedTokens.has(queryToken)) return true;
    if (queryToken.length < 4) return false;

    return Array.from(indexedTokens).some(function (indexedToken) {
      return indexedToken.startsWith(queryToken);
    });
  }

  function constrainYearRange(changedControl) {
    let from = selectedYear(yearFrom);
    let to = selectedYear(yearTo);

    if (from !== null && to !== null && from > to) {
      if (changedControl === yearTo) {
        yearFrom.value = "";
        from = null;
      } else {
        yearTo.value = "";
        to = null;
      }
    }

    if (yearFrom) {
      Array.from(yearFrom.options).forEach(function (option) {
        option.disabled = Boolean(option.value) && to !== null && Number(option.value) > to;
      });
    }
    if (yearTo) {
      Array.from(yearTo.options).forEach(function (option) {
        option.disabled = Boolean(option.value) && from !== null && Number(option.value) < from;
      });
    }

    return { from: from, to: to };
  }

  function applyFilters(changedControl) {
    const checkedView = viewControls.find(function (control) {
      return control.checked;
    });
    const selectedView = checkedView ? checkedView.value : "all";
    const queryTokens = normalizeSearchText(search ? search.value : "").split(" ").filter(Boolean);
    const yearRange = constrainYearRange(changedControl);
    const selectedTopic = topic ? topic.value : "";
    const topicCounts = {};
    let availableAcrossTopics = 0;
    let visible = 0;

    publications.forEach(function (item) {
      const matchesView = selectedView === "all" || item.dataset.keyPublication === "true";
      const indexedTokens = publicationSearchTokens.get(item) || new Set();
      const matchesQuery = queryTokens.every(function (token) {
        return matchesSearchToken(indexedTokens, token);
      });
      const publicationYear = Number(item.dataset.year);
      const matchesYear =
        (yearRange.from === null || publicationYear >= yearRange.from) &&
        (yearRange.to === null || publicationYear <= yearRange.to);
      const itemTopics = (item.dataset.topicIds || "").split("|").filter(Boolean);
      const matchesTopic = !selectedTopic || itemTopics.includes(selectedTopic);
      const matchesOtherFilters = matchesView && matchesQuery && matchesYear;
      const show = matchesOtherFilters && matchesTopic;

      if (matchesOtherFilters) {
        availableAcrossTopics += 1;
        itemTopics.forEach(function (topicId) {
          topicCounts[topicId] = (topicCounts[topicId] || 0) + 1;
        });
      }

      item.hidden = !show;
      if (show) visible += 1;
    });

    if (topic) {
      Array.from(topic.options).forEach(function (option) {
        const label = option.dataset.label || option.textContent.replace(/\s+\(\d+\)$/, "");
        const available = option.value ? (topicCounts[option.value] || 0) : availableAcrossTopics;
        option.dataset.label = label;
        option.textContent = label + " (" + available + ")";
      });
    }

    if (count) {
      count.textContent =
        "Showing " + visible + " of " + publications.length +
        (publications.length === 1 ? " publication" : " publications");
    }
    if (empty) empty.hidden = visible !== 0;
  }


  [search, topic].filter(Boolean).forEach(function (control) {
    control.addEventListener(control.tagName === "INPUT" ? "input" : "change", function () {
      applyFilters();
    });
  });
  [yearFrom, yearTo].filter(Boolean).forEach(function (control) {
    ["input", "change"].forEach(function (eventName) {
      control.addEventListener(eventName, function () {
        applyFilters(control);
      });
    });
  });
  viewControls.forEach(function (control) {
    control.addEventListener("change", function () {
      applyFilters();
    });
  });
  window.addEventListener("pageshow", function () {
    applyFilters();
  });
  applyFilters();
  if (filterForm) {
    filterForm.hidden = false;
    filterForm.addEventListener("reset", function () {
      window.setTimeout(function () { applyFilters(); }, 0);
    });
  }
})();
