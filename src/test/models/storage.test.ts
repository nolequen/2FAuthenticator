import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as CryptoJS from "crypto-js";

import { Encryption } from "../../models/encryption";
import { OTPAlgorithm, OTPEntry, OTPType } from "../../models/otp";
import { StorageLocation, UserSettings } from "../../models/settings";
import { BrowserStorage, EntryStorage } from "../../models/storage";
import { randomPassphrase, resetStorage, storeKey } from "../storage-helper";

chai.use(sinonChai);
mocha.setup("bdd");

const BASE32_SECRET = "JBSWY3DPEHPK3PXP";
const HEX_SECRET = "3132333435363738393031323334353637383930";

function rawEntry(fields: Partial<RawOTPStorage> = {}): RawOTPStorage {
  return {
    hash: crypto.randomUUID(),
    index: 0,
    encrypted: false,
    secret: BASE32_SECRET,
    type: "totp",
    ...fields,
  };
}

async function getOnlyEntry() {
  const entries = await EntryStorage.get();
  entries.should.have.lengthOf(1);
  return entries[0];
}

async function importAndGet(
  fields: Partial<RawOTPStorage>,
  encryption = new Encryption("", ""),
) {
  const entry = rawEntry(fields);
  await EntryStorage.import(encryption, { [entry.hash]: entry });
  return getOnlyEntry();
}

function asStoredType(value: number) {
  return value as unknown as string;
}

