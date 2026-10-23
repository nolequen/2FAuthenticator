import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import argon2 from "argon2-browser";

import { createKey, unlockKey } from "../../models/password";
import { V3_FIXTURE } from "../fixtures/v3-storage";
import { BROKEN_KEYS, V3_KEY } from "../fixture-helper";

chai.should();
mocha.setup("bdd");

describe("password", function () {
  this.timeout(20000);

  it("should unlock a new key with its password only", async () => {
    const created = await createKey("new password");
    created.key.version.should.equal(3);
    created.key.salt.should.match(/^[0-9a-f]{32}$/);

    const unlocked = await unlockKey(created.key, "new password");

    chai.expect(unlocked).to.not.equal(null);
    unlocked?.passphrase.should.equal(created.passphrase);
    unlocked?.encryption.getEncryptionKeyId().should.equal(created.key.id);
    const data = await created.encryption.encrypt(
      JSON.stringify({ secret: "JBSWY3DPEHPK3PXP" }),
    );
    chai
      .expect((await unlocked?.encryption.decrypt(data))?.data)
      .to.deep.equal({ secret: "JBSWY3DPEHPK3PXP" });
    chai.expect(await unlockKey(created.key, "wrong password")).to.equal(null);
  });

  it("should unlock the v3 key of the fixture", async () => {
    const unlocked = await unlockKey(V3_KEY, V3_FIXTURE.password);

    chai.expect(unlocked).to.not.equal(null);
    unlocked?.passphrase.should.equal(V3_FIXTURE.passphrase);
    chai.expect(await unlockKey(V3_KEY, "wrong password")).to.equal(null);
  });

  for (const name of Object.keys(BROKEN_KEYS)) {
    it(`should not unlock a key with ${name} and not run argon2`, async () => {
      const hash = sinon.spy(argon2, "hash");
      const verify = sinon.spy(argon2, "verify");

      chai
        .expect(await unlockKey(BROKEN_KEYS[name], V3_FIXTURE.password))
        .to.equal(null);
      hash.should.have.property("called", false);
      verify.should.have.property("called", false);
    });
  }

  it("should report an argon2 failure as an error, not as a wrong password", async () => {
    sinon.stub(argon2, "verify").rejects({ code: -22, message: "memory" });

    let error: unknown;
    try {
      await unlockKey(V3_KEY, V3_FIXTURE.password);
    } catch (e) {
      error = e;
    }

    chai.expect(error).to.deep.equal({ code: -22, message: "memory" });
  });

  it("should fail when argon2 does not respond", async () => {
    const hash = sinon
      .stub(argon2, "hash")
      .returns(new Promise(() => undefined));
    const clock = sinon.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });

    const unlocked = unlockKey(V3_KEY, V3_FIXTURE.password).then(
      () => null,
      (error: Error) => error,
    );
    hash.should.have.property("calledOnce", true);
    clock.tick(30000);
    clock.restore();

    chai.expect(await unlocked).to.be.instanceOf(Error);
  });
});
