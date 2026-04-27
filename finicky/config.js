// @ts-check

/**
 * @typedef {import('/Applications/Finicky.app/Contents/Resources/finicky.d.ts').FinickyConfig} FinickyConfig
 */

const PI_OPEN_URL_SCRIPT = "/Users/luan/dotfiles/bin/chrome-pi-open-url.sh";

const openInPiChrome = (profile) => (url) => ({
  appType: "path",
  name: PI_OPEN_URL_SCRIPT,
  args: profile ? ["--profile", profile, url.toString()] : [url.toString()],
});

const openInWorkPiChrome = openInPiChrome("Work");
const openInHomePiChrome = openInPiChrome("Home");

/** @type {FinickyConfig} */
export default {
  defaultBrowser: openInWorkPiChrome,
  handlers: [
    {
      // GitHub org URLs should always open in the Work Chrome profile.
      match: /^https:\/\/github\.com\/github(?:[/?#]|$)/,
      browser: openInWorkPiChrome,
    },
    {
      // Datadog app URLs should always open in the Work Chrome profile.
      match: /^https:\/\/app\.datadoghq\.com(?:[/?#]|$)/,
      browser: openInWorkPiChrome,
    },
    {
      // X should always open in the Home Chrome profile.
      match: /^https:\/\/x\.com(?:[/?#]|$)/,
      browser: openInHomePiChrome,
    },
    {
      // TravelJoy should always open in the Home Chrome profile.
      match: /^https:\/\/(?:www\.)?traveljoy\.com(?:[/?#]|$)/,
      browser: openInHomePiChrome,
    },
  ],
};
