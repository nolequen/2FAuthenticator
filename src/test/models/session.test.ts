import "mocha";
import * as chai from "chai";

import { getSessionEncryption, importUnderSession } from "../../models/session";
import { EntryStorage } from "../../models/storage";
import {
  cacheSessionKey,
  clearSession,
  holdStorageLock,
  resetStorage,
  storeKey,
  waitForStorageLockRequests,
} from "../storage-helper";

chai.should();
mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";

describe("session", () => {
  beforeEach(async () => {
    await resetStorage();
    await clearSession();
  });

  afterEach(async () => {
    await resetStorage();
    await clearSession();
  });

  describe("getSessionEncryption", () => {
    it("should give an encryption without a password when no password is set", async () => {
      const encryption = await getSessionEncryption();

      chai.expect(encryption?.getEncryptionStatus()).to.equal(false);
    });

    it("should give the encryption of the session when its key is stored", async () => {
      await storeKey("session-key");
      const cached = await cacheSessionKey("session-key");
      const data = await cached.encrypt(JSON.stringify({ secret: SECRET }));

      const encryption = await getSessionEncryption();

      chai.expect(encryption?.getEncryptionKeyId()).to.equal("session-key");
      chai
        .expect((await encryption?.decrypt(data))?.data)
        .to.deep.equal({ secret: SECRET });
    });

    it("should give nothing while the accounts are locked", async () => {
      await storeKey("session-key");

      chai.expect(await getSessionEncryption()).to.equal(null);
    });

    it("should give nothing when the key of the session is no longer stored", async () => {
      await storeKey("new-key");
      await cacheSessionKey("old-key");

      chai.expect(await getSessionEncryption()).to.equal(null);
    });

    it("should give nothing when the session has a password but no key is stored", async () => {
      await cacheSessionKey("old-key");

      chai.expect(await getSessionEncryption()).to.equal(null);
    });
  });

  describe("importUnderSession", () => {
    it("should import only after the storage lock is released", async () => {
      const hash = crypto.randomUUID();
      const release = await holdStorageLock();
      const importing = importUnderSession({
        [hash]: {
          hash,
          index: 0,
          encrypted: false,
          secret: SECRET,
          type: "totp",
        },
      });
      try {
        await waitForStorageLockRequests();
        (await EntryStorage.get()).should.have.lengthOf(0);
      } finally {
        await release();
      }

      (await importing).should.equal(true);
      (await EntryStorage.get())
        .map((entry) => entry.hash)
        .should.deep.equal([hash]);
    });
  });
});
