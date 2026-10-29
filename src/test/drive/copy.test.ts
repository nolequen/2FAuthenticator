import "mocha";
import * as chai from "chai";
import "chai/register-should";

import { buildCopy, takeSnapshot, type CopySnapshot } from "../../drive/copy";
import { DRIVE_RECORD } from "../../drive/config";
import type { BackupKey } from "../../drive/state";
import { decryptBackupData } from "../../models/backup";
import { Encryption } from "../../models/encryption";
import { createKey } from "../../models/password";
import { StorageLocation } from "../../models/settings";
import { randomPassphrase, resetStorage } from "../storage-helper";

mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";
const BACKUP_PASSWORD = "backup password";
const EXTENSION_PASSWORD = "extension password";

function openEntry(account: string, fields: Partial<RawOTPStorage> = {}) {
  const hash = crypto.randomUUID();
  const entry: RawOTPStorage = {
    dataType: "OTPStorage",
    account,
    encrypted: false,
    hash,
    index: 0,
    secret: SECRET,
    type: "totp",
    group: "Work",
    pinned: true,
    ...fields,
  };
  return { [hash]: entry };
}

async function encryptedEntry(account: string, encryption: Encryption) {
  const [hash, entry] = Object.entries(openEntry(account))[0];
  const item: EncOTPStorage = {
    dataType: "EncOTPStorage",
    data: await encryption.encrypt(JSON.stringify(entry)),
    keyId: encryption.getEncryptionKeyId(),
    index: 0,
  };
  return { [hash]: item };
}

function snapshot(
  items: { [key: string]: unknown },
  session: SessionData = {},
): CopySnapshot {
  return { items, session };
}

async function ready(copy: Awaited<ReturnType<typeof buildCopy>>) {
  if (copy.kind !== "ready") {
    throw new Error(`The copy is ${copy.kind}`);
  }
  return copy;
}

