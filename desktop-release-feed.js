(function () {
  "use strict";

  // Download URLs are always built from this fixed first-party origin.
  // Nothing from the release manifest may introduce another host.
  const FIRST_PARTY_DOWNLOAD_ORIGIN = "https://gravityport.azhuilab.com";
  const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  const SHA256_PATTERN = /^[0-9a-f]{64}$/;
  // Both products are accepted so the page keeps working before and after the
  // feed switches: MOSA-… for the frozen old source, GravityPort-… for the
  // new one. The file name must still be exactly one allowed prefix plus the
  // manifest version plus .zip (.exe for the Windows installer).
  const MAC_STEMS = ["MOSA-darwin-arm64-", "GravityPort-darwin-arm64-"];
  const WINDOWS_STEMS = ["MOSA-win32-x64-", "GravityPort-win32-x64-"];

  const isPlainObject = (value) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const cleanText = (value) => (typeof value === "string" ? value.trim() : "");

  const downloadUrl = (file) => `${FIRST_PARTY_DOWNLOAD_ORIGIN}/downloads/${encodeURIComponent(file)}`;

  // The byte size and SHA-256 the signed manifest records for a file, so the
  // page can print them next to the button that links that file. Malformed
  // values are left out rather than shown.
  const fileFacts = (entry) => {
    const sha256 = cleanText(entry.sha256).toLowerCase();
    return {
      size: Number.isSafeInteger(entry.size) && entry.size > 0 ? entry.size : 0,
      sha256: SHA256_PATTERN.test(sha256) ? sha256 : "",
    };
  };

  // One platforms.* entry of the update manifest. The file name must be the
  // canonical artifact of the manifest version for one of the accepted
  // product prefixes; the download URL is always derived from the fixed
  // first-party origin, never taken from the manifest.
  const normalizePlatformArtifact = (artifact, expectedFiles, platform, arch) => {
    if (!isPlainObject(artifact)) return null;
    if (artifact.platform !== platform || artifact.arch !== arch) return null;
    const file = cleanText(artifact.file);
    if (!expectedFiles.includes(file)) return null;
    return { file, url: downloadUrl(file), ...fileFacts(artifact) };
  };

  // platforms.windows.installer: the one-file installer offered for a first
  // install. Installed apps keep updating from the ZIP beside it, so it must
  // be the same product and version as that ZIP, with a real size and
  // SHA-256; anything else leaves the page on the ZIP.
  const normalizeWindowsInstaller = (installer, zip) => {
    if (!zip || !isPlainObject(installer)) return null;
    const file = cleanText(installer.file);
    if (file !== zip.file.replace(/\.zip$/, ".exe")) return null;
    const facts = fileFacts(installer);
    if (!facts.size || !facts.sha256) return null;
    return { file, url: downloadUrl(file), ...facts };
  };

  // platforms.macos and platforms.windows are judged independently, so a
  // release that only ships one desktop platform never blanks the other one.
  // Windows links the installer when the release ships one, the ZIP before
  // that. Legacy artifacts.* payloads are intentionally ignored.
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
    const windowsZip = normalizePlatformArtifact(
      release.platforms?.windows,
      WINDOWS_STEMS.map((stem) => `${stem}${version}.zip`),
      "Windows",
      "x64",
    );
    const windows = normalizeWindowsInstaller(release.platforms?.windows?.installer, windowsZip) || windowsZip;
    return { version, mac, windows };
  }

  window.MOSADesktopReleaseFeed = {
    FIRST_PARTY_DOWNLOAD_ORIGIN,
    buildFirstPartyDownloadUrl: (file) => downloadUrl(cleanText(file)),
    normalizeDesktopRelease,
  };
})();
