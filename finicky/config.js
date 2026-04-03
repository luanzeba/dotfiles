// @ts-check

/**
 * @typedef {import('/Applications/Finicky.app/Contents/Resources/finicky.d.ts').FinickyConfig} FinickyConfig
 */

/** @type {FinickyConfig} */
export default {
  defaultBrowser: {
    name: "Google Chrome",
    profile: "Work",
  },
  handlers: [
    {
      // GitHub org URLs should always open in the Work Chrome profile.
      match: /^https:\/\/github\.com\/github(?:[/?#]|$)/,
      browser: {
        name: "Google Chrome",
        profile: "Work",
      },
    },
    {
      // X should always open in the Home Chrome profile.
      match: /^https:\/\/x\.com(?:[/?#]|$)/,
      browser: {
        name: "Google Chrome",
        profile: "Home",
      },
    },
    {
      // TravelJoy should always open in the Home Chrome profile.
      match: /^https:\/\/(?:www\.)?traveljoy\.com(?:[/?#]|$)/,
      browser: {
        name: "Google Chrome",
        profile: "Home",
      },
    },
  ],
};
