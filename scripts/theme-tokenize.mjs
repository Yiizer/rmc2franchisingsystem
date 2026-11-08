// Dark mode (pilot plan 2026-11-16, item 8). Moves every hardcoded colour in app/*.css to a token and writes the dark set.
//
//   node scripts/theme-tokenize.mjs          rewrite app/*.css and regenerate app/operations-theme-dark.css
//   node scripts/theme-tokenize.mjs --check  exit 1 if any CSS file still has an untokenised colour (nothing is written)
//
// Each colour becomes var(--dk-<role>-<hex>,<the original colour>). Light mode therefore keeps exactly the colours it had:
// the --dk-* variables exist only under :root[data-theme="dark"]. The role comes from the property the colour is used in
// (text, background, line or shadow), so one light colour can have a different dark value as text and as a background.
// Dark values are derived in OKLCH: light backgrounds become dark surfaces with the same hue, dark text becomes light
// text, accent fills (buttons, the navy sidebar) keep their colour. Hand-tuned values go in OVERRIDES below.
// Documents, the PDF viewer and other "paper" areas (KEEP_LIGHT) reset every --dk-* variable so they stay light.
// The script is idempotent: run it again after adding CSS with raw colours.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const APP = 'app', OUT = path.join(APP, 'operations-theme-dark.css');
const check = process.argv.includes('--check');
const files = readdirSync(APP).filter(f => f.endsWith('.css') && f !== path.basename(OUT)).sort();

/** Paper-like areas that must stay light in dark mode: proposal documents, PDFs, spreadsheets, email previews. */
export const KEEP_LIGHT = ['.ops-keep-light', '.ops-doc-paper', '.ops-doc-page', '.ops-saved-pdf-pages', '.ops-pdf-preview', '.ops-submitted-pdf', '.ops-sheet-viewport', '.ops-et-preview'];
/** Hand-tuned dark values, keyed by variable name. */
const OVERRIDES = {
  '--dk-bg-f5f7fc': '#0f1622', '--dk-bg-f7f8fc': '#0f1622', '--dk-bg-f5f7fa': '#0f1622', // page canvas
  '--dk-bg-ffffff': '#172131', // cards and surfaces
};

/** Hand-written dark rules for places where the colour alone does not say enough (dark text on a bright fill). */
const FIXES = `
/* Counts on bright orange keep their dark text. */
:root[data-theme=dark] .ops-nav-count{color:#172d4a}
/* Navy-filled selected states would sink into dark cards (the sidebar keeps its navy). */
:root[data-theme=dark] :is(.ops-oc-filters .dir-filter.is-active,.pd-segment button.is-active,.ops-workspace-redesign .ops-template-card-actions .ops-select-template:not(.is-selected)){background:#2c4a7c;border-color:#4d6ea6}
`;

// ---------- colour maths (sRGB <-> OKLCH) ----------
const toLin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
function rgbToOklch([r, g, b]) {
  [r, g, b] = [r, g, b].map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
function oklchToRgbRaw([L, C, H]) {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(toGam);
}
/** OKLCH to sRGB, lowering chroma until the colour fits. */
function oklchToRgb([L, C, H]) {
  L = Math.min(1, Math.max(0, L));
  let lo = 0, hi = C, rgb = oklchToRgbRaw([L, C, H]);
  const fits = v => v.every(x => x >= -0.0005 && x <= 1.0005);
  if (!fits(rgb)) { for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (fits(oklchToRgbRaw([L, mid, H]))) lo = mid; else hi = mid; } rgb = oklchToRgbRaw([L, lo, H]); }
  return rgb.map(x => Math.min(1, Math.max(0, x)));
}
const hex2 = x => Math.round(x * 255).toString(16).padStart(2, '0');
const toHex = (rgb, alpha = 1) => '#' + rgb.map(hex2).join('') + (alpha < 1 ? hex2(alpha) : '');
function parseHex(h) {
  h = h.slice(1).toLowerCase();
  if (h.length <= 4) h = [...h].map(c => c + c).join('');
  const n = [0, 2, 4, 6].map(i => i < h.length ? parseInt(h.slice(i, i + 2), 16) / 255 : 1);
  return { rgb: n.slice(0, 3), alpha: n[3], key: h };
}

