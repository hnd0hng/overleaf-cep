export type PackageLocation = {
  file: string
  line: number
  from: number
  to: number
  before: string
  after: string
}

export type PackageProposal = {
  packageName: string
  option?: string
  status: 'present' | 'insert' | 'update-options'
  location?: PackageLocation
}

type PreambleFile = { path: string; source: string }

const packagePattern = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g

const lineAt = (source: string, position: number) =>
  source.slice(0, position).split('\n').length

const findInsertion = (file: PreambleFile): PackageLocation => {
  const documentStart = file.source.search(/\\begin\{document\}/)
  const preamble =
    documentStart >= 0 ? file.source.slice(0, documentStart) : file.source
  let insertion = preamble.search(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/)
  if (insertion >= 0) insertion = preamble.indexOf('\n', insertion) + 1
  else insertion = 0
  for (const match of preamble.matchAll(packagePattern)) {
    insertion = match.index! + match[0].length
    if (preamble[insertion] === '\r') insertion++
    if (preamble[insertion] === '\n') insertion++
  }
  return {
    file: file.path,
    line: lineAt(file.source, insertion),
    from: insertion,
    to: insertion,
    before: '',
    after: '',
  }
}

export const resolvePreambleFiles = (
  main: PreambleFile,
  availableFiles: PreambleFile[]
) => {
  const resolved: PreambleFile[] = []
  const visited = new Set<string>()
  const byPath = new Map(
    availableFiles.map(file => [file.path.replace(/\.tex$/, ''), file])
  )
  const visit = (file: PreambleFile) => {
    if (visited.has(file.path)) return
    visited.add(file.path)
    resolved.push(file)
    const documentStart = file.source.search(/\\begin\{document\}/)
    const preamble =
      documentStart >= 0 ? file.source.slice(0, documentStart) : file.source
    for (const match of preamble.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
      const referenced = byPath.get(match[1].replace(/\.tex$/, ''))
      if (referenced) visit(referenced)
    }
  }
  visit(main)
  return resolved
}

export const proposePackages = (
  required: string[],
  main: PreambleFile,
  included: PreambleFile[]
): PackageProposal[] => {
  const files = resolvePreambleFiles(main, included)
  return required.map(requirement => {
    const matchRequirement = requirement.match(/^([^[]+)(?:\[([^\]]+)\])?$/)!
    const packageName = matchRequirement[1]
    const option = matchRequirement[2]
    for (const file of files) {
      packagePattern.lastIndex = 0
      for (const match of file.source.matchAll(packagePattern)) {
        const packages = match[2].split(',').map(value => value.trim())
        if (!packages.includes(packageName)) continue
        const options = (match[1] ?? '').split(',').filter(Boolean)
        if (!option || options.includes(option)) {
          return { packageName, option, status: 'present' as const }
        }
        const nextOptions = [...options, option].join(',')
        const replacement = `\\usepackage[${nextOptions}]{${match[2]}}`
        return {
          packageName,
          option,
          status: 'update-options' as const,
          location: {
            file: file.path,
            line: lineAt(file.source, match.index!),
            from: match.index!,
            to: match.index! + match[0].length,
            before: match[0],
            after: replacement,
          },
        }
      }
    }
    const location = findInsertion(main)
    location.after = `\\usepackage${option ? `[${option}]` : ''}{${packageName}}\n`
    return { packageName, option, status: 'insert' as const, location }
  })
}
