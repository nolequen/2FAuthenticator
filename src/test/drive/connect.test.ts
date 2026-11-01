import "mocha";
import * as chai from "chai";
import "chai/register-should";

import { connectedRecord } from "../../drive/connect";
import type { DriveMirror } from "../../drive/state";
import { driveRecord } from "../drive-helper";

mocha.setup("bdd");

describe("Drive connection record", () => {
  const mirror: DriveMirror = {
    source: "chrome",
    keys: { key: "passphrase" },
    applied: {
      fileId: "file",
      modifiedTime: "2026-10-30T10:00:00.000Z",
      accounts: 2,
      at: 1,
    },
  };

  it("should mark the connection of a phone as a mirror from the sign-in", () => {
    const record = connectedRecord(null, "user@example.com", "refresh", true);

    chai.expect(record.mirror).to.deep.equal({ keys: {} });
    chai.expect(record.refreshToken).to.equal("refresh");
  });

  it("should keep the mirror after another sign-in with the same account", () => {
    const previous = driveRecord({ email: "user@example.com", mirror });

    const record = connectedRecord(previous, "user@example.com", "new", true);

    chai.expect(record.mirror).to.deep.equal(mirror);
    record.connectionId.should.not.equal(previous.connectionId);
  });

  it("should start the mirror again with another account", () => {
    const previous = driveRecord({
      email: "user@example.com",
      folderId: "folder",
      mirror,
    });

    const record = connectedRecord(previous, "other@example.com", "new", true);

    chai.expect(record.mirror).to.deep.equal({ keys: {} });
    chai.expect(record.folderId).to.equal(undefined);
    chai.expect(record.email).to.equal("other@example.com");
  });

  it("should not make a mirror of a computer", () => {
    chai
      .expect(connectedRecord(null, "user@example.com", undefined).mirror)
      .to.equal(undefined);
  });
});
