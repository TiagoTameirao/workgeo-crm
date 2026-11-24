import { test } from "node:test";
import assert from "node:assert/strict";
import { readJsonResponse } from "../lib/client-http.mjs";
import { loadCompleteProspectingMap } from "../lib/prospecting-map-client.mjs";
import { createProspectingLayer, groupVisibleMapPoints, removeProspectingMap } from "../lib/prospecting-map-layer.mjs";

test("a hosting timeout produces an actionable error without exposing its text", async () => {
  await assert.rejects(readJsonResponse(new Response('An error occurred FUNCTION_INVOCATION_TIMEOUT', { status: 504 })), /demorou a responder/);
  await assert.rejects(readJsonResponse(new Response('<html>Error</html>', { status: 200 })), /resposta inválida/);
  await assert.rejects(readJsonResponse(Response.json({ error: 'Entre para acessar.' }, { status: 401 })), /Entre para acessar/);
});

test("neutral map groups retain every original coordinate and exclude offscreen points", () => {
  const points = Array.from({ length: 10000 }, (_, index) => ({ id: String(index), latitude: 1, longitude: 2, within_radius: true, coordinate_confirmed: index === 0 }));
  points.push({ id: 'offscreen', latitude: 90, longitude: 0 });
  const groups = groupVisibleMapPoints(points, () => ({ x: 10, y: 10 }), (point) => point.latitude < 80);
  assert.equal(groups.length, 1);
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), 10000);
  assert.equal(new Set(groups.flatMap((group) => group.members.map((point) => point.id))).size, 10000);
});

test("dense groups display a count while single markers retain their exact coordinates", () => {
  const radii = [], clusters = [], positions = [];
  const layer = { addTo() { return this; }, clearLayers() {}, remove() {} };
  const L = {
    layerGroup: () => layer, canvas: () => ({remove() {}}),
    divIcon: (options) => options,
    marker(position, options) { clusters.push(options.icon.html); return {addTo() {return this;},bindTooltip() {},on() {}}; },
    circleMarker(position, options) {
      radii.push(options.radius);
      positions.push(position);
      return { addTo() { return this; }, bindTooltip() {}, on() {} };
    },
  };
  const map = { on() {}, off() {}, getZoom: () => 8, getBounds: () => ({pad() {return this;}, contains: () => true}), project: point => ({x:point.longitude * 100,y:point.latitude * 100}) };
  const points = createProspectingLayer(L, map, () => {});
  points.setPoints(Array.from({length:10000}, (_, id) => ({id,latitude:1,longitude:2,within_radius:true})));
  assert.deepEqual(clusters, ['10000']);
  points.setPoints([{latitude:-19.912345,longitude:-43.987654,within_radius:true}]);
  assert.deepEqual(radii, [3]);
  assert.deepEqual(positions, [[-19.912345,-43.987654]]);
  points.dispose();
});

test("map teardown removes paths before the canvas renderer can be destroyed", () => {
  class Path {}
  const paths = [new Path(), new Path()], renderer = {}, layers = [renderer, ...paths];
  const removed = [];
  removeProspectingMap({ Path }, {
    stop() {},
    eachLayer(fn) { layers.forEach(fn); },
    removeLayer(layer) { removed.push(layer); },
    remove() { assert.deepEqual(removed, paths); },
  });
});

test("map publishes the first page before requesting remaining pages and aborts", async () => {
  const controller = new AbortController(), progress = [];
  const result = await loadCompleteProspectingMap(async (page) => {
    if (page > 0) assert.ok(progress.length > 0);
    return { page_count: 3, points: [{ id: String(page), within_radius: true, coordinate_confirmed: false }] };
  }, { signal: controller.signal, onProgress: (partial) => progress.push(partial.points.length) });
  assert.equal(result.points.length, 3);
  assert.equal(progress[0], 1);
  controller.abort();
  await assert.rejects(loadCompleteProspectingMap(() => { throw Error('must not fetch'); }, { signal: controller.signal }), { name: 'AbortError' });
});
