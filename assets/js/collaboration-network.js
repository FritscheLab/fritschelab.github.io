(function () {
  "use strict";

  const app = document.querySelector("[data-collaboration-app]");
  if (!app) return;

  const ui = {
    graph: app.querySelector("[data-network-graph]"),
    loading: app.querySelector("[data-network-loading]"),
    empty: app.querySelector("[data-network-empty]"),
    error: app.querySelector("[data-network-error]"),
    status: app.querySelector("[data-network-status]"),
    search: app.querySelector("[data-network-search]"),
    yearFrom: app.querySelector("[data-network-year-from]"),
    yearTo: app.querySelector("[data-network-year-to]"),
    strength: app.querySelector("[data-network-strength]"),
    includeLarge: app.querySelector("[data-network-large]"),
    fit: app.querySelector("[data-network-fit]"),
    reset: app.querySelector("[data-network-reset]"),
    detail: app.querySelector("[data-network-detail]"),
    detailTitle: app.querySelector("[data-network-detail-title]"),
    detailBody: app.querySelector("[data-network-detail-body]"),
    directory: app.querySelector("[data-network-directory]"),
    directorySummary: app.querySelector("[data-network-directory-summary]"),
    connections: app.querySelector("[data-network-connections]"),
    connectionsSummary: app.querySelector("[data-network-connections-summary]"),
    viewInputs: Array.from(app.querySelectorAll('input[name="network-view"]')),
    stats: Array.from(app.querySelectorAll("[data-network-stat]"))
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const model = {
    publications: new Map(),
    authorNodes: [],
    keywordNodes: [],
    directionNodes: [],
    coauthorEdges: [],
    yearMin: null,
    yearMax: null,
    focalId: null,
    currentElements: [],
    currentPublicationIds: new Set(),
    currentView: "directions"
  };
  let cy = null;
  let searchTimer = null;
  let layoutSequence = 0;
  let activeLayout = null;
  const DIRECTORY_LIMIT = 250;

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === "") return [];
    return [value];
  }

  function uniqueStrings(values) {
    const seen = new Set();
    return values.reduce(function (result, value) {
      const normalized = String(value || "").trim();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
      return result;
    }, []);
  }

  function keywordKey(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function uniqueKeywords(values) {
    const labels = new Map();
    values.forEach(function (value) {
      const label = String(value || "").trim();
      const key = keywordKey(label);
      if (key && !labels.has(key)) labels.set(key, label);
    });
    return Array.from(labels.values());
  }

  function firstDefined(object, keys, fallback) {
    for (let index = 0; index < keys.length; index += 1) {
      const value = object[keys[index]];
      if (value !== undefined && value !== null) return value;
    }
    return fallback;
  }

  function publicationIds(data) {
    const direct = asArray(firstDefined(data, ["publicationIds", "paperIds", "works"], []));
    const categorized = [
      "standardPublicationIds",
      "largePublicationIds",
      "consortiumPublicationIds",
      "regularPublicationIds"
    ].reduce(function (ids, key) {
      return ids.concat(asArray(data[key]));
    }, []);
    return uniqueStrings(direct.concat(categorized).map(function (value) {
      return typeof value === "object" && value ? value.id : value;
    }));
  }

  function normalizePublication(raw, fallbackId) {
    const id = String(firstDefined(raw, ["id", "publicationId", "key"], fallbackId || "")).trim();
    const doi = String(firstDefined(raw, ["doi", "DOI"], "") || "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    const pmid = String(firstDefined(raw, ["pmid", "PMID"], "") || "");
    const internalUrl = firstDefined(raw, ["internalUrl", "siteUrl"], "");
    const url = firstDefined(raw, ["url", "href"], "") || internalUrl ||
      (doi ? "https://doi.org/" + doi : (pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/" : ""));
    const yearValue = Number(firstDefined(raw, ["year", "publicationYear"], 0));
    const authorCount = Number(firstDefined(raw, ["authorCount", "authorsCount"], 0));
    const directionIds = uniqueStrings(asArray(firstDefined(raw, [
      "directionIds",
      "topicIds",
      "researchDirectionIds"
    ], [])).map(String));
    const keywords = uniqueKeywords(
      asArray(raw.keywords)
        .concat(asArray(raw.matchedKeywords), asArray(raw.tags))
        .map(String)
    );

    return {
      id: id,
      title: String(firstDefined(raw, ["title", "label"], "Untitled publication")),
      year: Number.isFinite(yearValue) ? yearValue : 0,
      venue: String(firstDefined(raw, ["venue", "journal", "source"], "") || ""),
      doi: doi,
      pmid: pmid,
      url: String(url || ""),
      internalUrl: String(internalUrl || ""),
      keyPublication: Boolean(firstDefined(raw, ["keyPublication", "key_publication"], false)),
      authorCount: Number.isFinite(authorCount) ? authorCount : 0,
      isLarge: Boolean(firstDefined(raw, [
        "isLarge",
        "largeCollaboration",
        "isLargeCollaboration",
        "consortiumScale"
      ], authorCount > 50)),
      isConsortium: Boolean(firstDefined(raw, ["isConsortium", "consortium"], false)),
      impliedFocalAuthor: Boolean(firstDefined(raw, ["impliedFocalAuthor"], false)),
      directionIds: directionIds,
      keywords: keywords
    };
  }

  function normalizeNode(raw) {
    const data = Object.assign({}, raw.data || raw);
    const rawType = String(firstDefined(data, ["type", "kind", "nodeType"], "author")).toLowerCase();
    const type = rawType === "keyword" ? "keyword" :
      (["direction", "topic", "research-direction"].includes(rawType) ? "direction" : "author");
    const id = String(data.id || "");
    const labStatusRaw = String(firstDefined(data, ["labStatus", "memberStatus"], "external")).toLowerCase();
    const labStatus = labStatusRaw === "current" || labStatusRaw === "former" ? labStatusRaw : "external";
    return {
      data: Object.assign({}, data, {
        id: id,
        label: String(firstDefined(data, ["label", "name", "title"], id)),
        type: type,
        labStatus: type === "author" ? labStatus : type,
        isFocal: Boolean(firstDefined(data, ["isFocal", "focal"], false)),
        publicationIds: publicationIds(data),
        keywords: uniqueKeywords(
          asArray(data.keywords)
            .concat(asArray(data.terms), asArray(data.matchedKeywords))
            .map(String)
        ),
        description: String(firstDefined(data, ["description", "summary"], "") || ""),
        url: String(firstDefined(data, ["url", "profileUrl"], "") || "")
      })
    };
  }

  function normalizeEdge(raw, index) {
    const data = Object.assign({}, raw.data || raw);
    return {
      data: Object.assign({}, data, {
        id: String(data.id || "coauthor-" + index),
        source: String(firstDefined(data, ["source", "sourceId"], "")),
        target: String(firstDefined(data, ["target", "targetId"], "")),
        type: "coauthor",
        publicationIds: publicationIds(data)
      })
    };
  }

  function rawCollection(value) {
    if (Array.isArray(value)) return value.map(function (item) { return [null, item]; });
    if (!value || typeof value !== "object") return [];
    return Object.keys(value).map(function (key) { return [key, value[key]]; });
  }

  function normalizePayload(payload) {
    const rawElements = payload.elements || {};
    const rawNodes = asArray(rawElements.nodes || payload.nodes);
    const rawEdges = asArray(rawElements.edges || payload.edges);
    const rawPublications = payload.publications || (payload.meta && payload.meta.publications) || [];

    rawCollection(rawPublications).forEach(function (entry) {
      const publication = normalizePublication(entry[1] || {}, entry[0]);
      if (publication.id) model.publications.set(publication.id, publication);
    });

    const normalizedNodes = rawNodes.map(normalizeNode).filter(function (node) {
      return node.data.id;
    });
    model.authorNodes = normalizedNodes.filter(function (node) { return node.data.type === "author"; });
    model.directionNodes = normalizedNodes.filter(function (node) { return node.data.type === "direction"; });
    model.coauthorEdges = rawEdges.map(normalizeEdge).filter(function (edge) {
      return edge.data.source && edge.data.target;
    });

    const topicContainer = payload.directions || payload.researchDirections || payload.topics ||
      (payload.meta && (payload.meta.directions || payload.meta.researchDirections || payload.meta.topics)) || [];
    const rawDirections = topicContainer && !Array.isArray(topicContainer) && topicContainer.nodes ?
      topicContainer.nodes : topicContainer;
    const existingDirectionIds = new Set(model.directionNodes.map(function (node) { return node.data.id; }));
    rawCollection(rawDirections).forEach(function (entry) {
      const definition = Object.assign({}, (entry[1] && entry[1].data) || entry[1] || {});
      const canonicalId = String(firstDefined(definition, ["id", "key"], entry[0] || ""));
      if (!canonicalId) return;
      const graphId = String(firstDefined(definition, ["nodeId"], "direction:" + canonicalId));
      if (existingDirectionIds.has(graphId)) return;
      const node = normalizeNode({
        id: graphId,
        canonicalId: canonicalId,
        label: firstDefined(definition, ["label", "title", "name"], canonicalId),
        type: "direction",
        description: firstDefined(definition, ["description", "summary"], ""),
        keywords: asArray(definition.keywords)
          .concat(asArray(definition.terms), asArray(definition.patterns), asArray(definition.matchedKeywords)),
        publicationIds: firstDefined(definition, ["publicationIds", "paperIds"], []),
        url: definition.url || "",
        color: definition.color || ""
      });
      model.directionNodes.push(node);
      existingDirectionIds.add(graphId);
    });

    const directionByCanonicalId = new Map();
    model.directionNodes.forEach(function (node) {
      const canonicalId = String(node.data.canonicalId || node.data.directionId || node.data.id.replace(/^direction:/, ""));
      directionByCanonicalId.set(canonicalId, node);
      directionByCanonicalId.set(node.data.id, node);
    });

    model.publications.forEach(function (publication) {
      publication.directionIds = publication.directionIds.map(function (id) {
        const node = directionByCanonicalId.get(id);
        return node ? node.data.id : id;
      }).filter(function (id) { return existingDirectionIds.has(id); });
      publication.directionIds.forEach(function (id) {
        const direction = directionByCanonicalId.get(id);
        if (direction && !direction.data.publicationIds.includes(publication.id)) {
          direction.data.publicationIds.push(publication.id);
        }
      });
    });

    model.directionNodes.forEach(function (node) {
      node.data.publicationIds = uniqueStrings(node.data.publicationIds);
    });

    const keywords = new Map();
    model.publications.forEach(function (publication) {
      publication.keywords.forEach(function (label) {
        const key = keywordKey(label);
        if (!key) return;
        const id = "keyword:" + key.replace(/\s+/g, "-");
        if (!keywords.has(key)) {
          keywords.set(key, normalizeNode({
            id: id,
            label: label,
            type: "keyword",
            description: "This keyword comes from a publication tag or from a curated term matched to a paper’s title or tags.",
            publicationIds: []
          }));
        }
        keywords.get(key).data.publicationIds.push(publication.id);
      });
    });
    model.keywordNodes = Array.from(keywords.values()).map(function (node) {
      node.data.publicationIds = uniqueStrings(node.data.publicationIds);
      return node;
    });

    const nodePublicationSets = new Map(model.authorNodes.map(function (node) {
      return [node.data.id, new Set(node.data.publicationIds)];
    }));
    model.coauthorEdges.forEach(function (edge) {
      edge.data.publicationIds.forEach(function (id) {
        if (nodePublicationSets.has(edge.data.source)) nodePublicationSets.get(edge.data.source).add(id);
        if (nodePublicationSets.has(edge.data.target)) nodePublicationSets.get(edge.data.target).add(id);
      });
    });
    model.authorNodes.forEach(function (node) {
      node.data.publicationIds = Array.from(nodePublicationSets.get(node.data.id) || []);
      if (node.data.isFocal) model.focalId = node.data.id;
    });

    if (!model.focalId) {
      const likelyFocal = model.authorNodes.find(function (node) {
        return /fritsche/i.test(node.data.label);
      });
      if (likelyFocal) {
        likelyFocal.data.isFocal = true;
        model.focalId = likelyFocal.data.id;
      }
    }

    const years = Array.from(model.publications.values()).map(function (publication) {
      return publication.year;
    }).filter(function (year) { return year > 0; });
    model.yearMin = years.length ? Math.min.apply(null, years) : new Date().getFullYear();
    model.yearMax = years.length ? Math.max.apply(null, years) : model.yearMin;
  }

  function setStats() {
    const values = {
      publications: model.publications.size.toLocaleString(),
      collaborators: Math.max(0, model.authorNodes.length - (model.focalId ? 1 : 0)).toLocaleString(),
      keywords: model.keywordNodes.length.toLocaleString(),
      directions: model.directionNodes.length.toLocaleString(),
      years: model.yearMin === model.yearMax ? String(model.yearMin) : model.yearMin + "–" + model.yearMax
    };
    ui.stats.forEach(function (stat) {
      stat.textContent = values[stat.dataset.networkStat] || "—";
    });
  }

  function defaultYearFrom() {
    const configuredYear = Number(app.dataset.defaultYearFrom);
    if (!Number.isFinite(configuredYear)) return model.yearMin;
    return Math.max(model.yearMin, Math.min(configuredYear, model.yearMax));
  }

  function populateYears() {
    [ui.yearFrom, ui.yearTo].forEach(function (select) {
      select.replaceChildren();
      for (let year = model.yearMin; year <= model.yearMax; year += 1) {
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        select.appendChild(option);
      }
    });
    ui.yearFrom.value = String(defaultYearFrom());
    ui.yearTo.value = String(model.yearMax);
  }

  function currentFilters() {
    const selectedView = ui.viewInputs.find(function (input) { return input.checked; });
    return {
      view: selectedView ? selectedView.value : "directions",
      query: ui.search.value.trim().toLocaleLowerCase(),
      yearFrom: Number(ui.yearFrom.value || model.yearMin),
      yearTo: Number(ui.yearTo.value || model.yearMax),
      strength: Number(ui.strength.value || 2),
      includeLarge: ui.includeLarge.checked
    };
  }

  function eligiblePublications(filters) {
    const ids = new Set();
    model.publications.forEach(function (publication) {
      if (publication.year < filters.yearFrom || publication.year > filters.yearTo) return;
      if (!filters.includeLarge && publication.isLarge) return;
      ids.add(publication.id);
    });
    return ids;
  }

  function filteredIds(ids, eligible) {
    return uniqueStrings(ids).filter(function (id) { return eligible.has(id); });
  }

  function yearsFor(ids) {
    const years = ids.map(function (id) {
      const publication = model.publications.get(id);
      return publication ? publication.year : 0;
    }).filter(function (year) { return year > 0; });
    if (!years.length) return "—";
    const minimum = Math.min.apply(null, years);
    const maximum = Math.max.apply(null, years);
    return minimum === maximum ? String(minimum) : minimum + "–" + maximum;
  }

  function graphNode(source, ids) {
    return {
      group: "nodes",
      data: Object.assign({}, source.data, {
        publicationIds: ids,
        filteredPublicationCount: ids.length,
        years: yearsFor(ids)
      })
    };
  }

  function focalGraphNode(eligible) {
    const source = model.authorNodes.find(function (node) { return node.data.id === model.focalId; });
    if (!source) return null;
    const node = graphNode(source, filteredIds(source.data.publicationIds, eligible));
    node.data.label = "Fritsche Lab / Lars Fritsche";
    node.data.description = "This marker represents Lars Fritsche on papers that list him as an author. For consortium papers that do not name Lars individually, it shows the paper’s link to the lab; those papers are labeled.";
    node.data.isFocal = true;
    node.data.isLabAnchor = true;
    node.data.logoUrl = app.dataset.logoUrl || "";
    return node;
  }

  function graphEdge(id, type, source, target, ids) {
    return {
      group: "edges",
      data: {
        id: id,
        type: type,
        source: source,
        target: target,
        publicationIds: ids,
        filteredPublicationCount: ids.length,
        years: yearsFor(ids)
      }
    };
  }

  function peopleElements(filters, eligible) {
    const authorById = new Map(model.authorNodes.map(function (node) { return [node.data.id, node]; }));
    const visibleIds = new Set();
    const edges = [];

    model.coauthorEdges.forEach(function (edge, index) {
      const ids = filteredIds(edge.data.publicationIds, eligible);
      if (ids.length < filters.strength) return;
      visibleIds.add(edge.data.source);
      visibleIds.add(edge.data.target);
      edges.push(graphEdge("people:" + (edge.data.id || index), "coauthor", edge.data.source, edge.data.target, ids));
    });

    let nodes = Array.from(visibleIds).map(function (id) {
      const source = authorById.get(id);
      if (!source) return null;
      return id === model.focalId ? focalGraphNode(eligible) :
        graphNode(source, filteredIds(source.data.publicationIds, eligible));
    }).filter(Boolean);

    const anchor = focalGraphNode(eligible);
    if (anchor && !nodes.some(function (node) { return node.data.id === model.focalId; })) nodes.unshift(anchor);

    return applyQuery(nodes, edges, filters.query);
  }

  function directionElements(filters, eligible) {
    let nodes = model.directionNodes.map(function (source) {
      const ids = filteredIds(source.data.publicationIds, eligible);
      return ids.length >= filters.strength ? graphNode(source, ids) : null;
    }).filter(Boolean);
    const edges = [];

    for (let left = 0; left < nodes.length; left += 1) {
      const leftIds = new Set(nodes[left].data.publicationIds);
      for (let right = left + 1; right < nodes.length; right += 1) {
        const shared = nodes[right].data.publicationIds.filter(function (id) { return leftIds.has(id); });
        if (shared.length >= filters.strength) {
          edges.push(graphEdge(
            "directions:" + nodes[left].data.id + ":" + nodes[right].data.id,
            "direction-link",
            nodes[left].data.id,
            nodes[right].data.id,
            shared
          ));
        }
      }
    }

    const anchor = focalGraphNode(eligible);
    if (anchor) {
      nodes.forEach(function (direction) {
        edges.push(graphEdge(
          "lab-direction:" + direction.data.id,
          "lab-direction",
          anchor.data.id,
          direction.data.id,
          direction.data.publicationIds
        ));
      });
      nodes.unshift(anchor);
    }

    return applyQuery(nodes, edges, filters.query);
  }

  function keywordElements(filters, eligible) {
    let nodes = model.keywordNodes.map(function (source) {
      const ids = filteredIds(source.data.publicationIds, eligible);
      return ids.length >= filters.strength ? graphNode(source, ids) : null;
    }).filter(Boolean);
    const edges = [];

    for (let left = 0; left < nodes.length; left += 1) {
      const leftIds = new Set(nodes[left].data.publicationIds);
      for (let right = left + 1; right < nodes.length; right += 1) {
        const shared = nodes[right].data.publicationIds.filter(function (id) { return leftIds.has(id); });
        if (shared.length >= filters.strength) {
          edges.push(graphEdge(
            "keywords:" + nodes[left].data.id + ":" + nodes[right].data.id,
            "keyword-link",
            nodes[left].data.id,
            nodes[right].data.id,
            shared
          ));
        }
      }
    }

    const anchor = focalGraphNode(eligible);
    if (anchor) {
      nodes.forEach(function (keyword) {
        edges.push(graphEdge(
          "lab-keyword:" + keyword.data.id,
          "lab-keyword",
          anchor.data.id,
          keyword.data.id,
          keyword.data.publicationIds
        ));
      });
      nodes.unshift(anchor);
    }

    return applyQuery(nodes, edges, filters.query);
  }

  function combinedElements(filters, eligible) {
    const authorNodes = model.authorNodes.map(function (source) {
      const ids = filteredIds(source.data.publicationIds, eligible);
      if (source.data.id === model.focalId) return focalGraphNode(eligible);
      return ids.length ? graphNode(source, ids) : null;
    }).filter(Boolean);
    const directionNodes = model.directionNodes.map(function (source) {
      const ids = filteredIds(source.data.publicationIds, eligible);
      return ids.length ? graphNode(source, ids) : null;
    }).filter(Boolean);
    const edges = [];
    const visibleIds = new Set();

    authorNodes.forEach(function (author) {
      const authorIds = new Set(author.data.publicationIds);
      directionNodes.forEach(function (direction) {
        const shared = direction.data.publicationIds.filter(function (id) { return authorIds.has(id); });
        if (shared.length < filters.strength) return;
        visibleIds.add(author.data.id);
        visibleIds.add(direction.data.id);
        edges.push(graphEdge(
          "combined:" + author.data.id + ":" + direction.data.id,
          "author-direction",
          author.data.id,
          direction.data.id,
          shared
        ));
      });
    });

    const nodes = authorNodes.concat(directionNodes).filter(function (node) {
      return visibleIds.has(node.data.id);
    });
    const anchor = focalGraphNode(eligible);
    if (anchor && !nodes.some(function (node) { return node.data.id === model.focalId; })) nodes.unshift(anchor);
    return applyQuery(nodes, edges, filters.query);
  }

  function nodeMatchesQuery(node, query) {
    const directText = [node.data.label, node.data.description]
      .concat(node.data.keywords || [])
      .join(" ")
      .toLocaleLowerCase();
    if (directText.includes(query)) return true;
    if (node.data.isFocal) return false;

    return (node.data.publicationIds || []).some(function (id) {
      const publication = model.publications.get(id);
      if (!publication) return false;
      return [publication.title, publication.venue, publication.doi, publication.pmid]
        .concat(publication.keywords || [])
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    });
  }

  function applyQuery(nodes, edges, query) {
    const matchingNodes = query ? nodes.filter(function (node) {
      return nodeMatchesQuery(node, query);
    }) : nodes;
    let publicationNodes = matchingNodes;
    if (!query && matchingNodes.some(function (node) { return !node.data.isFocal; })) {
      publicationNodes = matchingNodes.filter(function (node) { return !node.data.isFocal; });
    }
    const supportingPublicationIds = uniqueStrings(publicationNodes.reduce(function (ids, node) {
      return ids.concat(node.data.publicationIds || []);
    }, []));

    if (!query) {
      return { nodes: nodes, edges: edges, publicationIds: supportingPublicationIds };
    }

    const matches = new Set(matchingNodes.map(function (node) { return node.data.id; }));
    const anchor = nodes.find(function (node) { return node.data.isFocal; });

    if (!matches.size) {
      return {
        nodes: anchor ? [anchor] : [],
        edges: [],
        publicationIds: []
      };
    }
    const visible = new Set(matches);
    if (anchor) visible.add(anchor.data.id);
    edges.forEach(function (edge) {
      if (matches.has(edge.data.source) || matches.has(edge.data.target)) {
        visible.add(edge.data.source);
        visible.add(edge.data.target);
      }
    });
    return {
      nodes: nodes.filter(function (node) { return visible.has(node.data.id); }),
      edges: edges.filter(function (edge) {
        return visible.has(edge.data.source) && visible.has(edge.data.target) &&
          (matches.has(edge.data.source) || matches.has(edge.data.target));
      }),
      publicationIds: supportingPublicationIds
    };
  }

  function graphStyles(maxNodeCount, maxEdgeCount) {
    const safeNodeMaximum = Math.max(2, maxNodeCount);
    const safeEdgeMaximum = Math.max(2, maxEdgeCount);
    const anchorSize = window.matchMedia("(max-width: 720px)").matches ? 76 : 62;
    const siteTheme = window.getComputedStyle(app);
    const themeColor = function (property, fallback) {
      return siteTheme.getPropertyValue(property).trim() || fallback;
    };
    const colors = {
      blue: themeColor("--blue", "#346aa0"),
      ink: themeColor("--ink", "#17212b"),
      maize: themeColor("--maize", "#ffcb05"),
      navy: themeColor("--brand-navy", "#00274c"),
      purple: themeColor("--purple", "#6c5b9d"),
      rust: themeColor("--rust", "#9c4f2f"),
      teal: themeColor("--teal", "#006f78"),
      labelBackground: themeColor("--network-label-background", "#ffffff"),
      directionText: themeColor("--network-direction-text", "#312654"),
      directionBackground: themeColor("--network-direction-background", "#f3effa"),
      keywordText: themeColor("--network-keyword-text", "#71351f"),
      keywordBackground: themeColor("--network-keyword-background", "#fff4ef"),
      keywordBorder: themeColor("--network-keyword-border", "#f4d4c7")
    };
    return [
      {
        selector: "node",
        style: {
          "background-color": colors.blue,
          "border-color": colors.labelBackground,
          "border-width": 2,
          "color": colors.ink,
          "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
          "font-size": 10,
          "font-weight": 650,
          "height": "mapData(filteredPublicationCount, 1, " + safeNodeMaximum + ", 18, 58)",
          "label": "data(label)",
          "min-zoomed-font-size": 8,
          "overlay-opacity": 0,
          "text-background-color": colors.labelBackground,
          "text-background-opacity": 0.86,
          "text-background-padding": 2,
          "text-max-width": 118,
          "text-margin-y": 7,
          "text-valign": "bottom",
          "text-wrap": "wrap",
          "width": "mapData(filteredPublicationCount, 1, " + safeNodeMaximum + ", 18, 58)"
        }
      },
      {
        selector: "node[?isFocal]",
        style: {
          "background-color": colors.navy,
          "background-fit": "cover",
          "background-height": "100%",
          "background-image": "data(logoUrl)",
          "background-image-opacity": 1,
          "background-position-x": "50%",
          "background-position-y": "50%",
          "background-width": "100%",
          "border-color": colors.maize,
          "border-width": 3,
          "color": colors.ink,
          "font-size": 11,
          "font-weight": 800,
          "height": anchorSize,
          "shape": "round-rectangle",
          "width": anchorSize
        }
      },
      {
        selector: 'node[type = "direction"]',
        style: {
          "background-color": colors.purple,
          "border-color": colors.labelBackground,
          "border-width": 3,
          "color": colors.directionText,
          "font-size": 11,
          "font-weight": 750,
          "shape": "round-rectangle",
          "text-background-color": colors.directionBackground
        }
      },
      {
        selector: 'node[type = "keyword"]',
        style: {
          "background-color": colors.rust,
          "border-color": colors.keywordBorder,
          "border-width": 3,
          "color": colors.keywordText,
          "font-size": 10,
          "font-weight": 700,
          "shape": "hexagon",
          "text-background-color": colors.keywordBackground
        }
      },
      {
        selector: "edge",
        style: {
          "curve-style": "haystack",
          "haystack-radius": 0.55,
          "line-color": colors.blue,
          "line-opacity": 0.34,
          "overlay-opacity": 0,
          "width": "mapData(filteredPublicationCount, 1, " + safeEdgeMaximum + ", 1, 8)"
        }
      },
      {
        selector: 'edge[type = "direction-link"]',
        style: { "line-color": colors.purple, "line-opacity": 0.56, "curve-style": "bezier" }
      },
      {
        selector: 'edge[type = "keyword-link"]',
        style: { "line-color": colors.rust, "line-opacity": 0.5, "curve-style": "bezier" }
      },
      {
        selector: 'edge[type = "lab-direction"]',
        style: { "line-color": colors.blue, "line-opacity": 0.38, "curve-style": "bezier" }
      },
      {
        selector: 'edge[type = "lab-keyword"]',
        style: { "line-color": colors.rust, "line-opacity": 0.3, "curve-style": "bezier" }
      },
      {
        selector: 'edge[type = "author-direction"]',
        style: { "line-color": colors.teal, "line-opacity": 0.46, "curve-style": "bezier" }
      },
      {
        selector: ":selected",
        style: { "border-color": colors.rust, "border-width": 5, "line-color": colors.rust, "line-opacity": 1 }
      },
      {
        selector: ".is-muted",
        style: { "opacity": 0.13, "text-opacity": 0 }
      },
      {
        selector: ".is-neighbor",
        style: { "line-opacity": 0.95, "z-index": 10 }
      }
    ];
  }

  function refreshGraphStyles() {
    if (!cy) return;
    const maximumNodeCount = Math.max.apply(null, cy.nodes().map(function (node) {
      return node.data("filteredPublicationCount") || 1;
    }).concat([1]));
    const maximumEdgeCount = Math.max.apply(null, cy.edges().map(function (edge) {
      return edge.data("filteredPublicationCount") || 1;
    }).concat([1]));
    cy.style().fromJson(graphStyles(maximumNodeCount, maximumEdgeCount)).update();
  }

  function initializeGraph() {
    cy = window.cytoscape({
      container: ui.graph,
      elements: [],
      layout: { name: "preset" },
      style: graphStyles(10, 10),
      minZoom: 0.16,
      maxZoom: 3.5,
      wheelSensitivity: 0.22,
      boxSelectionEnabled: false,
      selectionType: "single"
    });

    cy.on("tap", "node, edge", function (event) {
      selectElement(event.target);
    });
    cy.on("tap", function (event) {
      if (event.target === cy) clearSelection();
    });
    cy.on("mouseover", "node", function (event) {
      highlightNeighborhood(event.target);
    });
    cy.on("mouseout", "node", function () {
      restoreHighlight();
    });
    window.addEventListener("themechange", refreshGraphStyles);

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(function () {
        cy.resize();
      });
      observer.observe(ui.graph);
    }
  }

  function highlightNeighborhood(node) {
    if (!cy || cy.$(":selected").length) return;
    cy.elements().addClass("is-muted");
    node.closedNeighborhood().removeClass("is-muted").addClass("is-neighbor");
  }

  function restoreHighlight() {
    if (!cy || cy.$(":selected").length) return;
    cy.elements().removeClass("is-muted is-neighbor");
  }

  function clearSelection() {
    if (!cy) return;
    cy.$(":selected").unselect();
    cy.elements().removeClass("is-muted is-neighbor");
    resetDetail();
  }

  function selectElement(element) {
    if (!cy || !element || !element.length) return;
    cy.$(":selected").unselect();
    element.select();
    cy.elements().removeClass("is-neighbor").addClass("is-muted");
    if (element.isNode()) {
      element.closedNeighborhood().removeClass("is-muted").addClass("is-neighbor");
      showNodeDetail(element.data());
    } else {
      element.removeClass("is-muted").addClass("is-neighbor");
      element.connectedNodes().removeClass("is-muted").addClass("is-neighbor");
      showEdgeDetail(element.data());
    }
  }

  function elementTypeLabel(data) {
    if (data.type === "direction") return "Research direction";
    if (data.type === "keyword") return "Keyword";
    if (data.isFocal) return "Lab marker";
    return "Collaborator";
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function appendPublications(container, ids) {
    const publications = ids.map(function (id) { return model.publications.get(id); }).filter(Boolean)
      .sort(function (left, right) {
        return right.year - left.year || left.title.localeCompare(right.title);
      });
    if (!publications.length) {
      container.appendChild(makeElement("p", "", "No papers match the current filters for this selection."));
      return;
    }

    const heading = makeElement("h4", "", publications.length === 1 ? "Related paper" : "Related papers");
    const list = makeElement("ol", "collaboration-publications");
    publications.forEach(function (publication) {
      const item = makeElement("li");
      const title = publication.url ? makeElement("a", "", publication.title) : makeElement("strong", "", publication.title);
      if (publication.url) {
        title.href = publication.url;
        if ((title.protocol === "https:" || title.protocol === "http:") && title.origin !== window.location.origin) {
          title.target = "_blank";
          title.rel = "noopener noreferrer";
        }
      }
      item.appendChild(title);
      const metadata = [publication.year || "", publication.venue].filter(Boolean).join(" · ");
      if (metadata) item.appendChild(makeElement("span", "collaboration-publication-meta", metadata));
      if (publication.keywords.length) {
        const keywordLine = makeElement("span", "collaboration-publication-keywords", "Keywords: " + publication.keywords.join(", "));
        item.appendChild(keywordLine);
      }
      if (publication.impliedFocalAuthor) {
        item.appendChild(makeElement(
          "span",
          "collaboration-publication-inference",
          "This consortium paper links to the lab but does not name Lars Fritsche in its author list."
        ));
      }
      list.appendChild(item);
    });
    container.appendChild(heading);
    container.appendChild(list);
  }

  function showNodeDetail(data) {
    ui.detailTitle.textContent = data.label;
    const body = document.createDocumentFragment();
    body.appendChild(makeElement("p", "collaboration-detail__type", elementTypeLabel(data)));
    if (data.description) body.appendChild(makeElement("p", "", data.description));
    const summary = makeElement("dl", "collaboration-detail__summary");
    const count = makeElement("div");
    count.appendChild(makeElement("dt", "", "Papers in view"));
    count.appendChild(makeElement("dd", "", String(data.filteredPublicationCount || data.publicationIds.length)));
    const years = makeElement("div");
    years.appendChild(makeElement("dt", "", "Years"));
    years.appendChild(makeElement("dd", "", data.years || yearsFor(data.publicationIds)));
    summary.appendChild(count);
    summary.appendChild(years);
    body.appendChild(summary);
    if (data.keywords && data.keywords.length) {
      body.appendChild(makeElement("h4", "", "Keywords"));
      const keywords = makeElement("ul", "collaboration-keywords");
      data.keywords.forEach(function (keyword) { keywords.appendChild(makeElement("li", "", keyword)); });
      body.appendChild(keywords);
    }
    if (data.url) {
      const profile = makeElement("p", "");
      const link = makeElement("a", "", data.type === "direction" ? "Explore this research direction" : "Open profile");
      link.href = data.url;
      profile.appendChild(link);
      body.appendChild(profile);
    }
    const publicationContainer = makeElement("div");
    appendPublications(publicationContainer, data.publicationIds || []);
    body.appendChild(publicationContainer);
    ui.detailBody.replaceChildren(body);
    ui.detail.scrollTop = 0;
  }

  function currentNodeData(id) {
    const element = model.currentElements.find(function (candidate) {
      return candidate.group === "nodes" && candidate.data.id === id;
    });
    return element ? element.data : null;
  }

  function showEdgeDetail(data) {
    const source = currentNodeData(data.source);
    const target = currentNodeData(data.target);
    if (!source || !target) return;
    ui.detailTitle.textContent = source.label + " + " + target.label;
    const body = document.createDocumentFragment();
    const connectionLabels = {
      "coauthor": "Co-authorship",
      "keyword-link": "Papers with both keywords",
      "lab-keyword": "Papers linked to this keyword",
      "lab-direction": "Papers in this research direction",
      "direction-link": "Papers in both research directions",
      "author-direction": "This collaborator’s papers in this research direction"
    };
    const count = data.publicationIds ? data.publicationIds.length : data.filteredPublicationCount;
    const inferredCount = (data.publicationIds || []).filter(function (id) {
      const publication = model.publications.get(id);
      return publication && publication.impliedFocalAuthor;
    }).length;
    let connectionLabel = connectionLabels[data.type] || "Shared papers";
    if (data.type === "author-direction" && (data.source === model.focalId || data.target === model.focalId)) {
      connectionLabel = "Papers in this research direction";
    }
    if (data.type === "coauthor" && inferredCount && (data.source === model.focalId || data.target === model.focalId)) {
      connectionLabel = inferredCount === count ?
        (count === 1 ? "Consortium-linked paper" : "Consortium-linked papers") :
        "Co-authored and consortium-linked papers";
    }
    body.appendChild(makeElement("p", "collaboration-detail__type", connectionLabel));
    body.appendChild(makeElement(
      "p",
      "",
      count === 1 ?
        "One paper connects these items under the current filters." :
        count + " papers connect these items under the current filters."
    ));
    if (inferredCount && data.type === "coauthor" && (data.source === model.focalId || data.target === model.focalId)) {
      let inferenceText;
      if (count === 1) {
        inferenceText = "This consortium paper links to the lab but does not name Lars Fritsche in its author list.";
      } else if (inferredCount === 1) {
        inferenceText = "One of these papers is a consortium paper linked to the lab that does not name Lars Fritsche in its author list.";
      } else {
        inferenceText = inferredCount + " of these papers are consortium papers linked to the lab that do not name Lars Fritsche in their author lists.";
      }
      body.appendChild(makeElement(
        "p",
        "collaboration-detail__inference",
        inferenceText
      ));
    }
    const publicationContainer = makeElement("div");
    appendPublications(publicationContainer, data.publicationIds || []);
    body.appendChild(publicationContainer);
    ui.detailBody.replaceChildren(body);
    ui.detail.scrollTop = 0;
  }

  function resetDetail() {
    const hasTopicsOrCollaborators = model.currentElements.some(function (element) {
      return element.group === "nodes" && !element.data.isFocal;
    });
    if (!hasTopicsOrCollaborators) {
      ui.detailTitle.textContent = "No matches in this view";
      ui.detailBody.replaceChildren(makeElement(
        "p",
        "",
        "Try another search term, widen the year range, lower the minimum number of papers, or include papers with large author lists. The lab marker remains available for context."
      ));
      ui.detail.scrollTop = 0;
      return;
    }
    const prompts = {
      directions: {
        title: "Choose a research direction",
        body: "Select a research direction to see its keywords and papers. Select a line between two directions to see the papers they share."
      },
      keywords: {
        title: "Choose a keyword",
        body: "Select a keyword to see its papers. Select a line between two keywords to see where they appear together."
      },
      people: {
        title: "Choose a collaborator",
        body: "Select a collaborator to see their papers. Select a line to see the papers behind that connection."
      },
      combined: {
        title: "Choose a collaborator or direction",
        body: "Select a collaborator or research direction to see related papers and keywords. Select a line to see the papers that connect them."
      }
    };
    const prompt = prompts[model.currentView] || prompts.directions;
    ui.detailTitle.textContent = prompt.title;
    ui.detailBody.replaceChildren(makeElement("p", "", prompt.body));
    ui.detail.scrollTop = 0;
  }

  function paginateDirectory(entries, tableBody, summary, label, renderRow) {
    let offset = 0;
    const status = makeElement("span");
    status.setAttribute("role", "status");
    const previous = makeElement("button", "collaboration-directory__button", "Previous");
    const next = makeElement("button", "collaboration-directory__button", "Next");
    previous.type = next.type = "button";
    previous.setAttribute("aria-label", "Previous " + label);
    next.setAttribute("aria-label", "Next " + label);
    summary.replaceChildren(status);
    if (entries.length > DIRECTORY_LIMIT) {
      const controls = makeElement("span", "collaboration-pagination");
      controls.append(previous, " ", next);
      summary.append(" ", controls);
    }

    function renderPage() {
      const focusedControl = document.activeElement;
      const end = Math.min(offset + DIRECTORY_LIMIT, entries.length);
      const fragment = document.createDocumentFragment();
      entries.slice(offset, end).forEach(function (entry) {
        fragment.appendChild(renderRow(entry));
      });
      tableBody.replaceChildren(fragment);
      status.textContent = entries.length > DIRECTORY_LIMIT ?
        "Showing " + (offset + 1).toLocaleString() + "–" + end.toLocaleString() +
          " of " + entries.length.toLocaleString() + " entries." :
        entries.length.toLocaleString() + (entries.length === 1 ? " entry." : " entries.");
      previous.disabled = offset === 0;
      next.disabled = end >= entries.length;
      const wrapper = tableBody.closest(".collaboration-table-wrap");
      if (wrapper) {
        wrapper.scrollTop = 0;
        wrapper.scrollLeft = 0;
      }
      if (focusedControl === next && next.disabled) previous.focus();
      else if (focusedControl === previous && previous.disabled) next.focus();
    }

    previous.addEventListener("click", function () {
      offset = Math.max(0, offset - DIRECTORY_LIMIT);
      renderPage();
    });
    next.addEventListener("click", function () {
      offset += DIRECTORY_LIMIT;
      renderPage();
    });
    renderPage();
  }

  function updateDirectory(nodes) {
    const sortedNodes = nodes.slice().sort(function (left, right) {
      return right.data.filteredPublicationCount - left.data.filteredPublicationCount ||
        left.data.label.localeCompare(right.data.label);
    });
    paginateDirectory(sortedNodes, ui.directory, ui.directorySummary, "collaborators and topics", function (node) {
      const row = document.createElement("tr");
      const nameCell = makeElement("th", "", node.data.label);
      nameCell.scope = "row";
      const typeCell = makeElement("td", "", elementTypeLabel(node.data));
      const countCell = makeElement("td", "", String(node.data.filteredPublicationCount));
      const yearsCell = makeElement("td", "", node.data.years);
      const actionCell = makeElement("td");
      const button = makeElement("button", "collaboration-directory__button", "View details");
      button.type = "button";
      button.dataset.networkNodeId = node.data.id;
      button.setAttribute("aria-label", "View details for " + node.data.label);
      actionCell.appendChild(button);
      row.appendChild(nameCell);
      row.appendChild(typeCell);
      row.appendChild(countCell);
      row.appendChild(yearsCell);
      row.appendChild(actionCell);
      return row;
    });
  }

  function updateConnectionDirectory(edges, nodes) {
    const nodeLabels = new Map(nodes.map(function (node) {
      return [node.data.id, node.data.label];
    }));
    const sortedEdges = edges.slice().sort(function (left, right) {
      return right.data.filteredPublicationCount - left.data.filteredPublicationCount ||
        String(nodeLabels.get(left.data.source) || "").localeCompare(String(nodeLabels.get(right.data.source) || ""));
    });
    paginateDirectory(sortedEdges, ui.connections, ui.connectionsSummary, "connections", function (edge) {
      const sourceLabel = nodeLabels.get(edge.data.source) || edge.data.source;
      const targetLabel = nodeLabels.get(edge.data.target) || edge.data.target;
      const row = document.createElement("tr");
      const sourceCell = makeElement("th", "", sourceLabel);
      sourceCell.scope = "row";
      const targetCell = makeElement("td", "", targetLabel);
      const countCell = makeElement("td", "", String(edge.data.filteredPublicationCount));
      const yearsCell = makeElement("td", "", edge.data.years);
      const actionCell = makeElement("td");
      const button = makeElement("button", "collaboration-directory__button", "View details");
      button.type = "button";
      button.dataset.networkEdgeId = edge.data.id;
      button.setAttribute("aria-label", "View connection details for " + sourceLabel + " and " + targetLabel);
      actionCell.appendChild(button);
      row.appendChild(sourceCell);
      row.appendChild(targetCell);
      row.appendChild(countCell);
      row.appendChild(yearsCell);
      row.appendChild(actionCell);
      return row;
    });
  }

  function layoutGraph(view) {
    const sequence = ++layoutSequence;
    const nodeCount = cy.nodes().length;
    const animate = !reducedMotion.matches && nodeCount <= 180;
    const thematicView = view === "directions" || view === "keywords";
    const useCose = nodeCount <= (thematicView ? 120 : 220);
    const options = useCose ? {
      name: "cose",
      animate: animate,
      animationDuration: 500,
      fit: true,
      padding: 42,
      randomize: true,
      componentSpacing: 55,
      idealEdgeLength: thematicView ? 120 : 75,
      nodeDimensionsIncludeLabels: true,
      nodeOverlap: 20,
      nodeRepulsion: function () { return thematicView ? 160000 : 65000; }
    } : {
      name: "concentric",
      animate: false,
      fit: true,
      padding: 42,
      minNodeSpacing: 18,
      concentric: function (node) {
        if (node.data("isFocal")) return 100000;
        if (node.data("type") === "direction") return 50000 + node.data("filteredPublicationCount");
        return node.data("filteredPublicationCount");
      },
      levelWidth: function () { return 4; }
    };
    const layout = cy.layout(options);
    activeLayout = layout;
    layout.one("layoutstop", function () {
      if (sequence !== layoutSequence) return;
      activeLayout = null;
      ui.loading.hidden = true;
      ui.graph.classList.add("is-ready");
    });
    layout.run();
  }

  function applyFilters(options) {
    window.clearTimeout(searchTimer);
    const filters = currentFilters();
    if (filters.yearFrom > filters.yearTo) {
      if (options && options.changed === "from") ui.yearTo.value = String(filters.yearFrom);
      else ui.yearFrom.value = String(filters.yearTo);
      return applyFilters();
    }

    const eligible = eligiblePublications(filters);
    let result;
    if (filters.view === "keywords") result = keywordElements(filters, eligible);
    else if (filters.view === "directions") result = directionElements(filters, eligible);
    else if (filters.view === "combined") result = combinedElements(filters, eligible);
    else result = peopleElements(filters, eligible);

    model.currentView = filters.view;
    model.currentElements = result.nodes.concat(result.edges);
    model.currentPublicationIds = new Set(result.publicationIds || []);

    ui.empty.hidden = !cy || result.nodes.length > 0;
    ui.graph.classList.toggle("is-empty", result.nodes.length === 0);
    resetDetail();
    if (cy) {
      layoutSequence += 1;
      if (activeLayout) activeLayout.stop();
      activeLayout = null;
      cy.stop();
      ui.loading.hidden = false;
      cy.elements().remove();
      if (result.nodes.length) {
        cy.add(model.currentElements);
        refreshGraphStyles();
        layoutGraph(filters.view);
      } else {
        ui.loading.hidden = true;
      }
    } else {
      ui.loading.hidden = true;
    }

    updateDirectory(result.nodes);
    updateConnectionDirectory(result.edges, result.nodes);
    const viewLabels = {
      people: ["collaborator", "collaborators"],
      keywords: ["keyword", "keywords"],
      directions: ["research direction", "research directions"]
    };
    const publicationCount = model.currentPublicationIds.size;
    const includesAnchor = result.nodes.some(function (node) { return node.data.isFocal; });
    const contentNodeCount = result.nodes.length - (includesAnchor ? 1 : 0);
    let nodeSummary;
    if (filters.view === "combined") {
      const collaboratorCount = result.nodes.filter(function (node) {
        return node.data.type === "author" && !node.data.isFocal;
      }).length;
      const directionCount = result.nodes.filter(function (node) {
        return node.data.type === "direction";
      }).length;
      nodeSummary = collaboratorCount.toLocaleString() +
        (collaboratorCount === 1 ? " collaborator" : " collaborators") +
        " and " + directionCount.toLocaleString() +
        (directionCount === 1 ? " research direction" : " research directions");
    } else {
      const labels = viewLabels[filters.view];
      nodeSummary = contentNodeCount.toLocaleString() + " " +
        (contentNodeCount === 1 ? labels[0] : labels[1]);
    }
    if (includesAnchor) nodeSummary += " plus Fritsche Lab / Lars Fritsche";
    ui.status.textContent = "Showing " + nodeSummary +
      ", " + result.edges.length.toLocaleString() +
      (result.edges.length === 1 ? " connection, and " : " connections, and ") +
      publicationCount.toLocaleString() +
      (publicationCount === 1 ? " related paper." : " related papers.");
  }

  function resetFilters() {
    ui.viewInputs.forEach(function (input) { input.checked = input.value === "directions"; });
    ui.search.value = "";
    ui.yearFrom.value = String(defaultYearFrom());
    ui.yearTo.value = String(model.yearMax);
    ui.strength.value = "3";
    ui.includeLarge.checked = false;
    applyFilters();
  }

  function wireControls() {
    ui.viewInputs.forEach(function (input) {
      input.addEventListener("change", function () { applyFilters(); });
    });
    ui.yearFrom.addEventListener("change", function () { applyFilters({ changed: "from" }); });
    ui.yearTo.addEventListener("change", function () { applyFilters({ changed: "to" }); });
    ui.strength.addEventListener("change", function () { applyFilters(); });
    ui.includeLarge.addEventListener("change", function () { applyFilters(); });
    ui.search.addEventListener("input", function () {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () { applyFilters(); }, 180);
    });
    ui.fit.addEventListener("click", function () {
      if (cy && cy.elements().length) cy.animate({ fit: { eles: cy.elements(), padding: 42 }, duration: reducedMotion.matches ? 0 : 350 });
    });
    ui.reset.addEventListener("click", resetFilters);
    function activateDirectoryItem(event) {
      const button = event.target.closest("[data-network-node-id], [data-network-edge-id]");
      if (!button) return;
      if (button.dataset.networkNodeId) {
        const data = currentNodeData(button.dataset.networkNodeId);
        if (!data) return;
        if (cy) {
          const node = cy.getElementById(button.dataset.networkNodeId);
          if (node.length) {
            selectElement(node);
            cy.animate({ center: { eles: node }, zoom: Math.max(1, cy.zoom()), duration: reducedMotion.matches ? 0 : 350 });
          }
        } else {
          showNodeDetail(data);
        }
      } else {
        const edgeData = model.currentElements.find(function (candidate) {
          return candidate.group === "edges" && candidate.data.id === button.dataset.networkEdgeId;
        });
        if (!edgeData) return;
        if (cy) {
          const edge = cy.getElementById(button.dataset.networkEdgeId);
          if (edge.length) selectElement(edge);
        } else {
          showEdgeDetail(edgeData.data);
        }
      }
      ui.detail.focus();
    }
    ui.directory.addEventListener("click", activateDirectoryItem);
    ui.connections.addEventListener("click", activateDirectoryItem);
    ui.graph.addEventListener("keydown", function (event) {
      if (event.key === "/") {
        event.preventDefault();
        ui.search.focus();
      } else if (event.key === "Escape") {
        clearSelection();
      }
    });
  }

  function showLoadError(error) {
    ui.loading.hidden = true;
    ui.error.hidden = false;
    ui.error.textContent = "The network could not be loaded. You can still browse the publication list or download the BibTeX file.";
    ui.graph.classList.add("is-empty");
    ui.status.textContent = "The interactive network is unavailable.";
    app.querySelectorAll("[data-network-controls] input, [data-network-controls] select, [data-network-controls] button")
      .forEach(function (control) { control.disabled = true; });
    console.error("Collaboration network failed to load:", error);
  }

  function showCanvasFallback(error) {
    ui.loading.hidden = true;
    ui.empty.hidden = true;
    ui.error.hidden = false;
    ui.graph.classList.add("is-empty");
    ui.fit.disabled = true;
    console.warn("The network canvas is unavailable; showing the tables without the graph.", error || "");
  }

  fetch(app.dataset.networkUrl, { credentials: "same-origin" })
    .then(function (response) {
      if (!response.ok) throw new Error("Network request returned " + response.status);
      return response.json();
    })
    .then(function (payload) {
      normalizePayload(payload);
      if (!model.publications.size || !model.authorNodes.length) {
        throw new Error("Network data contains no publications or authors");
      }
      if (ui.graph && typeof window.cytoscape === "function") {
        try {
          initializeGraph();
        } catch (error) {
          if (cy) cy.destroy();
          cy = null;
          showCanvasFallback(error);
        }
      } else showCanvasFallback();
      populateYears();
      setStats();
      wireControls();
      applyFilters();
    })
    .catch(showLoadError);
})();
