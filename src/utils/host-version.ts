// Introduced by the next host preview. Do not probe capabilities or upstream
// versions: feature routing is explicitly based on the connected host version.
export const MOBILE_SYNC_MIN_VERSION = '3.2.14-pre.3'

export function supportsMobileSync(
  version: string | null | undefined,
): boolean {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version ?? '',
    )
  if (!match) return false
  const core = match.slice(1, 4).map(Number)
  for (const [index, minimum] of [3, 2, 14].entries()) {
    if (core[index] !== minimum) return core[index] > minimum
  }
  if (!match[4]) return true
  const preview = /^pre\.(\d+)$/.exec(match[4])
  return !!preview && Number(preview[1]) >= 3
}
