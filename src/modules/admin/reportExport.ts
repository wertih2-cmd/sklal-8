export function csvCell(value: string | number | null): string {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null>>): void {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function printReport(): void {
  window.print()
}
