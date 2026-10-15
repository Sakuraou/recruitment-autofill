const functions = new Set(['rgb','rgba','hsl','hsla','hwb','lab','lch','oklab','oklch','color']);
const spaces = new Set(['srgb','srgb-linear','display-p3','a98-rgb','prophoto-rgb','rec2020','xyz','xyz-d50','xyz-d65']);
/** Only native computed colors. This returns alpha, not a capture permission.
 * Keep exact alpha: an 8-bit canvas pixel may round 0.9999 up to 255.
 */
export function computedColorAlpha(color: string): number | undefined {
  if (color === 'transparent') return 0;
  const legacy=/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*((?:\d+(?:\.\d*)?|\.\d+)))?\s*\)$/u.exec(color);
  if (legacy) {
    const value=legacy[1] === undefined ? 1 : Number(legacy[1]);
    return value>=0 && value<=1 ? value : undefined;
  }
  const parsed=/^([a-z]+)\(([^()]*)\)$/u.exec(color);
  if (!parsed || !functions.has(parsed[1]!) || /\b(?:none|from)\b/u.test(parsed[2]!)) return undefined;
  try { if (!CSS.supports('color',color)) return undefined; } catch { return undefined; }
  const body=parsed[2]!.trim();
  if (parsed[1] === 'color' && !spaces.has(body.split(/\s+/u)[0]!)) return undefined;
  let alpha: string | undefined;
  if (body.includes(',')) {
    if (!['rgb','rgba','hsl','hsla'].includes(parsed[1]!)) return undefined;
    const components=body.split(','); if (components.length !== 3 && components.length !== 4) return undefined;
    alpha=components[3]?.trim();
  } else {
    const components=body.split('/'); if (components.length > 2) return undefined;
    alpha=components[1]?.trim();
  }
  if (alpha === undefined) return 1;
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/u.test(alpha)) return undefined;
  const value=Number(alpha.replace(/%$/u,''))/(alpha.endsWith('%')?100:1);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}
