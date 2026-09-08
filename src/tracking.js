// Stripping the parts of a URL that are not the URL.
//
// This is the only thing in squrl that changes where a link points -- or
// rather, that changes what the link says while it still points at the same
// page. Campaign parameters are pure overhead for a reader, and often half the
// characters in a shared link. Removing them is by far the biggest compression
// win available, and by far the least honest, so it is never automatic: the
// CLI does it only when asked, and says what it removed.

/** Parameters that identify a campaign or a referrer, not a resource. */
export const TRACKING = [
  /^utm_/i,          // Google Analytics campaign tags
  /^ga_/i,
  /^_ga$/i,
  /^gclid$/i,        // Google Ads click id
  /^gclsrc$/i,
  /^dclid$/i,
  /^fbclid$/i,       // Facebook
  /^igshid$/i,       // Instagram
  /^twclid$/i,       // Twitter
  /^ttclid$/i,       // TikTok
  /^msclkid$/i,      // Microsoft Ads
  /^yclid$/i,        // Yandex
  /^_openstat$/i,
  /^mc_(cid|eid)$/i, // Mailchimp
  /^ref_(src|url)$/i,
  /^si$/i,           // YouTube and Spotify share ids
  /^feature$/i,
  /^spm$/i,          // Alibaba
  /^scm$/i,
];

const isTracking = (key) => TRACKING.some((pattern) => pattern.test(key));

/**
 * Remove campaign parameters from a URL.
 *
 * @returns {{url: string, removed: string[]}} the cleaned URL and what went.
 *          If nothing matched, the URL comes back untouched -- including its
 *          punctuation, since re-serialising a URL can change it.
 */
export function strip(url) {
  const mark = url.indexOf('?');
  if (mark === -1) return { url, removed: [] };

  const hash = url.indexOf('#', mark);
  const query = url.slice(mark + 1, hash === -1 ? undefined : hash);
  const tail = hash === -1 ? '' : url.slice(hash);

  const removed = [];
  const kept = query.split('&').filter((pair) => {
    const key = pair.split('=')[0];
    if (pair !== '' && isTracking(key)) {
      removed.push(pair);
      return false;
    }
    return true;
  });

  if (removed.length === 0) return { url, removed: [] };

  const rest = kept.join('&');
  return {
    url: url.slice(0, mark) + (rest ? `?${rest}` : '') + tail,
    removed,
  };
}
