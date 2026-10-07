import {
  commandSignature,
  environmentSignature,
  type ArgumentKind,
} from './command-signatures'
import {
  type LatexArgument,
  type LatexNode,
  type LatexSyntaxTree,
} from './syntax-tree'

class LatexParser {
  private position = 0

  constructor(private readonly source: string) {}

  parse(): LatexSyntaxTree {
    return { source: this.source, children: this.parseSequence() }
  }

  private parseSequence(
    closing?: '}' | ']',
    environment?: string
  ): LatexNode[] {
    const nodes: LatexNode[] = []
    let textStart = this.position
    const flushText = () => {
      if (textStart < this.position) {
        nodes.push({
          kind: 'text',
          from: textStart,
          to: this.position,
          value: this.source.slice(textStart, this.position),
        })
      }
    }

    while (this.position < this.source.length) {
      if (closing && this.source[this.position] === closing) {
        flushText()
        this.position++
        return nodes
      }
      if (environment && this.isEnvironmentEnd(environment)) {
        flushText()
        return nodes
      }

      const character = this.source[this.position]
      if (!'{}[]%$&\\'.includes(character)) {
        this.position++
        continue
      }

      flushText()
      const start = this.position
      if (character === '%') {
        const newline = this.source.indexOf('\n', start)
        this.position = newline < 0 ? this.source.length : newline
        nodes.push({
          kind: 'comment',
          from: start,
          to: this.position,
          value: this.source.slice(start, this.position),
        })
      } else if (character === '{' || character === '[') {
        this.position++
        const optional = character === '['
        const children = this.parseSequence(optional ? ']' : '}')
        nodes.push({
          kind: 'group',
          from: start,
          to: this.position,
          optional,
          children,
        })
      } else if (character === '}' || character === ']') {
        throw new Error(
          `Unexpected ${character} at line ${this.lineAt(this.position)}.`
        )
      } else if (character === '&') {
        this.position++
        nodes.push({
          kind: 'separator',
          separator: 'cell',
          from: start,
          to: this.position,
        })
      } else if (character === '$') {
        nodes.push(this.parseDollarMath())
      } else {
        nodes.push(this.parseCommand())
      }
      textStart = this.position
    }

    flushText()
    if (closing) throw new Error(`Unclosed ${closing === '}' ? '{' : '['}.`)
    if (environment) throw new Error(`Missing \\end{${environment}}.`)
    return nodes
  }

  private parseDollarMath(): LatexNode {
    const start = this.position
    const delimiter = this.source.startsWith('$$', start) ? '$$' : '$'
    this.position += delimiter.length
    while (this.position < this.source.length) {
      if (this.source[this.position] === '\\') {
        this.position += 2
        continue
      }
      if (this.source.startsWith(delimiter, this.position)) {
        this.position += delimiter.length
        return {
          kind: 'math',
          from: start,
          to: this.position,
          value: this.source.slice(start, this.position),
        }
      }
      this.position++
    }
    throw new Error(`Unclosed math expression at line ${this.lineAt(start)}.`)
  }

  private parseCommand(): LatexNode {
    const start = this.position++
    if (this.source[this.position] === '\\') {
      this.position++
      this.readOptionalStar()
      return {
        kind: 'separator',
        separator: 'row',
        from: start,
        to: this.position,
      }
    }

    let name = ''
    if (/[A-Za-z@]/.test(this.source[this.position] ?? '')) {
      const nameStart = this.position
      while (/[A-Za-z@]/.test(this.source[this.position] ?? '')) this.position++
      name = this.source.slice(nameStart, this.position)
    } else {
      name = this.source[this.position] ?? ''
      this.position += name ? 1 : 0
    }

    if (name === '(' || name === '[') {
      return this.parseDelimitedMath(start, name === '(' ? ')' : ']')
    }
    if (name === 'begin') return this.parseEnvironment(start)
    if (name === 'end') {
      this.parseRawEnvironmentName()
      return {
        kind: 'command',
        from: start,
        to: this.position,
        name,
        star: false,
        arguments: [],
      }
    }
    if (name === 'tabularnewline') {
      return {
        kind: 'separator',
        separator: 'row',
        from: start,
        to: this.position,
      }
    }

    const star = this.readOptionalStar()
    const commandArguments = this.parseArguments(commandSignature(name))
    return {
      kind: 'command',
      from: start,
      to: this.position,
      name,
      star,
      arguments: commandArguments,
    }
  }

