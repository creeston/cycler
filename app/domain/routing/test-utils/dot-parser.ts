export interface ParsedEdge {
  from: string
  to: string
  attrs: Record<string, string>
}

export interface ParsedDotGraph {
  name: string
  graphAttrs: Record<string, string>
  /** Attributes of every node declared with its own statement, by name. */
  nodes: Record<string, Record<string, string>>
  edges: ParsedEdge[]
}

function parseAttrBlock(block: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|(\S+?)(?=[,\s\]]|$))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3]
  }
  return attrs
}

/**
 * Parses the subset of DOT language used for routing test scenarios:
 *   graph NAME {
 *     graph [key=value, ...]
 *     NODE [key=value, ...]
 *     NODE1 -- NODE2 [key=value, ...]
 *   }
 * The graph attribute block may span lines; node and edge statements are one
 * per line or separated by semicolons.
 */
export function parseDot(content: string): ParsedDotGraph {
  const cleaned = content.replace(/\/\/[^\n]*/g, '')

  const nameMatch = /graph\s+(\w+)\s*\{/.exec(cleaned)
  const name = nameMatch?.[1] ?? 'unnamed'

  const graphBlockMatch = /\bgraph\s*\[([\s\S]*?)\]/.exec(cleaned)
  const graphAttrs = graphBlockMatch ? parseAttrBlock(graphBlockMatch[1]) : {}

  const body = cleaned
    .replace(/\bgraph\s*\[([\s\S]*?)\]/g, '')
    .replace(/graph\s+\w+\s*\{/, '')
    .replace(/\}\s*$/, '')

  const nodes: Record<string, Record<string, string>> = {}
  const edges: ParsedEdge[] = []
  const edgeRe = /^(\w+)\s*--\s*(\w+)(?:\s*\[([^\]]*)\])?$/
  const nodeRe = /^(\w+)\s*(?:\[([^\]]*)\])?$/
  for (const raw of body.split(/[\n;]/)) {
    const statement = raw.trim()
    if (statement === '') continue
    const edge = edgeRe.exec(statement)
    if (edge) {
      edges.push({ from: edge[1], to: edge[2], attrs: edge[3] ? parseAttrBlock(edge[3]) : {} })
      continue
    }
    const node = nodeRe.exec(statement)
    if (node) nodes[node[1]] = node[2] ? parseAttrBlock(node[2]) : {}
  }

  return { name, graphAttrs, nodes, edges }
}
