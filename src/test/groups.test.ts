import "mocha";
import * as chai from "chai";
import "chai/register-should";

import {
  type EntrySection,
  arrangeEntries,
  buildSections,
  collapsedHashes,
  collapsedSections,
  groupKey,
  groupLabels,
  insertEntry,
  mergeTarget,
  moveEntry,
  moveGroup,
  normalizeGroup,
  renameGroup,
  resolveGroup,
  setEntryGroup,
  togglePin,
  ungroup,
} from "../groups";
import { OTPEntry, OTPType } from "../models/otp";

mocha.setup("bdd");

function account(name: string, group = "", pinned = false) {
  return new OTPEntry({
    type: OTPType.totp,
    index: 0,
    account: name,
    encrypted: false,
    secret: "JBSWY3DPEHPK3PXP",
    group,
    pinned,
  }) as OTPEntryInterface;
}

function locked(name: string) {
  const entry = new OTPEntry({
    encrypted: true,
    keyId: "other-key",
    encData: "data",
    hash: crypto.randomUUID(),
    index: 0,
  }) as OTPEntryInterface;
  entry.account = name;
  return entry;
}

function names(entries: OTPEntryInterface[] | null) {
  return (entries ?? []).map((entry) => entry.account);
}

function layout(sections: EntrySection[]) {
  return sections.map((section) => [
    section.kind === "group" ? section.name : section.kind,
    ...names(section.entries),
  ]);
}

