(function (root) {
  "use strict";

  // Paper vertices are used only for grouping; they never add visible edges.
  // Each paper has total directed weight one in either representation. The
  // sparse cutoff changes runtime, not a paper's contribution to grouping.
  function sharedPublicationGraph(nodes, edges) {
    const papersByNode = new Map();
    nodes.forEach(function (node) {
      const data = node.data || node;
      if (!data.isFocal) papersByNode.set(String(data.id), new Set(data.publicationIds || []));
    });
    edges.forEach(function (edge) {
      const data = edge.data || edge;
      [data.source, data.target].forEach(function (id) {
        const papers = papersByNode.get(String(id));
        if (papers) (data.publicationIds || []).forEach(function (paper) { papers.add(paper); });
      });
    });

    const ids = Array.from(papersByNode.keys()).sort();
    const papers = new Map();
    ids.forEach(function (id, index) {
      papersByNode.get(id).forEach(function (paper) {
        if (!papers.has(paper)) papers.set(paper, []);
        papers.get(paper).push(index);
      });
    });
    const adjacency = ids.map(function () { return new Map(); });
    Array.from(papers.keys()).sort().forEach(function (paper) {
      const members = papers.get(paper);
      if (members.length < 2) return;
      if (members.length <= 40) {
        const weight = 1 / (members.length * (members.length - 1));
        members.forEach(function (source, left) {
          members.slice(left + 1).forEach(function (target) {
            adjacency[source].set(target, (adjacency[source].get(target) || 0) + weight);
            adjacency[target].set(source, (adjacency[target].get(source) || 0) + weight);
          });
        });
        return;
      }
      const paperIndex = adjacency.length;
      const neighbors = new Map();
      const weight = 1 / (2 * members.length);
      members.forEach(function (member) {
        adjacency[member].set(paperIndex, weight);
        neighbors.set(member, weight);
      });
      adjacency.push(neighbors);
    });
    return { ids: ids, adjacency: adjacency };
  }

  function moveCommunities(adjacency) {
    const communities = adjacency.map(function (_, index) { return index; });
    const degrees = adjacency.map(function (neighbors) {
      return Array.from(neighbors.values()).reduce(function (sum, weight) { return sum + weight; }, 0);
    });
    const totals = degrees.slice();
    const totalDegree = degrees.reduce(function (sum, degree) { return sum + degree; }, 0);
    if (!totalDegree) return communities;

    for (let pass = 0; pass < 24; pass += 1) {
      let moved = false;
      adjacency.forEach(function (neighbors, node) {
        const degree = degrees[node];
        if (!degree) return;
        const current = communities[node];
        totals[current] -= degree;
        const weights = new Map();
        neighbors.forEach(function (weight, neighbor) {
          if (neighbor === node) return;
          const community = communities[neighbor];
          weights.set(community, (weights.get(community) || 0) + weight);
        });
        let best = current;
        let bestGain = (weights.get(current) || 0) - degree * totals[current] / totalDegree;
        Array.from(weights.keys()).sort(function (left, right) { return left - right; }).forEach(function (community) {
          const gain = weights.get(community) - degree * totals[community] / totalDegree;
          if (gain > bestGain + 1e-12) {
            best = community;
            bestGain = gain;
          }
        });
        communities[node] = best;
        totals[best] += degree;
        if (best !== current) moved = true;
      });
      if (!moved) break;
    }
    return communities;
  }

  function clusterNetwork(nodes, edges) {
    const graph = sharedPublicationGraph(nodes, edges || []);
    let adjacency = graph.adjacency;
    let members = adjacency.map(function (_, index) { return index < graph.ids.length ? [index] : []; });

    // Bounded sparse modularity moves, followed by aggregation, avoid the
    // all-in-one collapse of unweighted label propagation on connected graphs.
    for (let level = 0; level < 6; level += 1) {
      const communities = moveCommunities(adjacency);
      const labels = Array.from(new Set(communities)).sort(function (left, right) { return left - right; });
      if (labels.length === adjacency.length) break;
      const indices = new Map(labels.map(function (label, index) { return [label, index]; }));
      const nextAdjacency = labels.map(function () { return new Map(); });
      const nextMembers = labels.map(function () { return []; });
      adjacency.forEach(function (neighbors, node) {
        const source = indices.get(communities[node]);
        nextMembers[source].push.apply(nextMembers[source], members[node]);
        neighbors.forEach(function (weight, neighbor) {
          const target = indices.get(communities[neighbor]);
          nextAdjacency[source].set(target, (nextAdjacency[source].get(target) || 0) + weight);
        });
      });
      adjacency = nextAdjacency;
      members = nextMembers;
    }

    return members.filter(function (group) { return group.length; }).map(function (group) {
      return group.map(function (index) { return graph.ids[index]; }).sort();
    }).sort(function (left, right) {
      return right.length - left.length || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
    }).map(function (nodeIds, index) {
      return { id: "cluster-" + (index + 1), nodeIds: nodeIds };
    });
  }

  if (typeof module === "object" && module.exports) module.exports = clusterNetwork;
  else root.FritscheNetworkClusters = clusterNetwork;
})(typeof window === "undefined" ? globalThis : window);
