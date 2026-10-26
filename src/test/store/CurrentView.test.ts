import "mocha";
import * as chai from "chai";
import "chai/register-should";

import { useCurrentViewStore } from "../../store/CurrentView";
import { createTestPinia } from "../vue-helper";

mocha.setup("bdd");

describe("CurrentView", () => {
  let currentView: ReturnType<typeof useCurrentViewStore>;

  beforeEach(() => {
    currentView = useCurrentViewStore(createTestPinia());
  });

  it("should show the list when no page is open", () => {
    chai.expect(currentView.current).to.equal(null);
  });

  it("should open pages on top of each other and go back", () => {
    currentView.open("Menu");
    currentView.open("Preferences");
    chai.expect(currentView.current).to.equal("Preferences");

    currentView.back();
    chai.expect(currentView.current).to.equal("Menu");

    currentView.back();
    chai.expect(currentView.current).to.equal(null);
  });

  it("should close all pages", () => {
    currentView.open("Menu");
    currentView.open("SetPassword");

    currentView.close();

    chai.expect(currentView.current).to.equal(null);
    currentView.stack.length.should.equal(0);
  });

  it("should remember the account of the account page", () => {
    currentView.open("Account", "hash-1");

    chai.expect(currentView.current).to.equal("Account");
    currentView.accountHash.should.equal("hash-1");
  });

  it("should not open a page while the accounts are locked", () => {
    currentView.lock();
    currentView.open("Menu");
    chai.expect(currentView.current).to.equal(null);

    currentView.unlock();
    currentView.open("Menu");
    chai.expect(currentView.current).to.equal("Menu");
  });

  it("should be busy while the action runs", async () => {
    let busyInside = false;
    const result = await currentView.withBusy(async () => {
      busyInside = currentView.busy;
      return 42;
    });

    busyInside.should.equal(true);
    result.should.equal(42);
    currentView.busy.should.equal(false);
  });

  it("should stop being busy when the action fails", async () => {
    let error: unknown;
    try {
      await currentView.withBusy(async () => {
        throw new Error("failure");
      });
    } catch (caught) {
      error = caught;
    }

    chai.expect(error).to.be.an("error");
    currentView.busy.should.equal(false);
  });
});
