import * as chai from "chai";

import {
  OTPAlgorithm,
  OTPEntry,
  parseOTPAlgorithm,
  parseOTPType,
} from "../models/otp";
import { V3_FIXTURE, V3_FIXTURE_ENTRIES } from "./fixtures/v3-storage";
import { resetStorage } from "./storage-helper";

export const V3_KEY_ID = Object.keys(V3_FIXTURE.storage).find(
  (id) => V3_FIXTURE.storage[id].dataType === "Key",
) as string;

export const V3_KEY = V3_FIXTURE.storage[V3_KEY_ID] as Key;

export const BROKEN_KEYS: { [name: string]: Key } = {
  "too much memory": {
    ...V3_KEY,
    hash: V3_KEY.hash.replace("m=19456", "m=4194304"),
  },
  "another version": { ...V3_KEY, version: 5 as 3 },
  "garbage in the hash": { ...V3_KEY, hash: "garbage" },
  "a hash that argon2 cannot decode": {
    ...V3_KEY,
    hash: "$argon2id$v=19$m=19456,t=2,p=1$A$B",
  },
  "a short salt": { ...V3_KEY, salt: "short" },
  "no salt": { ...V3_KEY, salt: undefined as unknown as string },
};

export async function storeV3Fixture() {
  await resetStorage();
  await chrome.storage.local.set(V3_FIXTURE.storage);
}

function sourceEntry(source: RawOTPStorage) {
  const { type, digits } = parseOTPType(source.type, source.digits);
  return new OTPEntry({
    encrypted: false,
    hash: source.hash,
    index: source.index,
    issuer: source.issuer,
    account: source.account,
    secret: source.secret,
    type,
    counter: source.counter,
    period: source.period,
    digits,
    algorithm: parseOTPAlgorithm(source.algorithm),
  });
}

export function expectFixtureAccounts(entries: OTPEntryInterface[]) {
  const hashes = Object.keys(V3_FIXTURE_ENTRIES);
  entries.map((entry) => entry.hash).should.have.members(hashes);
  for (const entry of entries) {
    const source = sourceEntry(V3_FIXTURE_ENTRIES[entry.hash]);
    chai.expect(entry.secret).to.equal(source.secret);
    entry.type.should.equal(source.type);
    entry.counter.should.equal(source.counter);
    entry.period.should.equal(source.period);
    entry.digits.should.equal(source.digits);
    entry.algorithm.should.equal(source.algorithm || OTPAlgorithm.SHA1);
    entry.issuer.should.equal(source.issuer);
    entry.account.should.equal(source.account);
  }
}

export function fixtureCodes() {
  const codes: { [hash: string]: string } = {};
  for (const hash of Object.keys(V3_FIXTURE_ENTRIES)) {
    const entry = sourceEntry(V3_FIXTURE_ENTRIES[hash]);
    entry.generate();
    codes[hash] = entry.code;
  }
  return codes;
}

export function entryCodes(entries: OTPEntryInterface[]) {
  const codes: { [hash: string]: string } = {};
  for (const entry of entries) {
    entry.generate();
    codes[entry.hash] = entry.code;
  }
  return codes;
}
