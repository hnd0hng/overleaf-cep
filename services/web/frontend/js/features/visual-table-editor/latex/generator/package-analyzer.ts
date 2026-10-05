const requireXcolor = (packages: Set<string>, tableOption: boolean) => {
  if (tableOption) {
    packages.delete('xcolor')
    packages.add('xcolor[table]')
  } else if (!packages.has('xcolor[table]')) {
    packages.add('xcolor')
  }
}

export const collectSourcePackages = (
  source: string | undefined,
  packages: Set<string>
) => {
  if (!source) return
  if (/\\multirow\b/.test(source)) packages.add('multirow')
  if (/\\(?:toprule|midrule|bottomrule|cmidrule)\b/.test(source)) {
    packages.add('booktabs')
  }
  if (/\\begin\{tabularx\}/.test(source)) packages.add('tabularx')
  if (/\\begin\{xltabular\}/.test(source)) packages.add('xltabular')
  if (/\\begin\{longtable\}/.test(source)) packages.add('longtable')
  if (/\\resizebox\b/.test(source)) packages.add('graphicx')
  if (/\\(?:makecell|thead)\b/.test(source)) packages.add('makecell')
  if (/\\hhline\b/.test(source)) packages.add('hhline')
  if (/\\(?:uline|ul)\b/.test(source)) packages.add('ulem')
  if (/\\begin\{landscape\}/.test(source)) packages.add('lscape')
  if (/\\(?:cellcolor|rowcolor|columncolor)\b/.test(source)) {
    requireXcolor(packages, true)
  } else if (/\\(?:textcolor|color)\b/.test(source)) {
    requireXcolor(packages, false)
  }
}