  private parseDelimitedMath(start: number, closing: ')' | ']'): LatexNode {
    const marker = `\\${closing}`
    const end = this.source.indexOf(marker, this.position)
    if (end < 0) {
      throw new Error(`Unclosed math expression at line ${this.lineAt(start)}.`)
    }
    this.position = end + marker.length
    return {
      kind: 'math',
      from: start,
      to: this.position,
      value: this.source.slice(start, this.position),
    }
  }

  private parseEnvironment(start: number): LatexNode {
    const name = this.parseRawEnvironmentName()
    const environmentArguments = this.parseArguments(environmentSignature(name))
    const beginEnd = this.position
    const children = this.parseSequence(undefined, name)
    const endStart = this.position
    if (!this.isEnvironmentEnd(name)) throw new Error(`Missing \\end{${name}}.`)
    this.position += `\\end{${name}}`.length
    return {
      kind: 'environment',
      from: start,
      to: this.position,
      name,
      arguments: environmentArguments,
      children,
      beginEnd,
      endStart,
    }
  }

  private parseRawEnvironmentName() {
    this.skipWhitespace()
    if (this.source[this.position] !== '{') {
      throw new Error(
        `Expected an environment name at line ${this.lineAt(this.position)}.`
      )
    }
    const start = ++this.position
    const end = this.source.indexOf('}', start)
    if (end < 0) throw new Error('Unclosed environment name.')
    this.position = end + 1
    return this.source.slice(start, end).trim()
  }

  private parseArguments(signature: ArgumentKind[]) {
    const arguments_: LatexArgument[] = []
    for (const kind of signature) {
      const beforeWhitespace = this.position
      this.skipWhitespaceAndComments()
      const opening =
        kind === 'optional' ? '[' : kind === 'parenthesized' ? '(' : '{'
      if (this.source[this.position] !== opening) {
        this.position = beforeWhitespace
        if (kind === 'optional' || kind === 'parenthesized') continue
        break
      }
      if (kind === 'parenthesized') {
        const from = this.position++
        let depth = 1
        while (this.position < this.source.length && depth > 0) {
          if (this.source[this.position] === '\\') {
            this.position += 2
            continue
          }
          if (this.source[this.position] === '(') depth++
          if (this.source[this.position] === ')') depth--
          this.position++
        }
        if (depth) throw new Error('Unclosed parenthesized argument.')
        arguments_.push({
          optional: true,
          from,
          to: this.position,
          children: [],
        })
        continue
      }
      const from = this.position++
      const children = this.parseSequence(kind === 'optional' ? ']' : '}')
      arguments_.push({
        optional: kind === 'optional',
        from,
        to: this.position,
        children,
      })
    }
    return arguments_
  }

  private readOptionalStar() {
    if (this.source[this.position] !== '*') return false
    this.position++
    return true
  }

  private skipWhitespace() {
    while (/\s/.test(this.source[this.position] ?? '')) this.position++
  }

  private skipWhitespaceAndComments() {
    while (true) {
      this.skipWhitespace()
      if (this.source[this.position] !== '%') return
      const newline = this.source.indexOf('\n', this.position)
      this.position = newline < 0 ? this.source.length : newline + 1
    }
  }

  private isEnvironmentEnd(name: string) {
    return this.source.startsWith(`\\end{${name}}`, this.position)
  }

  private lineAt(position: number) {
    return this.source.slice(0, position).split('\n').length
  }
}

export const parseLatexSyntax = (source: string) =>
  new LatexParser(source).parse()

export const parseLatexFragment = (source: string) =>
  parseLatexSyntax(source).children

export const walkLatexNodes = (
  nodes: LatexNode[],
  visit: (node: LatexNode, ancestors: LatexNode[]) => void,
  ancestors: LatexNode[] = []
) => {
  for (const node of nodes) {
    visit(node, ancestors)
    const next = [...ancestors, node]
    if (node.kind === 'group' || node.kind === 'environment') {
      walkLatexNodes(node.children, visit, next)
    }
    if (node.kind === 'command' || node.kind === 'environment') {
      for (const argument of node.arguments) {
        walkLatexNodes(argument.children, visit, next)
      }
    }
  }
}