describe("groups", () => {
  describe("names", () => {
    it("should trim the name and bring it to NFC", () => {
      normalizeGroup("  Cafe\u0301 ").should.equal("Caf\u00e9");
      normalizeGroup(undefined).should.equal("");
      normalizeGroup(42).should.equal("");
    });

    it("should use the name in lower case as the key", () => {
      groupKey(" Работа ").should.equal("работа");
      groupKey("РАБОТА").should.equal(groupKey("работа"));
    });

    it("should take the spelling of the first account of a group", () => {
      const entries = [account("a", "работа"), account("b", "Работа")];
      [...groupLabels(entries).values()].should.deep.equal(["работа"]);
      resolveGroup(entries, " РАБОТА ").should.equal("работа");
      resolveGroup(entries, "Личное").should.equal("Личное");
    });

    it("should list the groups of the sections before the groups of pinned accounts", () => {
      const entries = [
        account("a", "Pinned only", true),
        account("b", "Work"),
        account("c", "Home"),
      ];
      [...groupLabels(entries).values()].should.deep.equal([
        "Work",
        "Home",
        "Pinned only",
      ]);
    });

    it("should find the group to merge with", () => {
      const entries = [account("a", "Work"), account("b", "Home")];
      chai.expect(mergeTarget(entries, "work", "home")).to.equal("Home");
      chai.expect(mergeTarget(entries, "work", "WORK")).to.equal(undefined);
      chai.expect(mergeTarget(entries, "work", "Travel")).to.equal(undefined);
    });
  });

  describe("sections", () => {
    it("should keep one list with the pinned accounts first while there is no group", () => {
      const entries = [account("a"), account("b", "", true), account("c")];
      layout(buildSections(entries)).should.deep.equal([
        ["all", "b", "a", "c"],
      ]);
    });

    it("should show the pinned accounts, the groups by their first account and then the accounts without a group", () => {
      const entries = [
        account("a"),
        account("b", "Home"),
        account("c", "Work", true),
        account("d", "Work"),
        account("e", "home"),
      ];
      layout(buildSections(entries)).should.deep.equal([
        ["pinned", "c"],
        ["Home", "b", "e"],
        ["Work", "d"],
        ["none", "a"],
      ]);
    });

    it("should not show a group of pinned accounts only", () => {
      const entries = [account("a", "Work", true), account("b")];
      layout(buildSections(entries)).should.deep.equal([["all", "a", "b"]]);
    });

    it("should keep a group named like the section without a group apart from it", () => {
      const entries = [account("a", "No group"), account("b")];
      const sections = buildSections(entries);
      layout(sections).should.deep.equal([
        ["pinned"],
        ["No group", "a"],
        ["none", "b"],
      ]);
      sections[1].kind.should.equal("group");
    });

    it("should put an account that is not decrypted without a group", () => {
      const hidden = locked("x");
      hidden.group = "Work";
      layout(buildSections([account("a", "Work"), hidden])).should.deep.equal([
        ["pinned"],
        ["Work", "a"],
        ["none", "x"],
      ]);
    });
  });

  describe("arrange", () => {
    it("should write the spelling of the header to every account of a group", () => {
      const entries = [
        account("a", "Work"),
        account("b", "WORK", true),
        account("c", "work"),
      ];
      names(arrangeEntries(entries)).should.deep.equal(["b", "a", "c"]);
      entries
        .map((entry) => entry.group)
        .should.deep.equal(["Work", "Work", "Work"]);
    });

    it("should keep the order of the list while there is no group", () => {
      const entries = [account("a"), account("b", "", true)];
      names(arrangeEntries(entries)).should.deep.equal(["a", "b"]);
    });

    it("should prefer the spelling of the header that was shown before the change", () => {
      const entries = [account("b", "work"), account("c", "WORK")];
      arrangeEntries(entries, new Map([["work", "Work"]]));
      entries.map((entry) => entry.group).should.deep.equal(["Work", "Work"]);
    });
  });

  describe("drag", () => {
    function entries() {
      return [
        account("p", "Work", true),
        account("w1", "Work"),
        account("w2", "Work"),
        account("h1", "Home"),
        account("n1"),
      ];
    }

    it("should pin an account dropped into the pinned section and keep its group", () => {
      const list = entries();
      const moved = moveEntry(list, list[3], { kind: "pinned", key: "" }, 0);
      names(moved).should.deep.equal(["h1", "p", "w1", "w2", "n1"]);
      list[3].pinned.should.equal(true);
      list[3].group.should.equal("Home");
    });

    it("should unpin an account dropped into a group and give it the group", () => {
      const list = entries();
      const moved = moveEntry(list, list[0], { kind: "group", key: "home" }, 1);
      names(moved).should.deep.equal(["w1", "w2", "h1", "p", "n1"]);
      list[0].pinned.should.equal(false);
      list[0].group.should.equal("Home");
    });

    it("should take the group away from an account dropped into the section without a group", () => {
      const list = entries();
      const moved = moveEntry(list, list[1], { kind: "none", key: "" }, 1);
      names(moved).should.deep.equal(["p", "w2", "h1", "n1", "w1"]);
      list[1].group.should.equal("");
    });

    it("should keep the pinned accounts first while there is no group", () => {
      const list = [account("a", "", true), account("b"), account("c")];
      const moved = moveEntry(list, list[2], { kind: "all", key: "" }, 0);
      names(moved).should.deep.equal(["a", "c", "b"]);
      list[2].pinned.should.equal(false);
    });

    it("should move an account that is not decrypted only inside its section", () => {
      const hidden = locked("x");
      const list = [account("w", "Work"), account("n"), hidden];
      chai
        .expect(moveEntry(list, hidden, { kind: "group", key: "work" }, 0))
        .to.equal(null);
      names(
        moveEntry(list, hidden, { kind: "none", key: "" }, 0),
      ).should.deep.equal(["w", "x", "n"]);
    });

    it("should move a group with all its accounts", () => {
      const list = entries();
      names(moveGroup(list, "home", 0)).should.deep.equal([
        "p",
        "h1",
        "w1",
        "w2",
        "n1",
      ]);
    });
  });

  describe("group field", () => {
    it("should put the account last into an existing group with its spelling", () => {
      const list = [account("w1", "Work"), account("h1", "Home"), account("a")];
      names(setEntryGroup(list, list[2], " work")).should.deep.equal([
        "w1",
        "a",
        "h1",
      ]);
      list[2].group.should.equal("Work");
    });

    it("should put a new group last among the groups", () => {
      const list = [account("a"), account("w1", "Work"), account("b")];
      const changed = setEntryGroup(list, list[0], "Travel") ?? [];
      names(changed).should.deep.equal(["w1", "a", "b"]);
      layout(buildSections(changed))
        .map((section) => section[0])
        .should.deep.equal(["pinned", "Work", "Travel", "none"]);
    });

    it("should leave a pinned account in place and change only its group", () => {
      const list = [account("p", "", true), account("w1", "Work")];
      names(setEntryGroup(list, list[0], "Home")).should.deep.equal([
        "p",
        "w1",
      ]);
      list[0].group.should.equal("Home");
    });

    it("should put the account last into the accounts without a group", () => {
      const list = [account("w1", "Work"), account("w2", "Work"), account("a")];
      names(setEntryGroup(list, list[0], "")).should.deep.equal([
        "w2",
        "a",
        "w1",
      ]);
    });

    it("should change nothing for the same group or an account that is not decrypted", () => {
      const list = [account("w1", "Work"), locked("x")];
      chai.expect(setEntryGroup(list, list[0], "WORK ")).to.equal(null);
      chai.expect(setEntryGroup(list, list[1], "Work")).to.equal(null);
    });
  });

  describe("new account", () => {
    it("should go first into its group", () => {
      const list = [account("w1", "Work"), account("a")];
      names(insertEntry(list, account("new", "work"))).should.deep.equal([
        "new",
        "w1",
        "a",
      ]);
    });

    it("should open a new group last among the groups", () => {
      const list = [account("w1", "Work"), account("a")];
      const added = account("new", "Home");
      layout(buildSections(insertEntry(list, added) ?? [])).should.deep.equal([
        ["pinned"],
        ["Work", "w1"],
        ["Home", "new"],
        ["none", "a"],
      ]);
    });

    it("should go first into the accounts without a group", () => {
      const list = [account("w1", "Work"), account("a")];
      names(insertEntry(list, account("new"))).should.deep.equal([
        "w1",
        "new",
        "a",
      ]);
    });

    it("should go first into the list while there is no group", () => {
      const list = [account("p", "", true), account("a")];
      names(insertEntry(list, account("new"))).should.deep.equal([
        "new",
        "p",
        "a",
      ]);
    });
  });

  describe("pin", () => {
    it("should put a pinned account last among the pinned ones", () => {
      const list = [
        account("p", "", true),
        account("w1", "Work"),
        account("a"),
      ];
      names(togglePin(list, list[2])).should.deep.equal(["p", "a", "w1"]);
      list[2].pinned.should.equal(true);
    });

    it("should put an unpinned account first into its group", () => {
      const list = [account("p", "Work", true), account("w1", "Work")];
      names(togglePin(list, list[0])).should.deep.equal(["p", "w1"]);
      list[0].pinned.should.equal(false);
    });

    it("should open the group of an unpinned account last among the groups", () => {
      const list = [
        account("p", "Home", true),
        account("w1", "Work"),
        account("a"),
      ];
      layout(buildSections(togglePin(list, list[0]) ?? [])).should.deep.equal([
        ["pinned"],
        ["Work", "w1"],
        ["Home", "p"],
        ["none", "a"],
      ]);
    });

    it("should keep the order of the list while there is no group", () => {
      const list = [account("a"), account("b"), account("c")];
      names(togglePin(list, list[1])).should.deep.equal(["a", "b", "c"]);
      names(togglePin(list, list[1])).should.deep.equal(["a", "b", "c"]);
    });
  });

  describe("rename", () => {
    it("should rename every account of the group, the pinned ones too", () => {
      const list = [account("p", "Work", true), account("w1", "Work")];
      names(renameGroup(list, "work", " Job ")).should.deep.equal(["p", "w1"]);
      list.map((entry) => entry.group).should.deep.equal(["Job", "Job"]);
    });

    it("should change only the case", () => {
      const list = [account("w1", "work")];
      renameGroup(list, "work", "Work");
      list[0].group.should.equal("Work");
    });

    it("should merge into an existing group at its place", () => {
      const list = [
        account("h1", "Home"),
        account("w1", "Work"),
        account("t1", "Travel"),
        account("w2", "Work"),
      ];
      names(renameGroup(list, "work", "travel")).should.deep.equal([
        "h1",
        "t1",
        "w1",
        "w2",
      ]);
      list
        .map((entry) => entry.group)
        .should.deep.equal(["Home", "Travel", "Travel", "Travel"]);
    });

    it("should refuse an empty name", () => {
      chai
        .expect(renameGroup([account("w1", "Work")], "work", "  "))
        .to.equal(null);
    });
  });

  describe("ungroup", () => {
    it("should put the accounts first into the accounts without a group in their order", () => {
      const list = [
        account("p", "Work", true),
        account("w1", "Work"),
        account("h1", "Home"),
        account("w2", "Work"),
        account("a"),
      ];
      names(ungroup(list, "work")).should.deep.equal([
        "p",
        "h1",
        "w1",
        "w2",
        "a",
      ]);
      list
        .map((entry) => entry.group)
        .should.deep.equal(["", "", "Home", "", ""]);
    });
  });

  describe("collapsed", () => {
    it("should follow the section to its new first account", () => {
      const list = [
        account("w1", "Work"),
        account("w2", "Work"),
        account("a"),
        account("b"),
      ];
      const collapsed = collapsedSections(buildSections(list), [
        list[0].hash,
        list[2].hash,
        "deleted",
      ]);
      collapsed.should.deep.equal([
        { kind: "group", key: "work" },
        { kind: "none", key: "" },
      ]);

      const moved = moveEntry(list, list[0], { kind: "none", key: "" }, 2);
      collapsedHashes(buildSections(moved ?? []), collapsed).should.deep.equal([
        list[1].hash,
        list[2].hash,
      ]);
    });

    it("should forget a section that is gone", () => {
      const list = [account("w1", "Work"), account("a")];
      const collapsed = collapsedSections(buildSections(list), [list[0].hash]);
      const ungrouped = ungroup(list, "work") ?? [];
      collapsedHashes(buildSections(ungrouped), collapsed).should.deep.equal(
        [],
      );
    });

    it("should follow a deleted first account", () => {
      const list = [account("a"), account("b"), account("w1", "Work")];
      const collapsed = collapsedSections(buildSections(list), [list[0].hash]);
      collapsedHashes(
        buildSections(list.slice(1)),
        collapsed,
      ).should.deep.equal([list[1].hash]);
    });
  });
});
