/**
 * 纯本地二维码生成（零依赖 · 无外部库 · 无 CDN）
 *
 * 用途：把「账户码」（32 位十六进制）编成二维码，给微信小程序「扫一扫」关联账户。
 *
 * 实现范围（只服务本场景，不追求通用）：ISO/IEC 18004
 *   - 字节模式（Byte mode）
 *   - 固定 Version 3 / 纠错级别 M（单纠错块）：29×29 模块，44 数据码字 + 26 纠错码字 = 70 码字
 *     （容量 44 字节，账户码 32 字节，余量充足）
 *   - 从 8 种掩码里按标准罚分择优
 *   - 输出 SVG（矢量、清晰、无位图）
 *
 * 若将来需要其它版本 / 纠错级别，请另开实现，不要在此硬塞。
 */

const VERSION = 3;
const SIZE = VERSION * 4 + 17; // 29
const DATA_CODEWORDS = 44; // V3-M 数据码字
const EC_CODEWORDS = 26; // V3-M 纠错码字
const TOTAL_CODEWORDS = DATA_CODEWORDS + EC_CODEWORDS; // 70
const EC_LEVEL_FORMAT_BITS = 0b00; // 纠错级别 M 的格式信息位

/* ---------------------------------------------------------------- GF(256) */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** 生成多项式 g(x) = (x-α⁰)(x-α¹)…(x-α^{deg-1})，最高次系数为 1 */
function rsGenPoly(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon：对数据码字求 deg 个纠错码字 */
function rsEncode(data, deg) {
  const gen = rsGenPoly(deg);
  const res = new Array(deg).fill(0);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i] ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) {
      for (let j = 0; j < deg; j += 1) res[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return res;
}

/* ------------------------------------------------------------- 数据编码 */

/** UTF-8 字节序列（账户码是 ASCII，仍按标准编码以防万一） */
function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    const cp = str.codePointAt(i);
    if (cp > 0xffff) i += 1; // 跳过代理对低位
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63)
      );
    }
  }
  return out;
}

/** 文本 → 数据码字（字节模式 + 终止符 + 补位） */
function buildDataCodewords(text) {
  const bytes = utf8Bytes(text);
  const capacityBits = DATA_CODEWORDS * 8;
  if (bytes.length > DATA_CODEWORDS - 2) {
    throw new Error('二维码内容过长（上限 42 字节）');
  }

  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(0b0100, 4); // 字节模式
  push(bytes.length, 8); // 字符数（V3 用 8 位）
  for (let i = 0; i < bytes.length; i += 1) push(bytes[i], 8);

  const terminator = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  const PAD = [0xec, 0x11];
  for (let p = 0; out.length < DATA_CODEWORDS; p += 1) out.push(PAD[p % 2]);
  return out;
}

/* --------------------------------------------------------------- 矩阵绘制 */

function newGrid(fill) {
  const g = [];
  for (let i = 0; i < SIZE; i += 1) g.push(new Array(SIZE).fill(fill));
  return g;
}

/** 生成未打掩码的基础矩阵：功能图形 + 数据，返回 { modules, isFunc } */
function buildBaseMatrix(text) {
  const modules = newGrid(0);
  const isFunc = newGrid(false);

  const setFn = (row, col, dark) => {
    modules[row][col] = dark ? 1 : 0;
    isFunc[row][col] = true;
  };

  // 定位图形（含分隔符）：切比雪夫距 2/4 为浅色
  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE) setFn(yy, xx, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(SIZE - 4, 3);
  drawFinder(3, SIZE - 4);

  // 定时图形
  for (let i = 0; i < SIZE; i += 1) {
    if (!isFunc[6][i]) setFn(6, i, i % 2 === 0);
    if (!isFunc[i][6]) setFn(i, 6, i % 2 === 0);
  }

  // 校正图形（V3 仅中心一处，位置 22）
  const drawAlign = (cx, cy) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFn(cy + dy, cx + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };
  drawAlign(22, 22);

  // 格式信息区（先用占位值占位，掩码确定后再覆写）
  drawFormatInfo(modules, isFunc, setFn, 0);

  // 数据位按之字形填入（数据码字 + 纠错码字，拼成完整码字序列）
  const dataCodewords = buildDataCodewords(text);
  const codewords = dataCodewords.concat(rsEncode(dataCodewords, EC_CODEWORDS));
  const totalBits = TOTAL_CODEWORDS * 8;
  let bitIndex = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < SIZE; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const col = right - j;
        const row = upward ? SIZE - 1 - vert : vert;
        if (!isFunc[row][col] && bitIndex < totalBits) {
          const bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
          modules[row][col] = bit;
          bitIndex += 1;
        }
      }
    }
  }
  return { modules, isFunc };
}

