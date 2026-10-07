import type {
  LatexMetadataCommand,
  TableModel,
  TableWrapperEnvironment,
} from '../types'
import { isTableEnvironment, isTableWrapperEnvironment } from './environment'
import { parseLatexSyntax } from './parser'
import type { LatexNode } from './syntax-tree'

export type MetadataSpan = LatexMetadataCommand & {
  from: number
  to: number
}

const argumentSource = (source: string, node: LatexNode) => {
  if (node.kind !== 'command') return ''
  const argument = node.arguments.at(-1)
  return argument ? source.slice(argument.from + 1, argument.to - 1) : ''
}

export const collectMetadataSpans = (
  source: string,
  decode: (value: string) => string | undefined
) => {
  const spans: MetadataSpan[] = []
  const primaryKinds = new Set<string>()
  let sequence = 0
  const visit = (
    nodes: LatexNode[],
    environmentStack: string[],
    groupDepth: number
  ) => {
    for (const node of nodes) {
      if (node.kind === 'command' && ['caption', 'label'].includes(node.name)) {
        const gridDepth = environmentStack.filter(isTableEnvironment).length
        const gridIndex = environmentStack.findIndex(isTableEnvironment)
        const nestedAfterGrid =
          gridIndex >= 0 && gridIndex < environmentStack.length - 1
        const allowedDepth =
          groupDepth === 0 && gridDepth <= 1 && !nestedAfterGrid
        if (allowedDepth) {
          const kind = node.name as 'caption' | 'label'
          const rawValue = argumentSource(source, node)
          spans.push({
            token: `\uE000VTE_META_${sequence++}\uE001`,
            kind,
            raw: source.slice(node.from, node.to),
            value: decode(rawValue) ?? rawValue,
            primary: !primaryKinds.has(kind),
            star: node.star,
            optionalArgument: node.arguments.find(argument => argument.optional)
              ? source.slice(
                  node.arguments.find(argument => argument.optional)!.from,
                  node.arguments.find(argument => argument.optional)!.to
                )
              : undefined,
            from: node.from,
            to: node.to,
          })
          primaryKinds.add(kind)
        }
      }

      if (node.kind === 'group') {
        visit(node.children, environmentStack, groupDepth + 1)
      }
      if (node.kind === 'environment') {
        visit(node.children, [...environmentStack, node.name], 0)
      }
      if (node.kind === 'command') {
        for (const argument of node.arguments) {
          visit(argument.children, environmentStack, groupDepth + 1)
        }
      }
    }
  }
  visit(parseLatexSyntax(source).children, [], 0)
  return spans
}

export const templateSourceRange = (
  source: string,
  from: number,
  to: number,
  metadata: MetadataSpan[]
) => {
  let result = source.slice(from, to)
  for (const command of metadata
    .filter(command => command.from >= from && command.to <= to)
    .sort((left, right) => right.from - left.from)) {
    result =
      result.slice(0, command.from - from) +
      command.token +
      result.slice(command.to - from)
  }
  return result
}

const renderMetadata = (
  command: LatexMetadataCommand,
  model: TableModel,
  escapeLatex: (value: string) => string
) => {
  const value = command.primary
    ? command.kind === 'caption'
      ? model.options.caption
      : model.options.label
    : command.value
  if (!value) return ''
  if (value === command.value) return command.raw
  if (command.kind === 'label') return `\\label{${escapeLatex(value)}}`
  return `\\caption${command.star ? '*' : ''}${command.optionalArgument ?? ''}{${escapeLatex(value)}}`
}

export const renderSourceTemplate = (
  template: string,
  metadata: LatexMetadataCommand[],
  model: TableModel,
  escapeLatex: (value: string) => string
) => {
  let result = template
  for (const command of metadata) {
    result = result.replace(
      command.token,
      renderMetadata(command, model, escapeLatex)
    )
  }
  return result
}

export const detectWrapper = (
  source: string,
  gridFrom: number
): TableWrapperEnvironment => {
  const prefix = source.slice(0, gridFrom)
  const matches = [...prefix.matchAll(/\\begin\{([^}]+)\}/g)]
  const candidate = matches
    .map(match => match[1])
    .reverse()
    .find(isTableWrapperEnvironment)
  return candidate ?? 'standalone'
}
