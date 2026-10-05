export type LatexArgument = {
  optional: boolean
  from: number
  to: number
  children: LatexNode[]
}

export type LatexNode =
  | {
      kind: 'text' | 'comment' | 'math'
      from: number
      to: number
      value: string
    }
  | {
      kind: 'group'
      from: number
      to: number
      optional: boolean
      children: LatexNode[]
    }
  | {
      kind: 'command'
      from: number
      to: number
      name: string
      star: boolean
      arguments: LatexArgument[]
    }
  | {
      kind: 'environment'
      from: number
      to: number
      name: string
      arguments: LatexArgument[]
      children: LatexNode[]
      beginEnd: number
      endStart: number
    }
  | {
      kind: 'separator'
      from: number
      to: number
      separator: 'cell' | 'row'
    }

export type LatexSyntaxTree = {
  source: string
  children: LatexNode[]
}

export const nodeSource = (source: string, node: LatexNode) =>
  source.slice(node.from, node.to)

export const nodesSource = (source: string, nodes: LatexNode[]) => {
  if (!nodes.length) return ''
  return source.slice(nodes[0].from, nodes[nodes.length - 1].to)
}

export const isWhitespaceNode = (node: LatexNode) =>
  (node.kind === 'text' && !node.value.trim()) || node.kind === 'comment'

export const trimNodes = (nodes: LatexNode[]) => {
  let from = 0
  let to = nodes.length
  while (from < to && isWhitespaceNode(nodes[from])) from++
  while (to > from && isWhitespaceNode(nodes[to - 1])) to--
  return nodes.slice(from, to)
}
