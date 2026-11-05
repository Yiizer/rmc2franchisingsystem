// Divisions and branches (phase 3, PO list of 2026-11-05). Pure and client-safe: no database imports.
//
// The table is editable by the Head (stored in settings key 'division_table'). Old directory records only have free-text
// branch values ("DIV IV / Antipolo", "Antipolo | Division 4", "Cebu"), so classifyBranch() maps that text to a division
// and branch with TODAY's table (PO decision); the original text is always kept and shown beside it. Anything unclear goes
// to "Unassigned" until the client answers (see DEMO_FEEDBACK_PLAN.md, "Questions to send the client").

export type BranchEntry = { name: string; aliases: string[] };
export type DivisionEntry = { name: string; branches: BranchEntry[]; divisionAliases: string[] };
export type DivisionTable = { divisions: DivisionEntry[]; updatedAt?: string; updatedBy?: string };
export const UNASSIGNED = 'Unassigned';

export const DEFAULT_DIVISION_TABLE: DivisionTable = { divisions: [
  { name: 'Division 1', divisionAliases: ['cebu', 'cebu city'], branches: [
    { name: 'Tanauan', aliases: ['tanauan', 'tananuan', 'tanauan batangas'] },
    { name: 'Cebu Mandaue', aliases: ['cebu mandaue', 'mandaue', 'mandaue city'] },
    { name: 'Cebu APM Centrale', aliases: ['cebu apm centrale', 'apm centrale', 'cebu apm', 'apm'] },
  ] },
  { name: 'Division 2', divisionAliases: [], branches: [
    { name: 'Baguio', aliases: ['baguio', 'baguio city'] },
    { name: 'Baliwag Bulacan', aliases: ['baliwag bulacan', 'baliuag bulacan', 'baliwag', 'baliuag'] },
    { name: 'Valenzuela', aliases: ['valenzuela', 'valenzuela city'] },
    { name: 'Ilagan Isabela', aliases: ['ilagan isabela', 'ilagan', 'isabela'] },
  ] },
  { name: 'Division 3', divisionAliases: [], branches: [
    { name: 'Cainta', aliases: ['cainta', 'cainta rizal'] },
  ] },
  { name: 'Division 4', divisionAliases: ['lipa', 'lipa city'], branches: [
    { name: 'Antipolo', aliases: ['antipolo', 'antipolio', 'antipolo city'] },
    { name: 'Taytay', aliases: ['taytay', 'taytay rizal'] },
    { name: 'Lipa 1', aliases: ['lipa 1', 'lipa i', 'lipa city 1'] },
    { name: 'Lipa 2', aliases: ['lipa 2', 'lipa ii', 'lipa city 2'] },
    { name: 'La Union', aliases: ['la union', 'launion'] },
  ] },
  { name: 'Division 5', divisionAliases: [], branches: [
    { name: 'Quezon City', aliases: ['quezon city', 'qc', 'q c', 'quezon'] },
    { name: 'Cubao', aliases: ['cubao'] },
  ] },
  { name: 'Division 6', divisionAliases: [], branches: [] },
  { name: 'Division 7', divisionAliases: [], branches: [
    { name: 'Bicol Region', aliases: ['bicol region', 'bicol'] },
  ] },
] };

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };
/** Lower case, punctuation to spaces, single spaces. "La-Union" → "la union", "Q.C." → "q c". */
export const normalizePlace = (text: string) => (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const plain = (token: string) => token.replace(/\b(branch|office|area|team)\b/g, ' ').replace(/\s+/g, ' ').trim();
const LABEL = /\bdiv(?:ision)?[.\s-]*(vii|vi|iv|v|iii|ii|i|[1-7])\b/g;

export type BranchClass = {
  division: string;                 // 'Division 1'…'Division 7' or UNASSIGNED
  branch: string | null;            // a branch of that division, or null when only the division is known
  basis: 'branch' | 'division-alias' | 'label' | 'conflict' | 'unknown' | 'blank';
  labelMismatch?: boolean;          // the text names another division than its branch belongs to (today's table wins)
  unknownPlaces?: string[];         // words that matched nothing (e.g. "laguna" in "Tanauan-Laguna"), for review
};
type Hit = { division: string; branch: string | null };
function lookup(phrase: string, table: DivisionTable): Hit | undefined {
  for (const division of table.divisions)
    for (const branch of division.branches)
      if (normalizePlace(branch.name) === phrase || branch.aliases.some(alias => normalizePlace(alias) === phrase)) return { division: division.name, branch: branch.name };
  for (const division of table.divisions) if (division.divisionAliases.some(alias => normalizePlace(alias) === phrase)) return { division: division.name, branch: null };
  return undefined;
}
/** Longest-first word matching inside one token: "cebu tanauan" → Cebu, Tanauan; "la union" stays one place. */
function matchWords(token: string, table: DivisionTable): { hits: Hit[]; unknown: string[] } {
  const words = token.split(' ').filter(Boolean), hits: Hit[] = [], unknown: string[] = [];
  let i = 0;
  while (i < words.length) {
    let matched = 0;
    for (let n = Math.min(4, words.length - i); n >= 1 && !matched; n--) { const hit = lookup(words.slice(i, i + n).join(' '), table); if (hit) { hits.push(hit); matched = n; } }
    if (!matched) { if (!/^(div|division|of|the|city|branch|office|area|team)$/.test(words[i])) unknown.push(words[i]); i++; } else i += matched;
  }
  return { hits, unknown };
}

/** Maps free-text branch/division text to today's table. Never guesses between divisions. */
export function classifyBranch(text: string, table: DivisionTable = DEFAULT_DIVISION_TABLE): BranchClass {
  if (!normalizePlace(text)) return { division: UNASSIGNED, branch: null, basis: 'blank' };
  const labels = new Set<string>();
  const lower = (text || '').toLowerCase().replace(LABEL, (_m, n: string) => { const num = ROMAN[n] ?? Number(n); if (num >= 1 && num <= 7) labels.add('Division ' + num); return ' | '; });
  // Split multi-branch text: "Cebu | Tanauan", "Antipolo/T1", "Tanauan Branch and Lipa 1"; words inside a token are matched longest-first.
  const tokens = lower.split(/[|/,;&+()]|\band\b|\s-\s/).map(normalizePlace).map(plain).filter(Boolean);
  const found: Hit[] = [], unknown: string[] = [];
  for (const token of tokens) { const whole = lookup(token, table); if (whole) { found.push(whole); continue; } const part = matchWords(token, table); found.push(...part.hits); unknown.push(...part.unknown); }
  const extra = unknown.length ? { unknownPlaces: [...new Set(unknown)] } : {};
  const divisions = [...new Set(found.map(item => item.division))];
  if (divisions.length > 1) return { division: UNASSIGNED, branch: null, basis: 'conflict', ...extra };
  if (divisions.length === 1) {
    const branches = [...new Set(found.map(item => item.branch).filter((b): b is string => !!b))];
    const division = divisions[0];
    return { division, branch: branches.length === 1 ? branches[0] : null, basis: branches.length ? 'branch' : 'division-alias', ...(labels.size && !labels.has(division) ? { labelMismatch: true } : {}), ...extra };
  }
  // No known place: a lone division label settles it ("Division 6"); unknown places ("Tacloban", "T1") or several labels do not.
  if (labels.size === 1 && !unknown.length) return { division: [...labels][0], branch: null, basis: 'label' };
  return { division: UNASSIGNED, branch: null, basis: 'unknown', ...extra };
}

/** Directory category from the register sheet the record came from. */
export const CATEGORIES = ['AMAPHIL', 'Division sheets', 'IWC', 'SOA / MOA', 'Logistics', 'Customized proposals', 'Generated MOAs', 'Completed accounts', 'Other'] as const;
export type Category = typeof CATEGORIES[number];
export function categoryForSheet(sheet: string): Category {
  const s = (sheet || '').trim().toUpperCase();
  if (s.startsWith('SOAMOA')) return 'SOA / MOA';
  if (s.startsWith('DIVISION')) return 'Division sheets';
  if (s === 'AMAPHIL') return 'AMAPHIL';
  if (s === 'IWC') return 'IWC';
  if (s === 'LOGISTICS') return 'Logistics';
  if (s.startsWith('CUSTOMIZED')) return 'Customized proposals';
  if (s.startsWith('GENERATED')) return 'Generated MOAs';
  if (s.startsWith('LIST OF COMPLETED')) return 'Completed accounts';
  return 'Other';
}

/** Validation-friendly shape check (used by the store before saving an edited table). */
export function divisionTableProblems(table: DivisionTable): string[] {
  const problems: string[] = [], branchNames = new Set<string>(), aliases = new Map<string, string>();
  if (!table.divisions.length) problems.push('Add at least one division.');
  for (const division of table.divisions) {
    if (!division.name.trim()) problems.push('Every division needs a name.');
    for (const branch of division.branches) {
      const key = normalizePlace(branch.name);
      if (!key) problems.push('Every branch in ' + division.name + ' needs a name.');
      if (branchNames.has(key)) problems.push('"' + branch.name + '" is listed twice.');
      branchNames.add(key);
      for (const alias of [key, ...branch.aliases.map(normalizePlace)]) {
        const owner = aliases.get(alias);
        if (owner && owner !== branch.name) problems.push('"' + alias + '" points to both ' + owner + ' and ' + branch.name + '.');
        aliases.set(alias, branch.name);
      }
    }
    for (const alias of division.divisionAliases.map(normalizePlace)) {
      if (aliases.has(alias)) problems.push('"' + alias + '" is both a branch spelling and a division spelling.');
    }
  }
  return [...new Set(problems)];
}
