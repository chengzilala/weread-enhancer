// 阅读人格 · 代表人物线描插画（移植自插件 modules/official.js）
// 说明：小程序 <image> 支持 SVG，这里把 SVG 转成 base64 Data URI 直接渲染。
// 图片无法继承 currentColor，故墨色/点缀色取固定值（跟随小程序主题：墨色 #1F2430、点缀 #2F6BFF）。

const INK = '#1F2430';       // 线描墨色
const ACCENT = '#2F6BFF';    // 品牌点缀色

// 线描插画底稿：圆框 + 肩颈 + 头 + 五官（线条颜色用占位符，生成时替换）
const FIGURE_FRAME =
  '<circle cx="120" cy="120" r="110" stroke="__INK__" stroke-width="3" opacity="0.28"/>' +
  '<path d="M58 234 C60 200 84 180 106 172 L134 172 C156 180 180 200 182 234" stroke="__INK__" stroke-width="5"/>' +
  '<path d="M106 142 L106 172 M134 142 L134 172" stroke="__INK__" stroke-width="5"/>';
const FIGURE_HEAD =
  '<ellipse cx="120" cy="102" rx="39" ry="45" stroke="__INK__" stroke-width="5"/>' +
  '<path d="M81 98 C75 96 74 105 77 111 C79 115 82 116 84 115" stroke="__INK__" stroke-width="4"/>' +
  '<path d="M159 98 C165 96 166 105 163 111 C161 115 158 116 156 115" stroke="__INK__" stroke-width="4"/>' +
  '<circle cx="107" cy="102" r="3" fill="__INK__"/>' +
  '<circle cx="133" cy="102" r="3" fill="__INK__"/>' +
  '<path d="M120 104 C117 114 117 118 122 119" stroke="__INK__" stroke-width="3.5"/>' +
  '<path d="M112 130 C117 134 123 134 128 130" stroke="__INK__" stroke-width="3.5"/>';

