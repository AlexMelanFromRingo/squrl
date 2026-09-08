// The vocabularies.
//
// Entropy coding shrinks what is unusual about a URL; a dictionary deletes
// what is not unusual at all. "github.com" is nine bits here instead of eighty,
// and "utm_source" is eight instead of eighty.
//
// These lists are curated rather than scraped -- a scraped top-million list
// would be mostly domains nobody in this project's world links to, and every
// entry costs index width for the ones that matter. Replace them with your own
// traffic and retrain: tools/train.mjs reads a corpus and rewrites src/prior.js
// so the probabilities follow the vocabulary.
//
// Order is not load-bearing (the trained prior decides what is cheap), but the
// lists are kept roughly by frequency so a reader can see the intent.

/** Hosts stored whole, without any `www.` -- that prefix is one flag. */
export const HOSTS = [
  'youtube.com', 'youtu.be', 'google.com', 'github.com', 'wikipedia.org',
  'en.wikipedia.org', 'ru.wikipedia.org', 'uk.wikipedia.org',
  'twitter.com', 'x.com', 't.me', 'telegram.me', 'reddit.com',
  'stackoverflow.com', 'stackexchange.com', 'medium.com', 'dev.to',
  'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com',
  'amazon.com', 'amazon.de', 'ebay.com', 'aliexpress.com', 'alibaba.com',
  'docs.google.com', 'drive.google.com', 'mail.google.com', 'maps.google.com',
  'play.google.com', 'news.google.com', 'translate.google.com',
  'developer.mozilla.org', 'mozilla.org', 'npmjs.com', 'pypi.org',
  'crates.io', 'docs.rs', 'rust-lang.org', 'go.dev', 'pkg.go.dev',
  'nodejs.org', 'deno.land', 'python.org', 'docs.python.org',
  'news.ycombinator.com', 'lobste.rs', 'slashdot.org', 'arstechnica.com',
  'theverge.com', 'techcrunch.com', 'wired.com', 'bbc.com', 'bbc.co.uk',
  'cnn.com', 'nytimes.com', 'theguardian.com', 'reuters.com', 'apnews.com',
  'gitlab.com', 'bitbucket.org', 'sourceforge.net', 'codeberg.org',
  'gist.github.com', 'raw.githubusercontent.com', 'githubusercontent.com',
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev',
  'cloudflare.com', 'aws.amazon.com', 'console.aws.amazon.com',
  'azure.microsoft.com', 'cloud.google.com', 'digitalocean.com',
  'microsoft.com', 'docs.microsoft.com', 'learn.microsoft.com',
  'apple.com', 'developer.apple.com', 'support.apple.com',
  'openai.com', 'chat.openai.com', 'anthropic.com', 'claude.ai',
  'huggingface.co', 'kaggle.com', 'colab.research.google.com',
  'stackblitz.com', 'codesandbox.io', 'codepen.io', 'jsfiddle.net',
  'replit.com', 'glitch.com', 'observablehq.com',
  'imgur.com', 'i.imgur.com', 'flickr.com', 'unsplash.com', 'pexels.com',
  'giphy.com', 'tenor.com', 'pinterest.com', 'behance.net', 'dribbble.com',
  'twitch.tv', 'vimeo.com', 'dailymotion.com', 'rutube.ru',
  'soundcloud.com', 'spotify.com', 'open.spotify.com', 'bandcamp.com',
  'last.fm', 'genius.com', 'discogs.com',
  'steamcommunity.com', 'store.steampowered.com', 'epicgames.com',
  'itch.io', 'gog.com', 'minecraft.net', 'curseforge.com', 'modrinth.com',
  'discord.com', 'discord.gg', 'slack.com', 'notion.so', 'trello.com',
  'atlassian.net', 'jira.com', 'confluence.com', 'asana.com', 'linear.app',
  'figma.com', 'miro.com', 'canva.com', 'adobe.com',
  'dropbox.com', 'box.com', 'onedrive.live.com', 'mega.nz',
  'archive.org', 'web.archive.org', 'scholar.google.com', 'arxiv.org',
  'doi.org', 'researchgate.net', 'jstor.org', 'pubmed.ncbi.nlm.nih.gov',
  'nature.com', 'science.org', 'ieee.org', 'acm.org', 'springer.com',
  'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'duolingo.com',
  'leetcode.com', 'hackerrank.com', 'codewars.com', 'exercism.org',
  'yandex.ru', 'ya.ru', 'mail.ru', 'vk.com', 'ok.ru', 'dzen.ru',
  'habr.com', 'vc.ru', 'pikabu.ru', 'lenta.ru', 'rbc.ru', 'kommersant.ru',
  'avito.ru', 'ozon.ru', 'wildberries.ru', 'dns-shop.ru', 'citilink.ru',
  'sber.ru', 'tinkoff.ru', 'gosuslugi.ru', 'nalog.ru', 'cbr.ru',
  'kinopoisk.ru', 'ivi.ru', 'rutracker.org', '2ch.hk',
  'olx.ua', 'rozetka.com.ua', 'prom.ua', 'work.ua', 'robota.ua',
  'dou.ua', 'ain.ua', 'pravda.com.ua', 'unian.ua', 'liga.net',
  'privatbank.ua', 'monobank.ua', 'diia.gov.ua', 'gov.ua', 'kmu.gov.ua',
  'nau.edu.ua', 'knu.ua', 'lnu.edu.ua', 'kpi.ua',
  'ukr.net', 'i.ua', 'meta.ua', 'tsn.ua', 'obozrevatel.com',
  'booking.com', 'airbnb.com', 'tripadvisor.com', 'expedia.com',
  'uber.com', 'bolt.eu', 'glovoapp.com', 'wolt.com',
  'paypal.com', 'stripe.com', 'wise.com', 'revolut.com', 'binance.com',
  'coinbase.com', 'blockchain.com', 'etherscan.io', 'coinmarketcap.com',
  'example.com', 'example.org', 'localhost',
];

