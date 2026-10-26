/* Download links: the channel tag and the phone handoff. Pure functions, so the tests can run them. */
(function () {
  "use strict";

  // Same rule as the stats script and the admin link helper: letters, digits, dot, underscore, hyphen, at most 64.
  const REF_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
  // A link copied on a phone carries this tag, so downloads made after the handoff show up as their own channel.
  const HANDOFF_REF = "phone";

  // The page's ?ref= tag, or "" when it is missing or not a valid tag.
  function campaignRef(search) {
    let value = "";
    try {
      value = (new URLSearchParams(search || "").get("ref") || "").trim();
    } catch (e) {
      return "";
    }
    return REF_PATTERN.test(value) ? value : "";
  }

  // The download link with the page's tag on it, so the server log counts the download under that channel.
  function withRef(href, ref, base) {
    if (!href || !ref) return href;
    try {
      const url = new URL(href, base || undefined);
      url.searchParams.set("ref", ref);
      return url.href;
    } catch (e) {
      return href;
    }
  }

  // Phones and tablets, where the desktop app cannot be installed.
  function isHandheld(userAgent, maxTouchPoints, uaDataMobile) {
    if (uaDataMobile === true) return true;
    const ua = String(userAgent || "");
    if (/Android|iPhone|iPad|iPod|OpenHarmony|HarmonyOS|Mobile/i.test(ua)) return true;
    // iPadOS asks for the desktop site with a Mac user agent, and no Mac has a touch screen.
    return /Macintosh/.test(ua) && Number(maxTouchPoints) > 1;
  }

  // The address a phone reader copies to open on a computer: this page, at the download sheet, with a channel tag.
  // Other query parameters (chat apps add their own) are dropped.
  function handoffUrl(pageHref, ref) {
    const url = new URL(pageHref);
    url.search = "";
    url.searchParams.set("ref", ref || HANDOFF_REF);
    url.hash = "download";
    return url.href;
  }

  window.GP_DOWNLOAD_LINKS = Object.freeze({ campaignRef, withRef, isHandheld, handoffUrl });
})();