// 各型专属特征（back：画在头后，如长发/头巾；front：画在头前，如帽/须/领）
const FIGURE_PARTS = {
  DFLP: {
    back: '<path d="M76 108 C58 70 88 42 120 42 C152 42 182 70 164 108 C172 130 168 152 156 164 L84 164 C72 152 68 130 76 108 Z" stroke="__INK__" stroke-width="5"/>',
    front: '<circle cx="78" cy="112" r="11" stroke="__INK__" stroke-width="4"/><circle cx="76" cy="132" r="11" stroke="__INK__" stroke-width="4"/><circle cx="80" cy="152" r="11" stroke="__INK__" stroke-width="4"/>' +
      '<circle cx="162" cy="112" r="11" stroke="__INK__" stroke-width="4"/><circle cx="164" cy="132" r="11" stroke="__INK__" stroke-width="4"/><circle cx="160" cy="152" r="11" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M104 170 L120 192 L136 170" stroke="__ACCENT__" stroke-width="5"/><path d="M106 190 C112 202 128 202 134 190" stroke="__INK__" stroke-width="4"/>',
  },
  DFLR: {
    back: '<path d="M74 108 C62 66 90 42 120 42 C150 42 178 66 166 108 C172 134 170 154 164 166 L76 166 C70 154 68 134 74 108 Z" stroke="__INK__" stroke-width="5"/>',
    front: '<path d="M86 112 C84 152 100 182 120 184 C140 182 156 152 154 112" stroke="__INK__" stroke-width="5"/>' +
      '<path d="M104 126 C112 120 128 120 136 126" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M84 60 C92 42 148 42 156 60 C159 68 150 72 144 66 C128 54 112 54 96 66 C90 72 81 68 84 60 Z" stroke="__INK__" stroke-width="5"/>',
  },
  DFEP: {
    back: '<path d="M82 96 C76 80 80 68 90 60" stroke="__INK__" stroke-width="5"/><path d="M158 96 C164 80 160 68 150 60" stroke="__INK__" stroke-width="5"/>',
    front: '<path d="M100 93 C106 89 114 89 118 93" stroke="__INK__" stroke-width="4"/><path d="M122 93 C126 89 134 89 140 93" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M86 116 C86 156 102 182 120 182 C138 182 154 156 154 116 C150 132 138 140 120 140 C102 140 90 132 86 116 Z" stroke="__INK__" stroke-width="5"/>' +
      '<path d="M104 130 C112 126 128 126 136 130" stroke="__INK__" stroke-width="4"/>',
  },
  DFER: {
    back: '<circle cx="90" cy="70" r="10" stroke="__INK__" stroke-width="4"/><circle cx="108" cy="60" r="11" stroke="__INK__" stroke-width="4"/><circle cx="132" cy="60" r="11" stroke="__INK__" stroke-width="4"/><circle cx="150" cy="70" r="10" stroke="__INK__" stroke-width="4"/><circle cx="80" cy="90" r="9" stroke="__INK__" stroke-width="4"/><circle cx="160" cy="90" r="9" stroke="__INK__" stroke-width="4"/>',
    front: '<path d="M88 114 C88 156 104 182 120 182 C136 182 152 156 152 114" stroke="__INK__" stroke-width="5"/>' +
      '<path d="M104 128 C112 124 128 124 136 128" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M83 86 C100 78 140 78 157 86" stroke="__ACCENT__" stroke-width="5"/>',
  },
  DMLP: {
    back: '',
    front: '<path d="M82 92 C82 60 100 46 120 46 C140 46 158 60 158 92" stroke="__INK__" stroke-width="5"/>' +
      '<circle cx="80" cy="108" r="13" stroke="__INK__" stroke-width="5"/><circle cx="160" cy="108" r="13" stroke="__INK__" stroke-width="5"/>' +
      '<path d="M104 170 L120 190 L136 170" stroke="__ACCENT__" stroke-width="5"/><path d="M106 188 C112 200 128 200 134 188" stroke="__INK__" stroke-width="4"/>',
  },
  DMLR: {
    back: '',
    front: '<path d="M83 92 C83 60 102 48 122 48 C142 48 157 62 157 88 C150 76 136 68 118 70 C104 72 91 80 83 92 Z" stroke="__INK__" stroke-width="5"/>' +
      '<path d="M106 172 L120 188 L134 172" stroke="__INK__" stroke-width="4"/><path d="M120 178 L113 190 L120 214 L127 190 Z" stroke="__ACCENT__" stroke-width="4"/>',
  },
  DMEP: {
    back: '',
    front: '<path d="M92 62 L92 34 L148 34 L148 62 Z" stroke="__INK__" stroke-width="5"/><path d="M82 62 C100 54 140 54 158 62" stroke="__INK__" stroke-width="5"/>' +
      '<path d="M98 128 C98 154 108 168 120 168 C132 168 142 154 142 128" stroke="__INK__" stroke-width="5"/><path d="M108 130 C114 126 126 126 132 130" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M106 172 L120 194 L134 172" stroke="__INK__" stroke-width="5"/><path d="M120 194 L120 210" stroke="__INK__" stroke-width="5"/><path d="M112 176 L120 190 M128 176 L120 190" stroke="__INK__" stroke-width="3.5"/>',
  },
  DMER: {
    back: '',
    front: '<path d="M86 60 C94 44 146 44 154 60 C148 68 92 68 86 60 Z" stroke="__INK__" stroke-width="5"/><path d="M84 64 L156 64" stroke="__ACCENT__" stroke-width="5"/><path d="M154 60 C166 56 172 64 166 72" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M104 130 C104 158 112 172 120 172 C128 172 136 158 136 130" stroke="__INK__" stroke-width="4"/>',
  },
  BFLP: {
    back: '',
    front: '<path d="M80 86 C72 66 86 52 100 56 C104 44 126 42 134 54 C148 46 162 58 158 76 C166 84 163 96 154 98 C150 84 140 74 120 74 C100 74 88 82 80 86 Z" stroke="__INK__" stroke-width="5"/>' +
      '<path d="M108 172 L120 200 L132 172" stroke="__INK__" stroke-width="4"/><path d="M120 200 L120 214" stroke="__ACCENT__" stroke-width="4"/>',
  },
  BFLR: {
    back: '<circle cx="78" cy="86" r="14" stroke="__INK__" stroke-width="4"/><circle cx="94" cy="64" r="15" stroke="__INK__" stroke-width="4"/><circle cx="120" cy="54" r="17" stroke="__INK__" stroke-width="4"/><circle cx="146" cy="64" r="15" stroke="__INK__" stroke-width="4"/><circle cx="162" cy="86" r="14" stroke="__INK__" stroke-width="4"/><circle cx="70" cy="112" r="13" stroke="__INK__" stroke-width="4"/><circle cx="170" cy="112" r="13" stroke="__INK__" stroke-width="4"/>',
    front: '<path d="M98 126 C110 116 130 116 142 126 C130 134 110 134 98 126 Z" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M120 178 L104 170 L104 188 Z" stroke="__ACCENT__" stroke-width="4"/><path d="M120 178 L136 170 L136 188 Z" stroke="__ACCENT__" stroke-width="4"/>',
  },
  BFEP: {
    back: '<path d="M134 170 C134 156 146 148 160 150 L166 182 C152 190 134 188 134 170 Z" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M146 152 L140 134 M158 150 L158 132 M168 154 L176 138" stroke="__ACCENT__" stroke-width="3.5"/>',
    front: '<path d="M86 72 C86 44 100 32 120 32 C140 32 154 44 154 72 Z" stroke="__INK__" stroke-width="5"/>' +
      '<circle cx="120" cy="28" r="4.5" stroke="__INK__" stroke-width="3.5"/>' +
      '<path d="M84 72 L156 72" stroke="__ACCENT__" stroke-width="4"/>' +
      '<path d="M110 136 C106 154 114 166 120 166 C126 166 134 154 130 136" stroke="__INK__" stroke-width="4"/>',
  },
  BFER: {
    back: '<path d="M76 104 C64 70 90 46 120 46 C150 46 176 70 164 104" stroke="__INK__" stroke-width="5"/><path d="M164 96 C176 100 182 116 174 130" stroke="__INK__" stroke-width="4"/>',
    front: '<circle cx="78" cy="104" r="11" stroke="__INK__" stroke-width="4"/><circle cx="78" cy="124" r="11" stroke="__INK__" stroke-width="4"/><circle cx="78" cy="144" r="11" stroke="__INK__" stroke-width="4"/>' +
      '<circle cx="162" cy="104" r="11" stroke="__INK__" stroke-width="4"/><circle cx="162" cy="124" r="11" stroke="__INK__" stroke-width="4"/><circle cx="162" cy="144" r="11" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M172 128 C176 136 174 142 168 144" stroke="__ACCENT__" stroke-width="4"/>',
  },
  BMLP: {
    back: '<circle cx="90" cy="70" r="10" stroke="__INK__" stroke-width="4"/><circle cx="110" cy="60" r="11" stroke="__INK__" stroke-width="4"/><circle cx="132" cy="60" r="11" stroke="__INK__" stroke-width="4"/><circle cx="150" cy="70" r="10" stroke="__INK__" stroke-width="4"/><circle cx="80" cy="88" r="9" stroke="__INK__" stroke-width="4"/><circle cx="160" cy="88" r="9" stroke="__INK__" stroke-width="4"/>',
    front: '<path d="M88 118 C88 156 104 178 120 178 C136 178 152 156 152 118" stroke="__INK__" stroke-width="5"/><path d="M104 130 C112 126 128 126 136 130" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M92 200 L108 176 M148 200 L132 176" stroke="__INK__" stroke-width="4"/>',
  },
  BMLR: {
    back: '',
    front: '<path d="M86 58 C94 42 146 42 154 58 C152 66 88 66 86 58 Z" stroke="__INK__" stroke-width="5"/>' +
      '<path d="M100 132 C104 148 112 156 120 156 C128 156 136 148 140 132" stroke="__INK__" stroke-width="4"/><path d="M108 128 C114 124 126 124 132 128" stroke="__INK__" stroke-width="4"/>' +
      '<path d="M94 170 C100 184 112 184 118 174 C122 184 136 184 144 170 C150 180 142 192 120 192 C98 192 88 180 94 170 Z" stroke="__INK__" stroke-width="4"/>',
  },
  BMEP: {
    back: '<path d="M84 104 C80 86 86 72 96 64" stroke="__INK__" stroke-width="5"/><path d="M156 104 C160 86 154 72 144 64" stroke="__INK__" stroke-width="5"/>',
    front: '<path d="M108 172 L104 190 L120 196 L136 190 L132 172" stroke="__INK__" stroke-width="4"/><path d="M120 196 L120 210" stroke="__ACCENT__" stroke-width="4"/>',
  },
  BMER: {
    back: '<path d="M84 106 C80 88 88 74 98 66" stroke="__INK__" stroke-width="5"/><path d="M156 106 C160 88 152 74 142 66" stroke="__INK__" stroke-width="5"/>',
    front: '<path d="M108 128 C114 124 126 124 132 128" stroke="__INK__" stroke-width="4"/><path d="M113 134 C116 146 124 146 127 134" stroke="__INK__" stroke-width="4"/>' +
      '<circle cx="158" cy="116" r="4" stroke="__ACCENT__" stroke-width="3"/>' +
      '<path d="M94 170 C100 184 112 184 118 174 C122 184 136 184 144 170 C150 180 142 192 120 192 C98 192 88 180 94 170 Z" stroke="__INK__" stroke-width="4"/>',
  },
};

