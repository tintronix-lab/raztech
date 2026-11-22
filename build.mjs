// Builds the translated pages.
//
// English is the source: index.html is written and edited by hand and is published as it is.
// Every other language is generated from it. The script takes each piece of text in
// index.html, looks it up in i18n/<language>.json and writes <language>/index.html.
//
//   node build.mjs           writes the translated pages, and the language menu into index.html
//   node build.mjs --check   verifies the translations and that the pages are up to date
//   node build.mjs --keys    prints every piece of text a translation file must contain
//
// A translation file maps the English text, exactly as it stands in index.html, to its
// translation. Change an English sentence and its translation no longer matches: the
// build stops and names it, so a page can never ship half translated.
// No dependencies. Needs Node 20 or later.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://raztech.duckdns.org/';
const SOURCE = 'index.html';

/**
 * The languages in the menu, in menu order: code, own name, the folder its page is in
 * ('' is the site root) and the word for "language" used to label the menu.
 * Each needs a flag: a <symbol id="flag-<code>"> in index.html.
 */
const MENU = [
  { code: 'en', name: 'English', folder: '', label: 'Language' },
  { code: 'sv', name: 'Svenska', folder: 'sv/', label: 'Språk' },
];

/** The language menu as it appears on the page written in `current`. No script: a <details>. */
function languageMenu(current) {
  const here = MENU.find((language) => language.code === current);
  const up = here.folder ? '../' : '';
  const flag = (code) => `<svg class="flag" aria-hidden="true" focusable="false"><use href="#flag-${code}"/></svg>`;
  const items = MENU.map((language) => {
    const isCurrent = language.code === current;
    const href = isCurrent ? '#top' : up + language.folder || './';
    const state = isCurrent ? ' aria-current="true"' : '';
    return `            <li><a href="${href}" lang="${language.code}" hreflang="${language.code}"${state}>${flag(language.code)}${language.name}</a></li>`;
  });
  return [
    '<details class="lang">',
    `          <summary aria-label="${here.label}: ${here.name}">${flag(here.code)}<span>${here.code.toUpperCase()}</span><svg class="lang__caret" viewBox="0 0 10 6" aria-hidden="true" focusable="false"><path d="m1 1 4 4 4-4"/></svg></summary>`,
    '          <ul class="lang__menu">',
    ...items,
    '          </ul>',
    '        </details>',
  ].join('\n');
}

/** The menu sits between these two comments in index.html and is written by this script. */
const MENU_SLOT = /(<!-- lang:start -->)[\s\S]*?(<!-- lang:end -->)/;
const withMenu = (html, language) => html.replace(MENU_SLOT, `$1\n        ${languageMenu(language)}\n        $2`);

/**
 * What differs per language besides the text. Each `swap` replaces one exact piece of the
 * English page and must match exactly once, so a change to index.html that breaks one is caught.
 */
const LANGUAGES = {
  sv: {
    swaps: [
      ['<html lang="en">', '<html lang="sv">'],
      [`<link rel="canonical" href="${SITE}">`, `<link rel="canonical" href="${SITE}sv/">`],
      [`<meta property="og:url" content="${SITE}">`, `<meta property="og:url" content="${SITE}sv/">`],
      ['<meta property="og:locale" content="en_US">', '<meta property="og:locale" content="sv_SE">'],
      ['<meta property="og:locale:alternate" content="sv_SE">', '<meta property="og:locale:alternate" content="en_US">'],
      [`content="${SITE}assets/share.png"`, `content="${SITE}assets/share-sv.png"`],
      ['?subject=Project%20inquiry', '?subject=Projektf%C3%B6rfr%C3%A5gan'],
      // 360Maps has its Swedish site at the root and its English one under en/.
      ['href="https://tintronix-lab.github.io/360Maps/en/"', 'href="https://tintronix-lab.github.io/360Maps/"'],
    ],
  },
};

/** Comments, scripts, styles and tags; everything between two of these is text. */
const MARKUP = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]+>/g;
/** Attributes whose value is read by people. */
const TEXT_ATTRIBUTES = /\b(aria-label|alt|title)="([^"]+)"/g;
/** Meta tags whose content is read by people. */
const TEXT_META = /^<meta\s+(?:name="description"|property="og:(?:title|description|site_name)")\s+content="([^"]*)"/;
/** Fields of the structured data that are read by people. */
const TEXT_FIELDS = ['description'];
const STRUCTURED_DATA = /^(<script type="application\/ld\+json">)([\s\S]*)(<\/script>)$/;

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * Walks the page and passes every piece of text to `translate`, which returns its replacement.
 * Returns the rebuilt page. The same walk collects the keys and applies a translation.
 */