/**
 * Public suffixes, for hosts that are not in the list above.
 *
 * The longest match wins, so `co.uk` beats `uk`. Index 63 is reserved as an
 * escape: no suffix matched and the host is spelled out.
 */
export const TLDS = [
  'com', 'org', 'net', 'io', 'dev', 'app', 'co', 'me', 'info', 'biz',
  'ru', 'ua', 'de', 'fr', 'uk', 'co.uk', 'pl', 'cz', 'it', 'es', 'nl',
  'com.ua', 'org.ua', 'gov.ua', 'edu.ua', 'kiev.ua', 'in.ua',
  'com.br', 'com.au', 'co.jp', 'cn', 'jp', 'kr', 'in', 'tr', 'br',
  'eu', 'us', 'ca', 'ch', 'at', 'se', 'no', 'fi', 'dk', 'be',
  'ai', 'sh', 'gg', 'to', 'tv', 'cc', 'ly', 'gl', 'st', 'xyz',
  'online', 'site', 'tech', 'cloud', 'edu', 'gov', 'mil',
];

/**
 * Path segments and query keys and values, all from one vocabulary.
 *
 * Three separate probability trees index this array -- a word is likely in a
 * path and unlikely as a query key, and the trained prior knows the difference
 * without the list having to be written out three times.
 */
