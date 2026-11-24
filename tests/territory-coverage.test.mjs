import { test } from "node:test";
import assert from "node:assert/strict";
import { pointInGeometry, pointInRing, polygonIntersectsGeometry } from "../lib/territory-coverage.mjs";

const square = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
  [0, 0],
];

test("ponto distingue interior, exterior e borda do polígono", () => {
  assert.equal(pointInRing([2, 2], square), true);
  assert.equal(pointInRing([5, 2], square), false);
  assert.equal(pointInRing([4, 2], square), true);
});

test("ponto verifica Feature Polygon, MultiPolygon, borda e vazios", () => {
  const feature = { type:"Feature", geometry:{ type:"Polygon", coordinates:[square, [[1,1],[3,1],[3,3],[1,3],[1,1]]] } };
  const multi = { type:"MultiPolygon", coordinates:[[[[8,8],[9,8],[9,9],[8,9],[8,8]]], [square]] };
  assert.equal(pointInGeometry([0.5,0.5],feature),true);
  assert.equal(pointInGeometry([2,2],feature),false);
  assert.equal(pointInGeometry([4,2],feature),true);
  assert.equal(pointInGeometry([2,2],multi),true);
  assert.equal(pointInGeometry([7,7],multi),false);
});

test("interseção considera área contida, cruzamento de borda e ausência", () => {
  const containingMunicipality = { type: "Polygon", coordinates: [[[-1, -1], [5, -1], [5, 5], [-1, 5], [-1, -1]]] };
  const crossingMunicipality = { type: "Polygon", coordinates: [[[1, -1], [3, -1], [3, 5], [1, 5], [1, -1]]] };
  const separateMunicipality = { type: "Polygon", coordinates: [[[8, 8], [9, 8], [9, 9], [8, 9], [8, 8]]] };
  assert.equal(polygonIntersectsGeometry(square, containingMunicipality), true);
  assert.equal(polygonIntersectsGeometry(square, crossingMunicipality), true);
  assert.equal(polygonIntersectsGeometry(square, separateMunicipality), false);
});

test("interseção considera componentes multipoligonais e respeita vazios", () => {
  const multi = { type: "MultiPolygon", coordinates: [
    [[[8, 8], [9, 8], [9, 9], [8, 9], [8, 8]]],
    [[[-1, -1], [5, -1], [5, 5], [-1, 5], [-1, -1]]],
  ] };
  const hole = { type: "Polygon", coordinates: [
    [[-1, -1], [5, -1], [5, 5], [-1, 5], [-1, -1]],
    [[-0.5, -0.5], [4.5, -0.5], [4.5, 4.5], [-0.5, 4.5], [-0.5, -0.5]],
  ] };
  assert.equal(polygonIntersectsGeometry(square, multi), true);
  assert.equal(polygonIntersectsGeometry(square, hole), false);
});