describe("Drive copy", function () {
  this.timeout(30000);

  let backupKey: BackupKey;
  let extensionKey: { key: Key; encryption: Encryption; passphrase: string };

  before(async () => {
    const created = await createKey(BACKUP_PASSWORD);
    backupKey = { key: created.key, passphrase: created.passphrase };
    extensionKey = await createKey(EXTENSION_PASSWORD);
  });

  beforeEach(() => resetStorage());
  afterEach(() => resetStorage());

  describe("with a backup password", () => {
    it("should encrypt every account with the backup key", async () => {
      const items = { ...openEntry("alice"), ...openEntry("bob") };
      const copy = await ready(await buildCopy(snapshot(items), backupKey));

      copy.mode.should.equal("backup");
      copy.accounts.should.equal(2);
      copy.skipped.should.equal(0);
      const file = JSON.parse(copy.content);
      for (const hash of Object.keys(items)) {
        file[hash].dataType.should.equal("EncOTPStorage");
        file[hash].keyId.should.equal(backupKey.key.id);
        file[hash].data.should.match(/^v4:/);
      }
      file[backupKey.key.id].should.deep.equal(backupKey.key);
      copy.content.should.not.contain(SECRET);
    });

    it("should be restored with the backup password by a file import", async () => {
      const items = { ...openEntry("alice"), ...openEntry("bob") };
      const copy = await ready(await buildCopy(snapshot(items), backupKey));

      const restored = await decryptBackupData(
        JSON.parse(copy.content),
        BACKUP_PASSWORD,
      );

      Object.keys(restored).should.have.members(Object.keys(items));
      for (const hash of Object.keys(items)) {
        const source = items[hash] as RawOTPStorage;
        restored[hash].secret.should.equal(SECRET);
        chai.expect(restored[hash].account).to.equal(source.account);
        chai.expect(restored[hash].group).to.equal("Work");
        chai.expect(restored[hash].pinned).to.equal(true);
      }
    });

    it("should ask for a backup password when there is none", async () => {
      (await buildCopy(snapshot(openEntry("alice")))).should.deep.equal({
        kind: "attention",
        attention: "backupPassword",
      });
    });

    it("should take an account written before the data type was stored", async () => {
      const items = openEntry("alice");
      delete (Object.values(items)[0] as RawOTPStorage).dataType;

      const copy = await ready(await buildCopy(snapshot(items), backupKey));

      copy.accounts.should.equal(1);
    });

    it("should skip an account encrypted with a key that is not stored", async () => {
      const lost = await encryptedEntry(
        "lost",
        new Encryption(randomPassphrase(), "lost-key"),
      );
      const items = { ...openEntry("alice"), ...lost };

      const copy = await ready(await buildCopy(snapshot(items), backupKey));

      copy.accounts.should.equal(1);
      copy.skipped.should.equal(1);
      JSON.parse(copy.content).should.not.have.property(Object.keys(lost)[0]);
    });

    it("should skip an old account with an encrypted secret", async () => {
      const items = {
        ...openEntry("alice"),
        ...openEntry("old", { encrypted: true, secret: "U2FsdGVkX1+old" }),
      };

      const copy = await ready(await buildCopy(snapshot(items), backupKey));

      copy.accounts.should.equal(1);
      copy.skipped.should.equal(1);
    });
  });

  describe("with an extension password", () => {
    it("should take the encrypted accounts as they are while the extension is locked", async () => {
      const items = {
        ...(await encryptedEntry("alice", extensionKey.encryption)),
        [extensionKey.key.id]: extensionKey.key,
      };

      const copy = await ready(await buildCopy(snapshot(items), backupKey));

      copy.mode.should.equal("password");
      JSON.parse(copy.content).should.deep.equal(items);
      const restored = await decryptBackupData(
        JSON.parse(copy.content),
        EXTENSION_PASSWORD,
      );
      Object.keys(restored).should.have.lengthOf(1);
    });

    it("should encrypt an open account with the key of the session and keep the storage", async () => {
      const open = openEntry("bob");
      const items = {
        ...(await encryptedEntry("alice", extensionKey.encryption)),
        ...open,
        [extensionKey.key.id]: extensionKey.key,
      };
      const before = JSON.stringify(items);

      const copy = await ready(
        await buildCopy(
          snapshot(items, {
            cachedPassphrase: extensionKey.passphrase,
            cachedKeyId: extensionKey.key.id,
          }),
        ),
      );

      JSON.stringify(items).should.equal(before);
      const file = JSON.parse(copy.content);
      const hash = Object.keys(open)[0];
      file[hash].dataType.should.equal("EncOTPStorage");
      file[hash].keyId.should.equal(extensionKey.key.id);
      const restored = await decryptBackupData(file, EXTENSION_PASSWORD);
      Object.keys(restored).should.have.lengthOf(2);
      restored[hash].secret.should.equal(SECRET);
    });

    it("should wait for the password when an open account comes while the extension is locked", async () => {
      const items = {
        ...openEntry("bob"),
        [extensionKey.key.id]: extensionKey.key,
      };

      (await buildCopy(snapshot(items))).should.deep.equal({
        kind: "attention",
        attention: "unlock",
      });
    });

    it("should skip an account encrypted with a key that is not stored", async () => {
      const items = {
        ...(await encryptedEntry("alice", extensionKey.encryption)),
        ...(await encryptedEntry(
          "lost",
          new Encryption(randomPassphrase(), "lost-key"),
        )),
        [extensionKey.key.id]: extensionKey.key,
      };

      const copy = await ready(await buildCopy(snapshot(items)));

      copy.accounts.should.equal(1);
      copy.skipped.should.equal(1);
    });
  });

  describe("content", () => {
    it("should be empty without accounts", async () => {
      (await buildCopy(snapshot({}), backupKey)).should.deep.equal({
        kind: "empty",
        skipped: 0,
      });
    });

    it("should leave the settings and the Google Drive connection out", async () => {
      const items = {
        ...openEntry("alice"),
        UserSettings: { theme: "dark" },
        [DRIVE_RECORD]: { connectionId: "id", refreshToken: "secret" },
      };

      const copy = await ready(await buildCopy(snapshot(items), backupKey));

      const file = JSON.parse(copy.content);
      file.should.not.have.property("UserSettings");
      file.should.not.have.property(DRIVE_RECORD);
      copy.content.should.not.contain("theme");
    });

    it("should keep the hash while the accounts stay the same", async () => {
      const items = { ...openEntry("alice"), ...openEntry("bob") };

      const first = await ready(await buildCopy(snapshot(items), backupKey));
      const second = await ready(await buildCopy(snapshot(items), backupKey));

      first.content.should.not.equal(second.content);
      first.sourceHash.should.equal(second.sourceHash);
    });

    it("should change the hash when an account changes", async () => {
      const items = openEntry("alice");
      const first = await ready(await buildCopy(snapshot(items), backupKey));
      (Object.values(items)[0] as RawOTPStorage).group = "Home";

      const second = await ready(await buildCopy(snapshot(items), backupKey));

      first.sourceHash.should.not.equal(second.sourceHash);
    });
  });

  describe("snapshot", () => {
    it("should read the accounts of the storage location", async () => {
      const items = openEntry("alice");
      await chrome.storage.local.set(items);

      const taken = await takeSnapshot();

      chai.expect(taken?.items).to.include.keys(Object.keys(items));
    });

    it("should not read anything before the storage location is known", async () => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(openEntry("alice"));

      chai.expect(await takeSnapshot()).to.equal(null);
      chai
        .expect((await chrome.storage.local.get("UserSettings")).UserSettings)
        .to.equal(undefined);
    });

    it("should read the sync storage when the accounts are there", async () => {
      await chrome.storage.local.set({
        UserSettings: { storageLocation: StorageLocation.Sync },
      });
      const items = openEntry("alice");
      await chrome.storage.sync.set(items);

      const taken = await takeSnapshot();

      chai.expect(taken?.items).to.include.keys(Object.keys(items));
    });
  });
});