function walk(html, translate) {
  let out = '';
  let last = 0;
  // The language menu is written whole for each language, so its own text is not translated.
  let insideSwitch = false;

  const text = (segment) => {
    if (insideSwitch || !/\S/.test(segment)) return segment;
    const [, lead, body, trail] = segment.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return lead + translate(normalize(body)) + trail;
  };

  const markup = (token) => {
    if (token === '<!-- lang:start -->') {
      insideSwitch = true;
      return token;
    }
    if (insideSwitch) {
      if (token === '<!-- lang:end -->') insideSwitch = false;
      return token;
    }
    const data = token.match(STRUCTURED_DATA);
    if (data) {
      const json = JSON.parse(data[2]);
      for (const field of TEXT_FIELDS) if (field in json) json[field] = translate(json[field]);
      const body = JSON.stringify(json, null, 2).replace(/^/gm, '  ');
      return `${data[1]}\n${body}\n  ${data[3]}`;
    }
    if (token.startsWith('<!--') || token.startsWith('<script') || token.startsWith('<style')) return token;
    const meta = token.match(TEXT_META);
    if (meta) return token.replace(`content="${meta[1]}"`, `content="${translate(meta[1])}"`);
    return token.replace(TEXT_ATTRIBUTES, (_, name, value) => `${name}="${translate(value)}"`);
  };

  for (const match of html.matchAll(MARKUP)) {
    out += text(html.slice(last, match.index)) + markup(match[0]);
    last = match.index + match[0].length;
  }
  return out + text(html.slice(last));
}

/** Every piece of text in the page, in order, once each. */
function keysOf(html) {
  const keys = new Set();
  walk(html, (key) => (keys.add(key), key));
  return [...keys];
}

/** A translated page sits one folder down, so its links to local files go one level up. */
const relink = (html) =>
  html.replace(/\b(href|src)="(?!https?:|mailto:|#|\/|\.\.\/)([^"]+)"/g, (_, name, path) => `${name}="../${path}"`);

function build(language, { swaps }, source, problems) {
  const file = join(ROOT, 'i18n', `${language}.json`);
  if (!existsSync(file)) {
    problems.push(`${language}: i18n/${language}.json is missing`);
    return null;
  }
  const strings = JSON.parse(readFileSync(file, 'utf8'));
  const keys = keysOf(source);

  for (const key of keys) if (!(key in strings)) problems.push(`${language}: no translation for "${key}"`);
  for (const key of Object.keys(strings)) {
    if (!keys.includes(key)) problems.push(`${language}: "${key}" is no longer on the page; remove it or update it`);
  }

  let page = source;
  for (const [from, to] of swaps) {
    const count = page.split(from).length - 1;
    if (count !== 1) problems.push(`${language}: expected to find ${from} once in ${SOURCE}, found it ${count} times`);
    page = page.replace(from, to);
  }
  return relink(walk(withMenu(page, language), (key) => strings[key] ?? key));
}

const mode = process.argv[2];
const written = readFileSync(join(ROOT, SOURCE), 'utf8');
// The English page gets its language menu from this script too, so every page has the same one.
const source = withMenu(written, 'en');

if (mode === '--keys') {
  console.log(JSON.stringify(Object.fromEntries(keysOf(source).map((key) => [key, ''])), null, 2));
  process.exit(0);
}

const problems = [];
if (!MENU_SLOT.test(written)) problems.push(`${SOURCE}: the "lang:start" and "lang:end" comments are missing`);
if (source !== written) {
  if (mode === '--check') problems.push(`${SOURCE}: the language menu is out of date; run "node build.mjs"`);
  else {
    writeFileSync(join(ROOT, SOURCE), source);
    console.log(`Updated the language menu in ${SOURCE}`);
  }
}
for (const file of existsSync(join(ROOT, 'i18n')) ? readdirSync(join(ROOT, 'i18n')) : []) {
  const language = file.replace(/\.json$/, '');
  if (!(language in LANGUAGES)) problems.push(`i18n/${file} has no entry in LANGUAGES in build.mjs`);
}

for (const [language, settings] of Object.entries(LANGUAGES)) {
  const page = build(language, settings, source, problems);
  if (page === null) continue;
  const target = join(ROOT, language, 'index.html');
  if (mode === '--check') {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current !== page) problems.push(`${language}/index.html is out of date; run "node build.mjs"`);
  } else if (problems.length === 0) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, page);
    console.log(`Wrote ${language}/index.html`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
if (mode === '--check') console.log('Translations are complete and the pages are up to date.');
