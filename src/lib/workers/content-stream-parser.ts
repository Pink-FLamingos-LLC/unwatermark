import type { BoundingBox, ImagePlacement } from "./types";

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function identityMatrix(): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiplyMatrices(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
    e: m1.e * m2.a + m1.f * m2.c + m2.e,
    f: m1.e * m2.b + m1.f * m2.d + m2.f,
  };
}

function transformRect(m: Matrix, x: number, y: number, w: number, h: number): BoundingBox {
  const x0 = m.a * x + m.c * y + m.e;
  const y0 = m.b * x + m.d * y + m.f;
  const x1 = m.a * (x + w) + m.c * (y + h) + m.e;
  const y1 = m.b * (x + w) + m.d * (y + h) + m.f;

  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

type Token =
  | { type: "number"; value: number }
  | { type: "name"; value: string }
  | { type: "op"; value: string };

function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  const re = /(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|\/([^\s[\](){}<>/%]+)|(\w+)|%[^\n]*/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    if (match[1] !== undefined) {
      tokens.push({ type: "number", value: parseFloat(match[1]) });
    } else if (match[2] !== undefined) {
      tokens.push({ type: "name", value: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "op", value: match[3] });
    }
  }

  return tokens;
}

export function parseContentStream(content: string, xobjectNames: Set<string>): ImagePlacement[] {
  const tokens = tokenize(content);
  const placements: ImagePlacement[] = [];

  const stack: Matrix[] = [identityMatrix()];
  let ctm = identityMatrix();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type !== "op") continue;

    switch (token.value) {
      case "q":
        stack.push({ ...ctm });
        break;
      case "Q":
        if (stack.length > 1) {
          ctm = stack.pop()!;
        }
        break;
      case "cm": {
        if (i >= 6) {
          const nums: number[] = [];
          for (let j = i - 6; j < i; j++) {
            const t = tokens[j];
            if (t.type === "number") {
              nums.push(t.value);
            }
          }
          if (nums.length === 6) {
            const [a, b, c, d, e, f] = nums;
            ctm = multiplyMatrices(ctm, { a, b, c, d, e, f });
          }
        }
        break;
      }
      case "Do": {
        if (i > 0) {
          const prev = tokens[i - 1];
          if (prev.type === "name" && xobjectNames.has(prev.value)) {
            const box = transformRect(ctm, 0, 0, 1, 1);
            placements.push({ name: prev.value, box });
          }
        }
        break;
      }
    }
  }

  return placements;
}
