import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCircleCenter, distanceMeters, geodesicCircle } from "../lib/territory-radius.mjs";

test("geodesic circle closes and its vertices remain at the requested distance", () => {
  const center = { longitude: -43.99, latitude: -19.91 };
  const ring = geodesicCircle(center, 170_000);
  assert.equal(ring.length, 721);
  assert.deepEqual(ring[0], ring.at(-1));
  for (const point of ring.filter((_, index) => index % 45 === 0))
    assert.ok(Math.abs(distanceMeters([center.longitude, center.latitude], point) - 170_000) < 0.001);
});

test("least-squares center recovers a geodesic ring within one kilometer", () => {
  const expected = { longitude: -43.99, latitude: -19.91 };
  const actual = deriveCircleCenter(geodesicCircle(expected, 170_000));
  assert.ok(distanceMeters([expected.longitude, expected.latitude], [actual.longitude, actual.latitude]) < 1_000);
});

test("center fitting accepts open rings and rejects invalid rings", () => {
  const closed = geodesicCircle({ longitude: -43.9, latitude: -19.9 }, 10_000, 72);
  const open = closed.slice(0, -1);
  assert.ok(Number.isFinite(deriveCircleCenter(open).longitude));
  assert.throws(() => deriveCircleCenter([[0, 0], [1, 1]]), /três coordenadas/);
});