// 生成某型的线描插画 SVG 字符串（颜色已按小程序主题固化）
function personaFigureSvg(code) {
  const part = FIGURE_PARTS[code];
  if (!part) {
    return '';
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    FIGURE_FRAME + (part.back || '') + FIGURE_HEAD + (part.front || '') +
    '</svg>';
  return svg.replace(/__INK__/g, INK).replace(/__ACCENT__/g, ACCENT);
}

// ASCII base64（小程序无 btoa；SVG 内容均为 ASCII，直接按字节编码）
function base64Encode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < str.length; i += 3) {
    const c1 = str.charCodeAt(i);
    const c2 = i + 1 < str.length ? str.charCodeAt(i + 1) : -1;
    const c3 = i + 2 < str.length ? str.charCodeAt(i + 2) : -1;
    out += chars[c1 >> 2];
    out += chars[((c1 & 3) << 4) | (c2 === -1 ? 0 : c2 >> 4)];
    out += c2 === -1 ? '=' : chars[((c2 & 15) << 2) | (c3 === -1 ? 0 : c3 >> 6)];
    out += c3 === -1 ? '=' : chars[c3 & 63];
  }
  return out;
}

// 转为可直接给 <image src> 的 Data URI
function personaFigureDataUri(code) {
  const svg = personaFigureSvg(code);
  return svg ? 'data:image/svg+xml;base64,' + base64Encode(svg) : '';
}

module.exports = {
  personaFigureSvg,
  personaFigureDataUri,
};