// ---------- dark mapping by role ----------
const mapText = ([L, C, H]) => L >= 0.75 ? [L, C, H] : [0.95 - 0.4 * L, Math.min(C, 0.13), H];
function mapBg([L, C, H], alpha) {
  if (alpha < 1 && L < 0.5) return alpha >= 0.4 ? { lch: [L * 0.6, C, H], alpha } : { lch: [1, 0, 0], alpha: Math.min(1, alpha * 0.9) }; // backdrop stays dark; faint darkening overlays become faint lightening ones
  if (L >= 0.8) {
    if (C < 0.012 && L >= 0.965 && L < 0.99) return { lch: [0.17, C, H], alpha };
    return { lch: [0.215 + (1 - L) * 0.55, Math.min(C * 1.4, 0.06), H], alpha };
  }
  if (L >= 0.5 && C < 0.04) return { lch: [0.3 + (0.8 - L) * 0.3, C, H], alpha };
  return { lch: [L, C, H], alpha };
}
const mapLine = ([L, C, H]) => L >= 0.8 ? [0.3 + (1 - L) * 0.6, Math.min(C * 1.2, 0.05), H] : mapText([L, C, H]);
function darkValue(role, color) {
  const { rgb, alpha } = parseHex(color), lch = rgbToOklch(rgb);
  if (role === 'text') return toHex(oklchToRgb(mapText(lch)), alpha);
  if (role === 'line') return toHex(oklchToRgb(mapLine(lch)), alpha);
  if (role === 'shadow') return alpha < 1 ? toHex([0, 0, 0], Math.min(0.7, alpha * 3)) : toHex(oklchToRgb(mapLine(lch)));
  const bg = mapBg(lch, alpha); return toHex(oklchToRgb(bg.lch), bg.alpha);
}

// ---------- roles ----------
function propRole(prop) {
  if (prop.startsWith('--')) {
    if (/foreground|fg$|-ink|ink$|text|number|dot|idle|received|declined|sent$|handling|head-ink/.test(prop)) return 'text';
    if (/shadow/.test(prop)) return 'shadow';
    if (/border|line|rule|ring|input|accent$/.test(prop) && !/^--accent$/.test(prop)) return 'line';
    if (/bg|background|tint|fill|surface|canvas|card|popover|track|hover|^--secondary$|^--muted$|^--accent$|^--sidebar(-accent)?$|^--primary$|^--destructive$/.test(prop)) return 'bg';
    return undefined; // decided by lightness
  }
  if (/^(color|fill|stroke|caret-color|-webkit-text-fill-color|text-decoration(-color)?|text-emphasis-color)$/.test(prop)) return 'text';
  if (/^(border|outline|column-rule|scrollbar-color)/.test(prop)) return 'line';
  if (/^(box-shadow|text-shadow|filter|drop-shadow)$/.test(prop)) return 'shadow';
  if (/^(background|stop-color|flood-color)/.test(prop)) return 'bg';
  return null; // other properties (accent-color, content, ...) are left as is
}
const lightness = color => rgbToOklch(parseHex(color).rgb)[0];

