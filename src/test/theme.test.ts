import "mocha";
import * as chai from "chai";
import "chai/register-should";

import { applyTheme, normalizeTheme } from "../theme";

mocha.setup("bdd");

describe("theme", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  const cases: Array<[unknown, string]> = [
    ["normal", "light"],
    ["simple", "light"],
    ["compact", "light"],
    ["flat", "light"],
    ["dark", "dark"],
    ["accessibility", "dark"],
    ["light", "light"],
    ["auto", "auto"],
    [undefined, "auto"],
    ["", "auto"],
    ["unknown", "auto"],
  ];

  for (const [stored, expected] of cases) {
    it(`should read the stored theme ${JSON.stringify(stored)} as ${expected}`, () => {
      normalizeTheme(stored).should.equal(expected);
    });
  }

  it("should set and remove the theme of the document", () => {
    applyTheme("dark");
    chai.expect(document.documentElement.dataset.theme).to.equal("dark");

    applyTheme("light");
    chai.expect(document.documentElement.dataset.theme).to.equal("light");

    applyTheme("auto");
    chai.expect(document.documentElement.dataset.theme).to.equal(undefined);
  });
});
