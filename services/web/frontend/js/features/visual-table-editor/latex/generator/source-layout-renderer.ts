import type { TableModel } from '../../types'
import { renderSourceTemplate } from '../source-layout'

const insertBeforeWrapperEnd = (
  source: string,
  wrapper: string,
  value: string
) => {
  const marker = `\\end{${wrapper}}`
  const index = source.lastIndexOf(marker)
  if (index < 0) return `${value}${source}`
  return `${source.slice(0, index)}${value}${source.slice(index)}`
}

export const renderImportedTable = (
  model: TableModel,
  begin: string,
  rowLines: string[],
  trailingRules: string[],
  escapeLatex: (value: string) => string
) => {
  const layout = model.latexOrigin?.layout
  if (!layout) return undefined
  const render = (template: string) =>
    renderSourceTemplate(template, layout.metadata, model, escapeLatex)

  if (model.options.environment === 'longtable' && layout.sections) {
    const output = [begin]
    const renderedRows = new Set<string>()
    for (const section of layout.sections) {
      output.push(render(section.prefixTemplate))
      const rows = model.rows
        .map((row, index) => ({ row, index }))
        .filter(item => (item.row.longtableSection ?? 'body') === section.kind)
      for (const { row, index } of rows) {
        for (const fragment of section.fragments ?? []) {
          if (fragment.beforeRowId === row.id)
            output.push(render(fragment.template))
        }
        output.push(rowLines[index])
        renderedRows.add(row.id)
      }
      for (const fragment of section.fragments ?? []) {
        if (!fragment.beforeRowId) output.push(render(fragment.template))
      }
      output.push(render(section.suffixTemplate))
      if (section.marker) output.push(section.marker)
    }
    for (const { id } of model.rows) {
      if (!renderedRows.has(id)) {
        const index = model.rows.findIndex(row => row.id === id)
        output.push(rowLines[index])
      }
    }
    output.push(...trailingRules, '\\end{longtable}')
    let source = output.filter(Boolean).join('\n')
    if (
      model.options.caption &&
      !layout.metadata.some(command => command.kind === 'caption')
    ) {
      source = source.replace(
        `${begin}\n`,
        `${begin}\n\\caption{${escapeLatex(model.options.caption)}} \\\\\n`
      )
    }
    if (
      model.options.label &&
      !layout.metadata.some(command => command.kind === 'label')
    ) {
      source = source.replace(
        `${begin}\n`,
        `${begin}\n\\label{${escapeLatex(model.options.label)}}\n`
      )
    }
    return `${render(layout.beforeGridTemplate)}${source}${render(
      layout.afterGridTemplate
    )}`
  }

  const grid = `${begin}\n${[...rowLines, ...trailingRules].join(
    '\n'
  )}\n\\end{${model.options.environment}}`
  const before = render(layout.beforeGridTemplate)
  let after = render(layout.afterGridTemplate)
  const missing: string[] = []
  if (
    model.options.caption &&
    !layout.metadata.some(command => command.kind === 'caption')
  ) {
    missing.push(`  \\caption{${escapeLatex(model.options.caption)}}\n`)
  }
  if (
    model.options.label &&
    !layout.metadata.some(command => command.kind === 'label')
  ) {
    missing.push(`  \\label{${escapeLatex(model.options.label)}}\n`)
  }
  if (missing.length) {
    after =
      layout.wrapper === 'standalone'
        ? `${missing.join('')}${after}`
        : insertBeforeWrapperEnd(after, layout.wrapper, missing.join(''))
  }
  return `${before}${grid}${after}`
}
