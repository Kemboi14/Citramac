/**
 * Every row of a DRF-paginated list, page after page, for screens that filter
 * or count the whole list in the browser and page it with usePaged.
 */
export async function allPages<P extends { count: number; results: unknown[] }>(
  fetchPage: (page: number) => Promise<P>,
): Promise<P> {
  const first = await fetchPage(1);
  const results = [...first.results];
  for (let page = 2; results.length < first.count; page += 1) {
    const next = await fetchPage(page);
    if (next.results.length === 0) break;
    results.push(...next.results);
  }
  return { ...first, results };
}
