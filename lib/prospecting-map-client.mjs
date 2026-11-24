export async function loadCompleteProspectingMap(fetchPage, { signal, onProgress } = {}) {
  signal?.throwIfAborted();
  const first = await fetchPage(0);
  const results = [first];
  signal?.throwIfAborted();
  onProgress?.(combinePages(results, first.page_count > 1));
  for (let page = 1; page < first.page_count; page += 2) {
    signal?.throwIfAborted();
    const batch = await Promise.all(Array.from({ length: Math.min(2, first.page_count - page) }, (_, index) => fetchPage(page + index)));
    signal?.throwIfAborted();
    results.push(...batch);
    onProgress?.(combinePages(results, results.length < first.page_count));
  }
  return combinePages(results, false);
}

function combinePages(results, loading) {
  const first = results[0];
  const points = results.flatMap((result) => result.points);
  const area_counts = points.reduce((counts, point) => {
    counts.all++;
    counts[point.within_radius ? "within" : "outside"]++;
    if (point.coordinate_confirmed) counts.confirmed++;
    return counts;
  }, { all: 0, within: 0, outside: 0, confirmed: 0 });
  const summary = points.reduce((counts, point) => {
    const key = point.coordinate_confirmed ? "confirmed" : "suggested";
    counts[key]++;
    counts[`${key}_${point.within_radius ? "within_radius" : "outside_radius"}`]++;
    return counts;
  }, { confirmed: 0, confirmed_within_radius: 0, confirmed_outside_radius: 0, suggested: 0, suggested_within_radius: 0, suggested_outside_radius: 0 });
  summary.suggested_inside = summary.suggested_within_radius;
  summary.suggested_outside = summary.suggested_outside_radius;
  return { ...first, points, total: points.length, loading, truncated: loading, area_counts, summary };
}