// ---------- tokens (--ops-* and the shadcn set) used in a second role ----------
const tokenValues = {};
for (const file of files) for (const m of readFileSync(path.join(APP, file), 'utf8').matchAll(/:root\s*\{([^}]*)\}/g)) for (const d of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/g)) tokenValues[d[1]] = d[2].trim();
const resolveToken = (name, seen = 0) => { let v = tokenValues[name]; if (!v || seen > 5) return undefined; const wrapped = /^var\(--dk-[a-z]+-[0-9a-f]+,(#[0-9a-f]+)\)$/i.exec(v); if (wrapped) return wrapped[1]; if (/^#[0-9a-f]{3,8}$/i.test(v)) return v; const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v) || /^var\(--dk-[a-z]+--[a-z0-9-]+,var\((--[a-z0-9-]+)\)\)$/.exec(v); return ref ? resolveToken(ref[1], seen + 1) : undefined; };
const tokenRole = name => { const v = resolveToken(name); return propRole(name) ?? (v && lightness(v) < 0.6 ? 'text' : 'bg'); };
const compatible = (a, b) => a === b || (a !== 'bg' && b !== 'bg');

// ---------- rewrite ----------
const vars = new Map(); // --dk-* name -> dark value
const tokenUses = new Map(); // --dk-<role>-<token> -> dark value
let untouched = 0, changed = 0;
const COLOR = /url\([^)]*\)|var\(--dk-(?:bg|text|line|shadow)-[0-9a-f]+,(#[0-9a-f]{3,8})\)|var\(--dk-(?:bg|text|line|shadow)--[a-z0-9-]+,var\((--[a-z0-9-]+)\)\)|(#[0-9a-fA-F]{8}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3,4})\b|\b(white|black)\b|rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)|var\((--(?:ops-[a-z0-9-]+|background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|sidebar[a-z-]*))\)/g;

function rewriteValue(prop, value) {
  const role0 = propRole(prop);
  if (role0 === null) return value;
  return value.replace(COLOR, (whole, wrappedHex, wrappedToken, hex, named, r, g, b, a, token) => {
    if (whole.startsWith('url(')) return whole;
    let color = wrappedHex || hex;
    if (named) color = named === 'white' ? '#ffffff' : '#000000';
    if (r !== undefined) { const alpha = a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a); color = toHex([r, g, b].map(x => Number(x) / 255), alpha); }
    const tok = token || wrappedToken;
    if (tok) {
      if (prop === tok) return whole; // a token's own definition
      const role = role0 ?? 'text', own = tokenRole(tok), light = resolveToken(tok);
      if (!light || compatible(role, own)) return whole;
      const name = `--dk-${role}${tok}`; tokenUses.set(name, darkValue(role, light));
      return `var(${name},var(${tok}))`;
    }
    if (!color) throw new Error('No colour in ' + JSON.stringify(whole) + ' for ' + prop);
    const { key } = parseHex(color), role = role0 ?? (lightness(color) < 0.6 ? 'text' : 'bg');
    const name = `--dk-${role}-${key}`;
    vars.set(name, OVERRIDES[name] || darkValue(role, color));
    if (!wrappedHex) untouched++;
    return `var(${name},${'#' + key})`;
  });
}

/** Walks declarations (prop:value up to ; or }), skipping comments and strings. */
function rewriteCss(css) {
  let out = '', i = 0, start = 0, depth = 0;
  const flush = end => { const seg = css.slice(start, end), m = /^(\s*)([-a-zA-Z0-9]+)(\s*:)([\s\S]*)$/.exec(seg); out += m && depth > 0 ? m[1] + m[2] + m[3] + rewriteValue(m[2].toLowerCase(), m[4]) : seg; start = end; };
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { flush(i); const e = css.indexOf('*/', i + 2); i = e < 0 ? css.length : e + 2; out += css.slice(start, i); start = i; continue; }
    if (c === '"' || c === "'") { const e = css.indexOf(c, i + 1); i = e < 0 ? css.length : e + 1; continue; }
    if (c === '{') { out += css.slice(start, i + 1); start = i + 1; depth++; }
    else if (c === '}') { flush(i); out += '}'; start = i + 1; depth = Math.max(0, depth - 1); }
    else if (c === ';') { flush(i); out += ';'; start = i + 1; }
    i++;
  }
  flush(css.length);
  return out;
}

for (const file of files) {
  const full = path.join(APP, file), css = readFileSync(full, 'utf8'), next = rewriteCss(css);
  if (next !== css) { changed++; if (!check) writeFileSync(full, next); }
}
if (check) { console.log(untouched ? `${untouched} colours are not tokenised yet in ${changed} file(s). Run node scripts/theme-tokenize.mjs.` : 'All colours are tokenised.'); process.exit(untouched ? 1 : 0); }

// ---------- dark stylesheet ----------
const lightTokens = Object.entries(tokenValues).filter(([name]) => resolveToken(name)).map(([name]) => `${name}:${resolveToken(name)}`);
const dark = [...vars, ...tokenUses].sort(([a], [b]) => a.localeCompare(b));
const css = `/* GENERATED by scripts/theme-tokenize.mjs. Do not edit by hand: change OVERRIDES in the script and run it again.
   Dark theme (pilot plan item 8). Light mode never reads these: every colour in app/*.css falls back to its light value. */
:root[data-theme=dark]{color-scheme:dark;
${dark.map(([name, value]) => name + ':' + value).join(';\n')}}
/* Paper stays light: proposal documents, PDFs, spreadsheets and email previews. */
:root[data-theme=dark] :is(${KEEP_LIGHT.join(',')}){color-scheme:light;color:#21344e;
${dark.map(([name]) => name + ':initial').join(';')};
${lightTokens.join(';')}}
/* Hand-written fixes (FIXES in the script). */${FIXES}`;
writeFileSync(OUT, css);
console.log(`Tokenised ${untouched} colours in ${changed} files; ${vars.size} colour tokens and ${tokenUses.size} second-role token uses written to ${OUT}.`);
