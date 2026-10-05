export const nextMatchIndex = (
  currentIndex: number,
  matchCount: number,
  direction: 1 | -1
) => {
  if (matchCount <= 0) return -1
  if (currentIndex < 0 || currentIndex >= matchCount) {
    return direction === 1 ? 0 : matchCount - 1
  }
  return (currentIndex + direction + matchCount) % matchCount
}