export const WORDS = [
  // structure
  'index.html', 'index.php', 'index', 'home', 'main', 'master', 'default',
  'api', 'v1', 'v2', 'v3', 'docs', 'doc', 'documentation', 'help', 'support',
  'about', 'contact', 'blog', 'news', 'post', 'posts', 'article', 'articles',
  'page', 'pages', 'search', 'tag', 'tags', 'category', 'categories',
  'user', 'users', 'profile', 'account', 'settings', 'login', 'logout',
  'signup', 'register', 'auth', 'oauth', 'callback', 'download', 'downloads',
  'file', 'files', 'image', 'images', 'img', 'static', 'assets', 'media',
  'video', 'videos', 'watch', 'embed', 'player', 'stream', 'live',
  'product', 'products', 'item', 'items', 'catalog', 'shop', 'store', 'cart',
  'checkout', 'order', 'orders', 'payment', 'price', 'pricing', 'plans',
  // code hosting
  'issues', 'issue', 'pull', 'pulls', 'commit', 'commits', 'blob', 'tree',
  'releases', 'release', 'branches', 'wiki', 'actions', 'projects',
  'raw', 'archive', 'compare', 'discussions', 'packages', 'graphs',
  'src', 'lib', 'test', 'tests', 'examples', 'README.md', 'LICENSE',
  'package.json', 'Cargo.toml', 'go.mod', 'requirements.txt',
  // documents and media
  'pdf', 'html', 'htm', 'json', 'xml', 'csv', 'txt', 'zip', 'tar.gz',
  'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'mp4', 'mp3',
  // query keys
  'q', 's', 'p', 'v', 't', 'id', 'ids', 'key', 'lang', 'locale', 'hl', 'gl',
  'per_page', 'limit', 'offset', 'sort', 'direction', 'filter', 'type', 'format',
  'ref', 'ref_src', 'source', 'from', 'to', 'start', 'end', 'date',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'yclid', 'msclkid', 'igshid', 'si', 'feature',
  'share', 'redirect', 'redirect_uri', 'return_url', 'next', 'callback_url',
  'token', 'access_token', 'code', 'state', 'nonce', 'session', 'sid',
  'client_id', 'response_type', 'scope', 'grant_type', 'api_key',
  'width', 'height', 'size', 'quality', 'theme', 'mode', 'view', 'tab',
  // query values
  'true', 'false', 'yes', 'no', 'on', 'off', 'null', 'none', 'all',
  'en', 'ru', 'uk', 'de', 'fr', 'es', 'it', 'pl', 'ja', 'zh',
  'en-US', 'ru-RU', 'uk-UA', 'utf-8', 'desc', 'asc', 'new', 'top', 'hot',
  'google', 'youtube', 'twitter', 'facebook', 'telegram', 'email',
  'organic', 'cpc', 'social', 'referral', 'newsletter', 'affiliate',
  'mobile', 'desktop', 'dark', 'light', 'grid', 'list', 'full',
];

/**
 * Filename extensions, indexed separately from WORDS.
 *
 * A path segment shaped like `name.ext` is stored as a token plus one of
 * these, which is five bits for the part of a filename that is never a
 * surprise. Keep the list under 32 entries; the index has no escape.
 */
export const EXTENSIONS = [
  'html', 'htm', 'php', 'aspx', 'jsp', 'js', 'mjs', 'css', 'json', 'xml',
  'csv', 'txt', 'md', 'yml', 'yaml', 'toml', 'pdf', 'zip', 'gz', 'tar',
  'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico', 'mp4', 'mp3', 'm3u8',
  'woff2', 'exe',
];

export const EXT_BITS = 5;

const indexOf = (list) => new Map(list.map((value, i) => [value, i]));

export const HOST_INDEX = indexOf(HOSTS);
export const TLD_INDEX = indexOf(TLDS);
export const WORD_INDEX = indexOf(WORDS);
export const EXT_INDEX = indexOf(EXTENSIONS);

// Index widths. A tree of this many bits addresses the whole list; entries
// beyond the last one are simply never coded.
export const HOST_BITS = 8;
export const TLD_BITS = 6;
export const WORD_BITS = 8;

export const TLD_ESCAPE = (1 << TLD_BITS) - 1;

for (const [name, list] of [['HOSTS', HOSTS], ['TLDS', TLDS], ['WORDS', WORDS], ['EXTENSIONS', EXTENSIONS]]) {
  // A repeated entry costs an index slot and can never be reached by name.
  const seen = new Set();
  for (const value of list) {
    if (seen.has(value)) throw new Error(`${name} lists ${value} twice`);
    seen.add(value);
  }
}

for (const [name, list, bits] of [
  ['HOSTS', HOSTS, HOST_BITS],
  ['TLDS', TLDS, TLD_BITS - 0],
  ['WORDS', WORDS, WORD_BITS],
  ['EXTENSIONS', EXTENSIONS, EXT_BITS],
]) {
  // A list that outgrew its index width would silently truncate, so say so at
  // load time instead. TLDs also have to leave room for the escape code.
  const room = name === 'TLDS' ? (1 << bits) - 1 : 1 << bits;
  if (list.length > room) {
    throw new Error(`${name} has ${list.length} entries, ${bits} bits addresses ${room}`);
  }
}

/** The longest public suffix this host ends with, or null. */
export function suffixOf(host) {
  let best = null;
  for (const tld of TLDS) {
    if (host.length > tld.length && host.endsWith(`.${tld}`)) {
      if (!best || tld.length > best.length) best = tld;
    }
  }
  return best;
}
