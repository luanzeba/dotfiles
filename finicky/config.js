// @ts-check

/**
 * @typedef {import('/Applications/Finicky.app/Contents/Resources/finicky.d.ts').FinickyConfig} FinickyConfig
 */

const PI_OPEN_URL_SCRIPT = "/Users/luan/dotfiles/bin/chrome-pi-open-url.sh";

const openInPiChrome = (url) => ({
  appType: "path",
  name: PI_OPEN_URL_SCRIPT,
  args: [url.toString()],
});

/** @type {FinickyConfig} */
export default {
  defaultBrowser: openInPiChrome,
  handlers: [
    {
      match: /^https:\/\/github\.com\/github(?:[/?#]|$)/,
      browser: openInPiChrome,
    },
    {
      match: /^https:\/\/x\.com(?:[/?#]|$)/,
      browser: openInPiChrome,
    },
    {
      match: /^https:\/\/(?:www\.)?traveljoy\.com(?:[/?#]|$)/,
      browser: openInPiChrome,
    },
  ],
};
