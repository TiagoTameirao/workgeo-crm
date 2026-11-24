import { createHash } from "node:crypto";

const integerTypes = new Set(["smallint", "integer", "bigint"]);
const realTypes = new Set(["real", "double precision", "numeric"]);
export function migrationRow(row, columns) {
  return columns.map(({ name, type }) => {
    if (!Object.hasOwn(row, name)) throw new Error(`Coluna ausente na migração: ${name}`);
    const value = row[name];
    if (value === null) return null;
    if (type === "boolean") {
      if (![true, false, 0, 1].includes(value)) throw new Error(`Booleano inválido: ${name}`);
      return Number(value);
    }
    if (integerTypes.has(type) || realTypes.has(type)) {
      const number = Number(value);
      if (!Number.isFinite(number) || (integerTypes.has(type) && !Number.isSafeInteger(number)))
        throw new Error(`Número sem representação exata: ${name}`);
      return number;
    }
    return value;
  });
}
export function migrationDigest() {
  const hash = createHash("sha256");
  let count = 0;
  return {
    add(row, columns) { hash.update(JSON.stringify(migrationRow(row, columns)) + "\n", "utf8"); count++; },
    finish() { return { count, sha256: hash.digest("hex") }; },
  };
}
