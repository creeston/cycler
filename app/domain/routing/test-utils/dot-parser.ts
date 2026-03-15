export interface ParsedEdge {
  from: string
  to: string
  attrs: Record<string, string>
}

export interface ParsedDotGraph {
  name: string
  graphAttrs: Record<string, string>
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
 *     NODE1 -- NODE2 [key=value, ...]
 *   }
 */
export function parseDot(content: string): ParsedDotGraph {
  const cleaned = content.replace(/\/\/[^\n]*/g, '')

  const nameMatch = /graph\s+(\w+)\s*\{/.exec(cleaned)
  const name = nameMatch?.[1] ?? 'unnamed'

  const graphBlockMatch = /\bgraph\s*\[([\s\S]*?)\]/.exec(cleaned)
  const graphAttrs = graphBlockMatch ? parseAttrBlock(graphBlockMatch[1]) : {}

  // Strip graph attr block and quoted strings before scanning for edge declarations
  const forEdges = cleaned
    .replace(/\bgraph\s*\[([\s\S]*?)\]/g, '')
    .replace(/"[^"]*"/g, '""')

  const edges: ParsedEdge[] = []
  const edgeRe = /\b(\w+)\s*--\s*(\w+)(?:\s*\[([^\]]*)\])?/g
  let m: RegExpExecArray | null
  while ((m = edgeRe.exec(forEdges)) !== null) {
    edges.push({ from: m[1], to: m[2], attrs: m[3] ? parseAttrBlock(m[3]) : {} })
  }

  return { name, graphAttrs, edges }
}
