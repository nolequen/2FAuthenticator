import "mocha";
import * as chai from "chai";

import { decryptBackupData } from "../../models/backup";
import { Encryption } from "../../models/encryption";
import { createKey } from "../../models/password";
import { EntryStorage } from "../../models/storage";
import { V3_FIXTURE, V3_FIXTURE_ENTRIES } from "../fixtures/v3-storage";
import { expectFixtureAccounts } from "../fixture-helper";
import { randomPassphrase, resetStorage } from "../storage-helper";

chai.should();
mocha.setup("bdd");

const BACKUP_PASSWORD = "backup password";

async function createV4Backup() {
  await chrome.storage.local.set(V3_FIXTURE_ENTRIES);
  const entries = await EntryStorage.get();
  const { key, encryption } = await createKey(BACKUP_PASSWORD);
  for (const entry of entries) {
    entry.changeEncryption(encryption);
  }
  const backup: { [hash: string]: OTPStorage | Key } = {
    ...((await EntryStorage.getExport(entries, true)) as {
      [hash: string]: OTPStorage;
    }),
    [key.id]: key,
  };
  await resetStorage();
  return backup;
}

async function importBackup(
  backup: { [hash: string]: OTPStorage | Key },
  encryption: Encryption,
) {
  const data = await decryptBackupData(backup, BACKUP_PASSWORD);
  Object.keys(data).should.have.members(Object.keys(V3_FIXTURE_ENTRIES));
  await EntryStorage.import(encryption, data);
}

describe("decryptBackupData", function () {
  this.timeout(20000);

  beforeEach(() => resetStorage());
  afterEach(() => resetStorage());

  it("should decrypt a v3 backup with its password", async () => {
    const data = await decryptBackupData(
      V3_FIXTURE.storage,
      V3_FIXTURE.password,
    );

    Object.keys(data).should.have.members(Object.keys(V3_FIXTURE_ENTRIES));
    for (const hash of Object.keys(data)) {
      const source = V3_FIXTURE_ENTRIES[hash];
      data[hash].encrypted.should.equal(false);
      data[hash].secret.should.equal(source.secret);
      data[hash].type.should.equal(source.type);
      chai.expect(data[hash].counter).to.equal(source.counter);
      chai.expect(data[hash].period).to.equal(source.period);
      chai.expect(data[hash].digits).to.equal(source.digits);
      chai.expect(data[hash].algorithm).to.equal(source.algorithm);
    }

    await EntryStorage.import(new Encryption("", ""), data);
    expectFixtureAccounts(await EntryStorage.get());
  });

  it("should decrypt nothing from a v3 backup with a wrong password", async () => {
    (
      await decryptBackupData(V3_FIXTURE.storage, "wrong password")
    ).should.deep.equal({});
  });

  it("should import a v4 backup without a password", async () => {
    const backup = await createV4Backup();
    for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
      (backup[hash] as EncOTPStorage).data.should.match(/^v4:/);
    }

    await importBackup(backup, new Encryption("", ""));

    const stored = await chrome.storage.local.get();
    for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
      stored[hash].dataType.should.equal("OTPStorage");
      stored[hash].encrypted.should.equal(false);
    }
    expectFixtureAccounts(await EntryStorage.get());
  });

  it("should import a v4 backup under the key of the session", async () => {
    const backup = await createV4Backup();
    const encryption = new Encryption(randomPassphrase(), "session-key");

    await importBackup(backup, encryption);

    const stored = await chrome.storage.local.get();
    for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
      stored[hash].dataType.should.equal("EncOTPStorage");
      stored[hash].keyId.should.equal("session-key");
      stored[hash].data.should.match(/^v4:/);
    }
    const entries = await EntryStorage.get();
    for (const entry of entries) {
      await entry.applyEncryption(encryption);
    }
    expectFixtureAccounts(entries);
  });

  it("should decrypt nothing from a v4 backup with a wrong password", async () => {
    const backup = await createV4Backup();

    (await decryptBackupData(backup, "wrong password")).should.deep.equal({});
  });
});