/** 15 位格式信息（纠错级别 + 掩码），含 BCH(15,5) 与固定异或 0x5412 */
function formatBits(mask) {
  const data = (EC_LEVEL_FORMAT_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatInfo(modules, isFunc, setFn, mask) {
  const bits = formatBits(mask);
  const bit = (i) => (bits >>> i) & 1;

  for (let i = 0; i <= 5; i += 1) setFn(i, 8, bit(i));
  setFn(7, 8, bit(6));
  setFn(8, 8, bit(7));
  setFn(8, 7, bit(8));
  for (let i = 9; i < 15; i += 1) setFn(8, 14 - i, bit(i));

  for (let i = 0; i < 8; i += 1) setFn(8, SIZE - 1 - i, bit(i));
  for (let i = 8; i < 15; i += 1) setFn(SIZE - 15 + i, 8, bit(i));
  setFn(SIZE - 8, 8, 1); // 固定深色模块
}

/** 掩码条件：x=列，y=行 */
function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(modules, isFunc, mask) {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!isFunc[y][x] && maskBit(mask, x, y)) modules[y][x] ^= 1;
    }
  }
}

const PATTERN_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
const PATTERN_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

function lineMatches(line, start, pat) {
  if (start + pat.length > line.length) return false;
  for (let k = 0; k < pat.length; k += 1) if (line[start + k] !== pat[k]) return false;
  return true;
}

/** 标准罚分：相邻同色 / 2×2 同色 / 类定位图形 / 深浅比例 */
function penaltyScore(m) {
  let score = 0;

  for (let y = 0; y < SIZE; y += 1) {
    let runColor = m[y][0];
    let runLen = 1;
    for (let x = 1; x < SIZE; x += 1) {
      if (m[y][x] === runColor) {
        runLen += 1;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runColor = m[y][x];
        runLen = 1;
      }
    }
  }
  for (let x = 0; x < SIZE; x += 1) {
    let runColor = m[0][x];
    let runLen = 1;
    for (let y = 1; y < SIZE; y += 1) {
      if (m[y][x] === runColor) {
        runLen += 1;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runColor = m[y][x];
        runLen = 1;
      }
    }
  }

  for (let y = 0; y < SIZE - 1; y += 1) {
    for (let x = 0; x < SIZE - 1; x += 1) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (lineMatches(m[y], x, PATTERN_A) || lineMatches(m[y], x, PATTERN_B)) score += 40;
    }
  }
  for (let x = 0; x < SIZE; x += 1) {
    const col = [];
    for (let y = 0; y < SIZE; y += 1) col.push(m[y][x]);
    for (let y = 0; y < SIZE; y += 1) {
      if (lineMatches(col, y, PATTERN_A) || lineMatches(col, y, PATTERN_B)) score += 40;
    }
  }

  let dark = 0;
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) if (m[y][x]) dark += 1;
  const total = SIZE * SIZE;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;

  return score;
}

/** 文本 → 二维模块矩阵（0/1）。opts.mask 可强制指定掩码（0–7），默认择优。 */
export function qrMatrix(text, opts) {
  opts = opts || {};
  const { modules, isFunc } = buildBaseMatrix(text);

  let bestMask = 0;
  if (typeof opts.mask === 'number' && opts.mask >= 0 && opts.mask <= 7) {
    bestMask = opts.mask;
    applyMask(modules, isFunc, bestMask);
  } else {
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
      const clone = modules.map((row) => row.slice());
      applyMask(clone, isFunc, mask);
      const score = penaltyScore(clone);
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
      }
    }
    applyMask(modules, isFunc, bestMask);
  }

  drawFormatInfo(modules, isFunc, (row, col, dark) => {
    modules[row][col] = dark ? 1 : 0;
  }, bestMask);

  return { matrix: modules, mask: bestMask };
}

/**
 * 文本 → 二维码 SVG 字符串（含 4 模块静区）。
 * 内容为空或过长时返回 ''（由调用方决定如何提示）。
 */
export function qrSvg(text, opts) {
  opts = opts || {};
  const value = String(text == null ? '' : text);
  if (!value) return '';

  let matrix;
  try {
    matrix = qrMatrix(value, opts).matrix;
  } catch (e) {
    return '';
  }

  const scale = opts.scale || 6; // 每个模块的像素
  const border = 4; // 静区（扫描必需）
  const dim = (SIZE + border * 2) * scale;

  let path = '';
  for (let y = 0; y < SIZE; y += 1) {
    let x = 0;
    while (x < SIZE) {
      if (!matrix[y][x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < SIZE && matrix[y][x + run]) run += 1;
      path += 'M' + ((x + border) * scale) + ' ' + ((y + border) * scale) + 'h' + run * scale + 'v' + scale + 'h' + -run * scale + 'z';
      x += run;
    }
  }

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" ' +
    'width="' + dim + '" height="' + dim + '" shape-rendering="crispEdges" ' +
    'role="img" aria-label="账户码二维码">' +
    '<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>' +
    '<path d="' + path + '" fill="#000000"/>' +
    '</svg>'
  );
}
