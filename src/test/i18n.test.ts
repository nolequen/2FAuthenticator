import "mocha";
import "chai/register-should";

import { t } from "../store/i18n";

mocha.setup("bdd");

interface Messages {
  [key: string]: {
    message: string;
    placeholders?: { [name: string]: { content: string } };
  };
}

const NAME_KEYS = ["extName", "extShortName"];
const DYNAMIC_KEYS = ["updateSuccess", "updateFailure", "clock_too_far_off"];

async function readMessages(language: string) {
  const response = await fetch(
    chrome.runtime.getURL(`/_locales/${language}/messages.json`),
  );
  return (await response.json()) as Messages;
}

function placeholders(messages: Messages, key: string) {
  const items = messages[key].placeholders ?? {};
  return Object.keys(items)
    .map((name) => `${name}=${items[name].content}`)
    .sort();
}

describe("messages", () => {
  let en: Messages;
  let ru: Messages;

  before(async () => {
    en = await readMessages("en");
    ru = await readMessages("ru");
  });

  it("should have the same keys in English and Russian", () => {
    Object.keys(ru)
      .sort()
      .should.deep.equal(
        Object.keys(en)
          .filter((key) => !NAME_KEYS.includes(key))
          .sort(),
      );
  });

  it("should keep the extension name only in English", () => {
    for (const key of NAME_KEYS) {
      en.should.have.property(key);
      ru.should.not.have.property(key);
    }
  });

  it("should have the same placeholders in English and Russian", () => {
    for (const key of Object.keys(ru)) {
      placeholders(ru, key).should.deep.equal(
        placeholders(en, key),
        `placeholders of ${key}`,
      );
    }
  });

  it("should use every placeholder in the message", () => {
    for (const messages of [en, ru]) {
      for (const key of Object.keys(messages)) {
        for (const name of Object.keys(messages[key].placeholders ?? {})) {
          messages[key].message
            .toLowerCase()
            .should.contain(`$${name}$`, `${key} uses ${name}`);
        }
      }
    }
  });

  it("should have the keys that the code reads by name", () => {
    for (const key of DYNAMIC_KEYS) {
      en.should.have.property(key);
    }
  });

  it("should fill the placeholders", () => {
    t("filter_accounts_for", "github.com").should.contain("github.com");
    t("search_found", "3", "7").should.contain("3");
    t("search_found", "3", "7").should.contain("7");
  });
});
