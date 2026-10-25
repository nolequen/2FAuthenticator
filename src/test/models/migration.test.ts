import "mocha";
import "chai/register-should";

import { getOTPAuthPerLineFromOPTAuthMigration } from "../../models/migration";
import { getEntryDataFromOTPAuthPerLine } from "../../models/otpauth";
import {
  account,
  field,
  migrationUri,
  payload,
  SECRET_BYTES,
} from "../migration-helper";

mocha.setup("bdd");

const SECRET = "JBSWY3DPEHPK3PXP";

async function importSingle(uri: string) {
  const result = await getEntryDataFromOTPAuthPerLine(uri);
  result.succeededCount.should.equal(1);
  const hashes = Object.keys(result.exportData);
  hashes.should.have.lengthOf(1);
  return result.exportData[hashes[0]];
}

describe("getOTPAuthPerLineFromOPTAuthMigration", () => {
  it("should keep a Cyrillic name and issuer", async () => {
    const entry = await importSingle(
      migrationUri(
        payload(account({ name: "Иван Петров", issuer: "Сбербанк" })),
      ),
    );

    (entry.account as string).should.equal("Иван Петров");
    (entry.issuer as string).should.equal("Сбербанк");
  });

  it("should read an account longer than 127 bytes", async () => {
    const name = "Пользователь".repeat(6);
    const entry = await importSingle(
      migrationUri(payload(account({ name, issuer: "Пример" }))),
    );

    (entry.account as string).should.equal(name);
    (entry.issuer as string).should.equal("Пример");
    entry.secret.should.equal(SECRET);
  });

  it("should read an account without an issuer", () => {
    getOTPAuthPerLineFromOPTAuthMigration(
      migrationUri(payload(account({ name: "alice" }))),
    ).should.deep.equal([
      `otpauth://totp/alice?secret=${SECRET}&algorithm=SHA1&digits=6`,
    ]);
  });

  it("should read a hotp counter of 300", async () => {
    const uri = migrationUri(
      payload(
        account({ name: "alice", issuer: "Example", type: 1, counter: 300 }),
      ),
    );

    getOTPAuthPerLineFromOPTAuthMigration(uri).should.deep.equal([
      `otpauth://hotp/alice?secret=${SECRET}&issuer=Example&algorithm=SHA1&digits=6&counter=300`,
    ]);
    const entry = await importSingle(uri);
    entry.type.should.equal("hotp");
    (entry.counter as number).should.equal(300);
  });

  it("should read fields in any order and skip unknown fields", () => {
    const shuffled = [
      ...field(6, 2),
      ...field(3, "Example"),
      ...field(99, "unknown"),
      ...field(5, 1),
      ...field(2, "alice"),
      ...field(15, 7),
      ...field(1, SECRET_BYTES),
      ...field(4, 1),
    ];

    getOTPAuthPerLineFromOPTAuthMigration(
      migrationUri(payload(shuffled)),
    ).should.deep.equal([
      `otpauth://totp/alice?secret=${SECRET}&issuer=Example&algorithm=SHA1&digits=6`,
    ]);
  });

  it("should keep special characters in the name and issuer", async () => {
    const entry = await importSingle(
      migrationUri(
        payload(account({ name: "a&b=c?d%e+f #1", issuer: "x&y=z?%+w" })),
      ),
    );

    (entry.account as string).should.equal("a&b=c?d%e+f #1");
    (entry.issuer as string).should.equal("x&y=z?%+w");
  });

  it("should keep colons in the account part of the name", async () => {
    const entry = await importSingle(
      migrationUri(
        payload(account({ name: "GitHub:alice:work", issuer: "GitHub" })),
      ),
    );

    (entry.issuer as string).should.equal("GitHub");
    (entry.account as string).should.equal("alice:work");
  });

  it("should keep colons in a name without the issuer prefix", async () => {
    const result = await getEntryDataFromOTPAuthPerLine(
      migrationUri(
        payload(
          account({ name: "alice:work", issuer: "GitHub" }),
          account({ name: "github:bob", issuer: "GitHub" }),
        ),
      ),
    );

    result.succeededCount.should.equal(2);
    const entries = Object.keys(result.exportData)
      .map((hash) => result.exportData[hash])
      .map((entry) => [entry.issuer, entry.account]);
    entries.should.have.deep.members([
      ["GitHub", "alice:work"],
      ["GitHub", "bob"],
    ]);
  });

  it("should map algorithm, digits and type", () => {
    getOTPAuthPerLineFromOPTAuthMigration(
      migrationUri(
        payload(
          account({ name: "a", algorithm: 2, digits: 2, type: 2 }),
          account({ name: "b", algorithm: 3, digits: 1, type: 1 }),
          account({ name: "c", algorithm: 0, digits: 0, type: 0 }),
        ),
      ),
    ).should.deep.equal([
      `otpauth://totp/a?secret=${SECRET}&algorithm=SHA256&digits=8`,
      `otpauth://hotp/b?secret=${SECRET}&algorithm=SHA512&digits=6&counter=1`,
      `otpauth://totp/c?secret=${SECRET}&algorithm=SHA1&digits=6`,
    ]);
  });

  it("should encode the secret bytes as base32", () => {
    const secret = Array.from(Array(16).keys());

    getOTPAuthPerLineFromOPTAuthMigration(
      migrationUri(payload(account({ name: "alice", secret }))),
    ).should.deep.equal([
      "otpauth://totp/alice?secret=AAAQEAYEAUDAOCAJBIFQYDIOB4======&algorithm=SHA1&digits=6",
    ]);
  });

  it("should return the accounts read before broken data", () => {
    const bytes = payload(
      account({ name: "alice", issuer: "Example" }),
      account({ name: "bob", issuer: "Example" }),
    );
    const first = field(1, account({ name: "alice", issuer: "Example" }));

    getOTPAuthPerLineFromOPTAuthMigration(
      migrationUri(bytes.slice(0, first.length + 10)),
    ).should.deep.equal([
      `otpauth://totp/alice?secret=${SECRET}&issuer=Example&algorithm=SHA1&digits=6`,
    ]);
  });

  it("should return nothing for a malformed percent sign in data", () => {
    getOTPAuthPerLineFromOPTAuthMigration(
      "otpauth-migration://offline?data=CjEKCkhlbGxv%E0%A4%A",
    ).should.deep.equal([]);
  });

  it("should import other lines after a malformed migration line", async () => {
    const result = await getEntryDataFromOTPAuthPerLine(
      [
        "otpauth-migration://offline?data=CjEKCkhlbGxv%E0%A4%A",
        `otpauth://totp/Example:user?secret=${SECRET}`,
      ].join("\n"),
    );

    result.succeededCount.should.equal(1);
  });
});
