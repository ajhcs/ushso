export class GraphValidationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'GraphValidationError';
    this.code = code;
    this.details = details;
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalize(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new GraphValidationError('GRAPH_ARRAYS_REQUIRED');
  const nodeIds = nodes.map(node => typeof node === 'string' ? node : node?.id);
  if (nodeIds.some(id => typeof id !== 'string' || id.length === 0)) throw new GraphValidationError('GRAPH_NODE_ID_INVALID');
  const unique = new Set(nodeIds);
  if (unique.size !== nodeIds.length) throw new GraphValidationError('GRAPH_DUPLICATE_NODE');
  const normalizedEdges = edges.map(edge => Array.isArray(edge)
    ? { from: edge[0], to: edge[1] }
    : { from: edge?.from, to: edge?.to });
  for (const edge of normalizedEdges) {
    if (!unique.has(edge.from) || !unique.has(edge.to)) {
      throw new GraphValidationError('GRAPH_EDGE_NODE_MISSING', edge);
    }
  }
  normalizedEdges.sort((left, right) => compareText(left.from, right.from) || compareText(left.to, right.to));
  for (let index = 1; index < normalizedEdges.length; index += 1) {
    if (normalizedEdges[index].from === normalizedEdges[index - 1].from && normalizedEdges[index].to === normalizedEdges[index - 1].to) {
      throw new GraphValidationError('GRAPH_DUPLICATE_EDGE', normalizedEdges[index]);
    }
  }
  return { nodeIds: [...nodeIds].sort(compareText), edges: normalizedEdges };
}

export function findDirectedCycles(nodes, edges) {
  const graph = normalize(nodes, edges);
  const adjacency = new Map(graph.nodeIds.map(id => [id, []]));
  for (const edge of graph.edges) adjacency.get(edge.from).push(edge.to);
  for (const neighbors of adjacency.values()) neighbors.sort(compareText);

  let nextIndex = 0;
  const indices = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];

  function visit(node) {
    indices.set(node, nextIndex);
    low.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const neighbor of adjacency.get(node)) {
      if (!indices.has(neighbor)) {
        visit(neighbor);
        low.set(node, Math.min(low.get(node), low.get(neighbor)));
      } else if (onStack.has(neighbor)) {
        low.set(node, Math.min(low.get(node), indices.get(neighbor)));
      }
    }
    if (low.get(node) !== indices.get(node)) return;
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    component.sort(compareText);
    const selfLoop = component.length === 1 && adjacency.get(component[0]).includes(component[0]);
    if (component.length > 1 || selfLoop) cycles.push(component);
  }

  for (const node of graph.nodeIds) if (!indices.has(node)) visit(node);
  return cycles.sort((left, right) => compareText(left[0], right[0]));
}

export function topologicalSort(nodes, edges) {
  const graph = normalize(nodes, edges);
  const adjacency = new Map(graph.nodeIds.map(id => [id, []]));
  const indegree = new Map(graph.nodeIds.map(id => [id, 0]));
  for (const edge of graph.edges) {
    adjacency.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }
  for (const neighbors of adjacency.values()) neighbors.sort(compareText);
  const ready = graph.nodeIds.filter(id => indegree.get(id) === 0).sort(compareText);
  const order = [];
  while (ready.length > 0) {
    const node = ready.shift();
    order.push(node);
    for (const neighbor of adjacency.get(node)) {
      indegree.set(neighbor, indegree.get(neighbor) - 1);
      if (indegree.get(neighbor) === 0) {
        ready.push(neighbor);
        ready.sort(compareText);
      }
    }
  }
  if (order.length !== graph.nodeIds.length) {
    throw new GraphValidationError('GRAPH_CYCLE', { cycles: findDirectedCycles(nodes, edges) });
  }
  return order;
}

export function assertAcyclic(nodes, edges) {
  return topologicalSort(nodes, edges);
}