async function storeAccount(storage: chrome.storage.StorageArea) {
  const raw = rawEntry();
  await storage.set({ [raw.hash]: raw });
  await storeKey("test-key", storage);
  return storage.get();
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("EntryStorage", () => {
  beforeEach(() => resetStorage());
  afterEach(() => resetStorage());

  describe("import", () => {
    describe("type", () => {
      for (const name of ["totp", "hotp"]) {
        it(`should keep the type ${name}`, async () => {
          const entry = await importAndGet({ type: name });
          entry.type.should.equal(OTPType[name as keyof typeof OTPType]);
        });
      }

      it("should read the type battle as totp with 8 digits", async () => {
        const entry = await importAndGet({ type: "battle", digits: 6 });
        entry.type.should.equal(OTPType.totp);
        entry.digits.should.equal(8);
      });

      for (const prefix of ["blz-", "bliz-"]) {
        it(`should cut the secret prefix ${prefix} and use totp with 8 digits`, async () => {
          const entry = await importAndGet({
            type: "totp",
            secret: prefix + BASE32_SECRET,
          });
          entry.type.should.equal(OTPType.totp);
          entry.digits.should.equal(8);
          (entry.secret as string).should.equal(BASE32_SECRET);
        });
      }

      it("should accept a type name in upper case", async () => {
        const entry = await importAndGet({ type: "HOTP" });
        entry.type.should.equal(OTPType.hotp);
      });

      it("should accept a type given as a number", async () => {
        const entry = await importAndGet({ type: asStoredType(OTPType.hotp) });
        entry.type.should.equal(OTPType.hotp);
      });

      it("should use totp for an unknown type", async () => {
        const entry = await importAndGet({ type: "unknown" });
        entry.type.should.equal(OTPType.totp);
      });

      it("should detect hex for a totp entry with a hex secret", async () => {
        const entry = await importAndGet({ type: "totp", secret: HEX_SECRET });
        entry.type.should.equal(OTPType.hex);
      });

      it("should detect hhex for a hotp entry with a hex secret", async () => {
        const entry = await importAndGet({ type: "hotp", secret: HEX_SECRET });
        entry.type.should.equal(OTPType.hhex);
      });
    });

    describe("algorithm", () => {
      it("should keep an algorithm given by name", async () => {
        const entry = await importAndGet({ algorithm: "SHA256" });
        entry.algorithm.should.equal(OTPAlgorithm.SHA256);
      });

      it("should accept an algorithm name in lower case", async () => {
        const entry = await importAndGet({ algorithm: "sha512" });
        entry.algorithm.should.equal(OTPAlgorithm.SHA512);
      });

      it("should accept a GOST algorithm name", async () => {
        const entry = await importAndGet({ algorithm: "GOST3411_2012_256" });
        entry.algorithm.should.equal(OTPAlgorithm.GOST3411_2012_256);
      });

      it("should accept an algorithm given as a number", async () => {
        const entry = await importAndGet({
          algorithm: asStoredType(OTPAlgorithm.SHA512),
        });
        entry.algorithm.should.equal(OTPAlgorithm.SHA512);
      });

      it("should use SHA1 for an unknown algorithm", async () => {
        const entry = await importAndGet({ algorithm: "MD5" });
        entry.algorithm.should.equal(OTPAlgorithm.SHA1);
      });
    });

    it("should keep the period of a totp entry", async () => {
      const entry = await importAndGet({ type: "totp", period: 60 });
      entry.type.should.equal(OTPType.totp);
      entry.period.should.equal(60);
    });

    it("should keep the period of a hex entry", async () => {
      const entry = await importAndGet({
        type: "totp",
        secret: HEX_SECRET,
        period: 60,
      });
      entry.type.should.equal(OTPType.hex);
      entry.period.should.equal(60);
    });

    it("should keep the counter of a hotp entry", async () => {
      const entry = await importAndGet({ type: "hotp", counter: 5 });
      entry.type.should.equal(OTPType.hotp);
      entry.counter.should.equal(5);
    });

    it("should reset a negative counter to zero", async () => {
      const entry = await importAndGet({ type: "hotp", counter: -1 });
      entry.counter.should.equal(0);
    });

    describe("with encryption", () => {
      const encryptionPassphrase = randomPassphrase();
      const encryption = new Encryption(encryptionPassphrase, "test-key-id");

      async function importEncrypted(fields: Partial<RawOTPStorage>) {
        const raw = rawEntry(fields);
        await EntryStorage.import(encryption, { [raw.hash]: raw });

        const stored = await chrome.storage.local.get<{
          [hash: string]: EncOTPStorage;
        }>();
        stored[raw.hash].dataType.should.equal("EncOTPStorage");
        stored[raw.hash].data.should.match(/^v4:/);
        JSON.stringify(stored).should.not.contain(raw.secret);

        const entry = await getOnlyEntry();
        await entry.applyEncryption(encryption);
        chai.expect(entry.legacyData).to.equal(undefined);
        return entry;
      }

      it("should restore a hotp entry with its counter and algorithm", async () => {
        const entry = await importEncrypted({
          type: "hotp",
          counter: 5,
          algorithm: "SHA256",
          digits: 8,
          issuer: "Example",
          account: "user",
        });

        entry.type.should.equal(OTPType.hotp);
        entry.counter.should.equal(5);
        entry.algorithm.should.equal(OTPAlgorithm.SHA256);
        entry.digits.should.equal(8);
        entry.issuer.should.equal("Example");
        entry.account.should.equal("user");
        (entry.secret as string).should.equal(BASE32_SECRET);
      });

      it("should not decrypt an entry with the key of another ID", async () => {
        const raw = rawEntry({ type: "totp" });
        await EntryStorage.import(encryption, { [raw.hash]: raw });
        const entry = await getOnlyEntry();
        const encData = entry.encData;

        await entry.applyEncryption(
          new Encryption(encryptionPassphrase, "other-key-id"),
        );

        chai.expect(entry.secret).to.equal(null);
        chai.expect(entry.encData).to.equal(encData);
      });

      it("should restore a totp entry with its period", async () => {
        const entry = await importEncrypted({
          type: "totp",
          period: 60,
          algorithm: "SHA512",
        });

        entry.type.should.equal(OTPType.totp);
        entry.period.should.equal(60);
        entry.algorithm.should.equal(OTPAlgorithm.SHA512);
      });
    });
  });

  describe("group", () => {
    function groupedEntry(group: string, encryption?: Encryption) {
      return new OTPEntry(
        {
          type: OTPType.totp,
          index: 0,
          account: "user",
          encrypted: false,
          secret: BASE32_SECRET,
          group,
        },
        encryption,
      );
    }

    it("should keep the group of an open account and leave an empty one out", async () => {
      const work = groupedEntry("Работа");
      const other = groupedEntry("");

      await EntryStorage.set([work, other]);

      const stored = await chrome.storage.local.get<{
        [hash: string]: RawOTPStorage;
      }>();
      chai.expect(stored[work.hash].group).to.equal("Работа");
      stored[other.hash].should.not.have.property("group");
      const groups: { [hash: string]: string } = {};
      for (const entry of await EntryStorage.get()) {
        groups[entry.hash] = entry.group;
      }
      groups.should.deep.equal({ [work.hash]: "Работа", [other.hash]: "" });
    });

    it("should keep the group inside the encrypted data", async () => {
      await storeKey("test-key");
      const encryption = new Encryption(randomPassphrase(), "test-key");
      const work = groupedEntry("Секретная группа", encryption);

      await EntryStorage.set([work]);

      const stored = await chrome.storage.local.get<{
        [hash: string]: EncOTPStorage;
      }>();
      stored[work.hash].dataType.should.equal("EncOTPStorage");
      JSON.stringify(stored).should.not.contain("Секретная группа");
      const entry = await getOnlyEntry();
      entry.group.should.equal("");
      await entry.applyEncryption(encryption);
      entry.group.should.equal("Секретная группа");
    });

    it("should read a group that is not a string as no group", async () => {
      const raw = { ...rawEntry(), group: 42 as unknown as string };
      await chrome.storage.local.set({ [raw.hash]: raw });

      (await getOnlyEntry()).group.should.equal("");
    });

    it("should import the group trimmed and in NFC", async () => {
      (await importAndGet({ group: "  Cafe\u0301 " })).group.should.equal(
        "Caf\u00e9",
      );
    });

    it("should import a group that is not a string as no group", async () => {
      (
        await importAndGet({ group: ["Work"] as unknown as string })
      ).group.should.equal("");
    });

    it("should keep the group in the backup with and without a password", async () => {
      await storeKey("test-key");
      const encryption = new Encryption(randomPassphrase(), "test-key");
      const work = groupedEntry("Работа", encryption);

      const open = (await EntryStorage.getExport([work])) as {
        [hash: string]: RawOTPStorage;
      };
      const encrypted = (await EntryStorage.getExport([work], true)) as {
        [hash: string]: EncOTPStorage;
      };

      chai.expect(open[work.hash].group).to.equal("Работа");
      const decrypted = await encryption.decrypt(encrypted[work.hash].data);
      chai.expect(decrypted?.data.group).to.equal("Работа");
    });
  });

  describe("writing", () => {
    async function expectRejected(write: () => Promise<void>) {
      const before = await chrome.storage.local.get();

      let error: unknown;
      try {
        await write();
      } catch (e) {
        error = e;
      }

      chai.expect(error).to.be.instanceOf(Error);
      (await chrome.storage.local.get()).should.deep.equal(before);
    }

    async function entryUnderMissingKey() {
      const raw = rawEntry();
      await chrome.storage.local.set({ [raw.hash]: raw });
      const entry = await getOnlyEntry();
      entry.changeEncryption(new Encryption(randomPassphrase(), "missing-key"));
      return entry;
    }

    it("should not set an account encrypted with a key that is not stored", async () => {
      const entry = await entryUnderMissingKey();
      await expectRejected(() => EntryStorage.set([entry]));
    });

    it("should not add an account encrypted with a key that is not stored", async () => {
      const entry = await entryUnderMissingKey();
      await expectRejected(() => EntryStorage.add(entry));
    });

    it("should not update an account encrypted with a key that is not stored", async () => {
      const entry = await entryUnderMissingKey();
      await expectRejected(() => EntryStorage.update(entry));
    });

    it("should not store an encrypted account in the open", async () => {
      const raw = rawEntry();
      await chrome.storage.local.set({ [raw.hash]: raw });
      const entry = await getOnlyEntry();
      await storeKey("test-key");
      await EntryStorage.import(
        new Encryption(randomPassphrase(), "test-key"),
        {
          [raw.hash]: raw,
        },
      );

      await expectRejected(() => EntryStorage.set([entry]));
    });
  });

  describe("get", () => {
    it("should read a stored hex entry with its period", async () => {
      const raw = rawEntry({ type: "hex", secret: HEX_SECRET, period: 60 });
      await chrome.storage.local.set({ [raw.hash]: raw });

      const entry = await getOnlyEntry();
      entry.type.should.equal(OTPType.hex);
      entry.period.should.equal(60);
    });

    it("should read an unencrypted entry with type 1 as totp with its period", async () => {
      const raw = rawEntry({ type: asStoredType(1), period: 60 });
      await chrome.storage.local.set({ [raw.hash]: raw });

      const entry = await getOnlyEntry();
      entry.type.should.equal(OTPType.totp);
      entry.period.should.equal(60);
    });

    it("should read an unencrypted battle entry as totp with 8 digits", async () => {
      const raw = rawEntry({ type: "battle", digits: 6 });
      await chrome.storage.local.set({ [raw.hash]: raw });

      const entry = await getOnlyEntry();
      entry.type.should.equal(OTPType.totp);
      entry.digits.should.equal(8);
    });

    for (const [value, type] of [
      [5, OTPType.hex],
      [6, OTPType.hhex],
    ]) {
      it(`should read an unencrypted entry with type ${value} as ${OTPType[type]}`, async () => {
        const raw = rawEntry({ type: asStoredType(value), secret: HEX_SECRET });
        await chrome.storage.local.set({ [raw.hash]: raw });

        const entry = await getOnlyEntry();
        entry.type.should.equal(type);
      });
    }

    describe("an old encrypted entry", () => {
      const passphrase = randomPassphrase();
      const encryption = new Encryption(passphrase, "test-key-id");

      async function storeEncrypted(fields: Partial<RawOTPStorage>) {
        const raw = rawEntry({
          ...fields,
          dataType: "OTPStorage",
          encrypted: true,
          keyId: "test-key-id",
        });
        const stored: EncOTPStorage = {
          dataType: "EncOTPStorage",
          keyId: "test-key-id",
          data: CryptoJS.AES.encrypt(
            JSON.stringify(raw),
            passphrase,
          ).toString(),
          index: 0,
        };
        await chrome.storage.local.set({ [raw.hash]: stored });
      }

      async function getDecrypted(): Promise<OTPEntry> {
        const entry = await getOnlyEntry();
        const data = entry.encData;
        await entry.applyEncryption(encryption);
        chai.expect(entry.legacyData).to.equal(data);
        return entry;
      }

      it("should read type 1 as totp", async () => {
        await storeEncrypted({ type: asStoredType(1) });

        const entry = await getDecrypted();
        entry.type.should.equal(OTPType.totp);
        entry.algorithm.should.equal(OTPAlgorithm.SHA1);
      });

      it("should read numeric type and algorithm", async () => {
        await storeEncrypted({
          type: asStoredType(2),
          algorithm: asStoredType(2),
        });

        const entry = await getDecrypted();
        entry.type.should.equal(OTPType.hotp);
        entry.algorithm.should.equal(OTPAlgorithm.SHA256);
      });

      it("should read type 3 as totp with 8 digits", async () => {
        await storeEncrypted({ type: asStoredType(3), digits: 6 });

        const entry = await getDecrypted();
        entry.type.should.equal(OTPType.totp);
        entry.digits.should.equal(8);
      });

      for (const [value, type] of [
        [5, OTPType.hex],
        [6, OTPType.hhex],
      ]) {
        it(`should read type ${value} as ${OTPType[type]}`, async () => {
          await storeEncrypted({
            type: asStoredType(value),
            secret: HEX_SECRET,
          });

          const entry = await getDecrypted();
          entry.type.should.equal(type);
        });
      }
    });
  });
});

describe("BrowserStorage", () => {
  beforeEach(() => resetStorage());
  afterEach(() => resetStorage());

  describe("clearLogs", () => {
    it("should keep all the data", async () => {
      const before = await storeAccount(chrome.storage.local);

      await BrowserStorage.clearLogs();

      (await chrome.storage.local.get()).should.deep.equal(before);
    });

    it("should keep all the data in sync storage", async () => {
      await chrome.storage.local.set({
        UserSettings: { storageLocation: StorageLocation.Sync },
      });
      await UserSettings.updateItems();
      const local = await chrome.storage.local.get();
      const before = await storeAccount(chrome.storage.sync);

      await BrowserStorage.clearLogs();

      (await chrome.storage.sync.get()).should.deep.equal(before);
      (await chrome.storage.local.get()).should.deep.equal(local);
    });

    it("should send the data back before the storage is cleared", async () => {
      const before = await storeAccount(chrome.storage.local);
      const clearStorage = chrome.storage.local.clear.bind(
        chrome.storage.local,
      ) as () => Promise<void>;
      let finishClear: () => void = () => undefined;
      const clear = sinon.fake(() => {
        const cleared = clearStorage();
        return new Promise<void>((resolve) => {
          finishClear = () => resolve(cleared);
        });
      });
      sinon.replace(
        chrome.storage.local,
        "clear",
        clear as unknown as typeof chrome.storage.local.clear,
      );
      const set = sinon.spy(chrome.storage.local, "set");
      let clearing: Promise<void> = Promise.resolve();
      try {
        clearing = BrowserStorage.clearLogs();
        await waitFor(() => clear.called);
        set.should.have.been.calledOnceWith(before);
      } finally {
        finishClear();
        await clearing.catch(() => undefined);
        sinon.restore();
      }

      set.should.have.been.calledOnce;
      (await chrome.storage.local.get()).should.deep.equal(before);
    });

    it("should write the data again when the first write fails", async () => {
      const before = await storeAccount(chrome.storage.local);
      const set = sinon.stub(chrome.storage.local, "set").callThrough();
      set.onFirstCall().rejects(new Error("IO error"));
      try {
        await BrowserStorage.clearLogs();
      } finally {
        sinon.restore();
      }

      set.should.have.been.calledTwice;
      (await chrome.storage.local.get()).should.deep.equal(before);
    });

    it("should fail when the data cannot be written back", async function () {
      this.timeout(5000);
      await storeAccount(chrome.storage.local);
      sinon.replace(
        chrome.storage.local,
        "set",
        sinon.fake.rejects(
          new Error("IO error"),
        ) as unknown as typeof chrome.storage.local.set,
      );

      let error: unknown;
      try {
        await BrowserStorage.clearLogs();
      } catch (e) {
        error = e;
      } finally {
        sinon.restore();
      }

      chai
        .expect(error)
        .to.be.instanceOf(Error)
        .with.property("message", "IO error");
    });

    it("should keep the data and only warn when the storage cannot be cleared", async () => {
      const before = await storeAccount(chrome.storage.local);
      sinon.replace(
        chrome.storage.local,
        "clear",
        sinon.fake.rejects(
          new Error("IO error"),
        ) as unknown as typeof chrome.storage.local.clear,
      );
      const warn = sinon.fake();
      sinon.replace(console, "warn", warn);
      try {
        await BrowserStorage.clearLogs();
      } finally {
        sinon.restore();
      }

      warn.should.have.been.calledOnce;
      (await chrome.storage.local.get()).should.deep.equal(before);
    });
  });
});
