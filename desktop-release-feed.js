(function () {
  "use strict";

  // Download URLs are always built from this fixed first-party origin.
  // Nothing from the release manifest may introduce another host.
  const FIRST_PARTY_DOWNLOAD_ORIGIN = "https://gravityport.azhuilab.com";
  const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  // Both products are accepted so the page keeps working before and after the
  // feed switches: MOSA-… for the frozen old source, GravityPort-… for the
  // new one. The file name must still be exactly one allowed prefix plus the
  // manifest version plus .zip.
  const MAC_STEMS = ["MOSA-darwin-arm64-", "GravityPort-darwin-arm64-"];
  const WINDOWS_STEMS = ["MOSA-win32-x64-", "GravityPort-win32-x64-"];

  const isPlainObject = (value) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

  // One platforms.* entry of the update manifest. The file name must be the
  // canonical artifact of the manifest version for one of the accepted
  // product prefixes; the download URL is always derived from the fixed
  // first-party origin, never taken from the manifest.
  const normalizePlatformArtifact = (artifact, expectedFiles, platform, arch) => {
    if (!isPlainObject(artifact)) return null;
    if (artifact.platform !== platform || artifact.arch !== arch) return null;
    const file = cleanText(artifact.file);
    if (!expectedFiles.includes(file)) return null;
    return {
      file,
      url: `${FIRST_PARTY_DOWNLOAD_ORIGIN}/downloads/${encodeURIComponent(file)}`,
    };
  };

  // platforms.macos and platforms.windows are judged independently, so a
  // release that only ships one desktop platform never blanks the other one.
  // Legacy artifacts.* payloads are intentionally ignored.
  function normalizeDesktopRelease(release) {
    const invalid = { version: "", mac: null, windows: null };
    if (!isPlainObject(release)) return invalid;
    const version = cleanText(release.version).replace(/^v/i, "");
    if (!VERSION_PATTERN.test(version)) return invalid;
    const mac = normalizePlatformArtifact(
      release.platforms?.macos,
      MAC_STEMS.map((stem) => `${stem}${version}.zip`),
      "macOS",
      "arm64",
    );
    const windows = normalizePlatformArtifact(
      release.platforms?.windows,
      WINDOWS_STEMS.map((stem) => `${stem}${version}.zip`),
      "Windows",
      "x64",
    );
    return { version, mac, windows };
  }

  window.MOSADesktopReleaseFeed = {
    FIRST_PARTY_DOWNLOAD_ORIGIN,
    buildFirstPartyDownloadUrl: (file) =>
      `${FIRST_PARTY_DOWNLOAD_ORIGIN}/downloads/${encodeURIComponent(cleanText(file))}`,
    normalizeDesktopRelease,
  };
})();
