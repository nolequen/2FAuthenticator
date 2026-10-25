import "mocha";
import * as chai from "chai";
import "chai/register-should";

import { Encryption } from "../../models/encryption";
import { V3_FIXTURE, V3_FIXTURE_ENTRIES } from "../fixtures/v3-storage";
import { V3_KEY_ID } from "../fixture-helper";
import { randomPassphrase } from "../storage-helper";

mocha.setup("bdd");

const ENTRY: RawOTPStorage = {
  dataType: "OTPStorage",
  hash: "5b0e7c3a-1d2f-4e6a-9b8c-7d6e5f4a3b21",
  index: 0,
  encrypted: true,
  keyId: "key-id",
  type: "totp",
  secret: "JBSWY3DPEHPK3PXP",
  account: "alice",
};

function corrupt(data: string) {
  const bytes = Uint8Array.from(atob(data.slice(3)), (char) =>
    char.charCodeAt(0),
  );
  bytes[bytes.length - 1] ^= 1;
  return "v4:" + btoa(String.fromCharCode(...bytes));
}

describe("Encryption", () => {
  it("should encrypt to v4 and decrypt back", async () => {
    const encryption = new Encryption(randomPassphrase(), "key-id");

    const data = await encryption.encrypt(JSON.stringify(ENTRY));

    data.should.match(/^v4:/);
    chai
      .expect(await encryption.decrypt(data))
      .to.deep.equal({ data: ENTRY, legacy: false });
  });

  it("should use a new IV for every encryption", async () => {
    const encryption = new Encryption(randomPassphrase(), "key-id");

    const first = await encryption.encrypt(JSON.stringify(ENTRY));
    const second = await encryption.encrypt(JSON.stringify(ENTRY));

    first.should.not.equal(second);
  });

  it("should not decrypt with another key", async () => {
    const data = await new Encryption(randomPassphrase(), "key-id").encrypt(
      JSON.stringify(ENTRY),
    );

    chai
      .expect(await new Encryption(randomPassphrase(), "key-id").decrypt(data))
      .to.equal(null);
  });

  it("should not decrypt corrupted data", async () => {
    const encryption = new Encryption(randomPassphrase(), "key-id");
    const data = await encryption.encrypt(JSON.stringify(ENTRY));

    chai.expect(await encryption.decrypt(corrupt(data))).to.equal(null);
    chai.expect(await encryption.decrypt("v4:AAAA")).to.equal(null);
    chai.expect(await encryption.decrypt("v4:not base64!")).to.equal(null);
  });

  it("should not decrypt with a key that is not 32 bytes long", async () => {
    const data = await new Encryption(randomPassphrase(), "key-id").encrypt(
      JSON.stringify(ENTRY),
    );
    const encryption = new Encryption("test-passphrase", "key-id");

    chai.expect(await encryption.decrypt(data)).to.equal(null);
    let error: unknown;
    try {
      await encryption.encrypt(JSON.stringify(ENTRY));
    } catch (e) {
      error = e;
    }
    chai.expect(error).to.be.instanceOf(Error);
  });

  it("should decrypt a v3 entry of the fixture as legacy", async () => {
    const encryption = new Encryption(V3_FIXTURE.passphrase, V3_KEY_ID);

    for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
      const item = V3_FIXTURE.storage[hash] as EncOTPStorage;
      item.data.should.match(/^U2FsdGVkX1/);

      const decrypted = await encryption.decrypt(item.data);

      chai.expect(decrypted).to.not.equal(null);
      decrypted?.legacy.should.equal(true);
      decrypted?.data.hash.should.equal(hash);
      decrypted?.data.secret.should.equal(V3_FIXTURE_ENTRIES[hash].secret);
      decrypted?.data.type.should.equal(V3_FIXTURE_ENTRIES[hash].type);
    }
  });
});
