export const V3_FIXTURE_ENTRIES: { [hash: string]: RawOTPStorage } = {
  "6f1c3a52-8f0e-4d6b-9a37-2b8e5c4d1f01": {
    dataType: "OTPStorage",
    hash: "6f1c3a52-8f0e-4d6b-9a37-2b8e5c4d1f01",
    index: 0,
    encrypted: false,
    type: "totp",
    secret: "JBSWY3DPEHPK3PXP",
    issuer: "Example",
    account: "totp-default",
  },
  "0d9b7e14-3c2a-4f58-8e61-7a4b2c9d3e02": {
    dataType: "OTPStorage",
    hash: "0d9b7e14-3c2a-4f58-8e61-7a4b2c9d3e02",
    index: 1,
    encrypted: false,
    type: "hotp",
    counter: 5,
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    issuer: "Example",
    account: "hotp-counter",
  },
  "a2e85f36-7b19-4c0d-b4f2-5e6a8d1c7f03": {
    dataType: "OTPStorage",
    hash: "a2e85f36-7b19-4c0d-b4f2-5e6a8d1c7f03",
    index: 2,
    encrypted: false,
    type: "totp",
    algorithm: "SHA256",
    period: 60,
    digits: 8,
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
    issuer: "Example",
    account: "totp-sha256",
  },
  "c74d1b28-9e63-4a7f-8c05-3f2b6e9a4d04": {
    dataType: "OTPStorage",
    hash: "c74d1b28-9e63-4a7f-8c05-3f2b6e9a4d04",
    index: 3,
    encrypted: false,
    type: "hex",
    secret: "3132333435363738393031323334353637383930",
    issuer: "Example",
    account: "hex",
  },
};

export const V3_FIXTURE: {
  password: string;
  passphrase: string;
  storage: { [key: string]: EncOTPStorage | Key };
} = {
  password: "v3-fixture-password",
  passphrase: "PCFU5wrXrhv9Ld3BP++JIxC9ZFHxmD9+9W5P42Q8FGw",
  storage: {
    "0d9b7e14-3c2a-4f58-8e61-7a4b2c9d3e02": {
      data: "U2FsdGVkX1+DAoxnojNbzBbujtFDLm05Nq7pJD45UoZIyV6YuI5fDiFHyH9LQWRMLp+aVVcX79kLomxtANLqRko4IDyam5zvCTsNZnXQYm2aPI8WPrPWHHoQ/x44CZirnYXaK2VvJq2aIvaJJuWHAsLAHeyBwIbOJtcQ54xykVIhKAEKdcI1ECignurUBiERAh+1mycl95iPgNuBTu8z2D+7jmksA5dL/zm8RS0x9KmPl6zYof2IW0hBsbrDtRzAA/e9DwpEtvKX7XRkruQbja6IxxfhfUrYexgtgaUgS33puebEZ/XbhasDCg3IN416FXLE1wzVf2HFxRSkGdlCgpyDwkY6nqnrJa29eREzkB/zNKS99lwpaVIWyg4zHl/B",
      dataType: "EncOTPStorage",
      index: 1,
      keyId: "c23dfc5d-8c28-490f-8830-438919f59648",
    },
    "6f1c3a52-8f0e-4d6b-9a37-2b8e5c4d1f01": {
      data: "U2FsdGVkX1/Ht2v9MHqCFP5Twn0ds8UisM9ESlhj/Dmq3WR6g5HUIcoxjXsQCEPdz3MIjXcCU7XEEbaGZoAmniAGVg/Vv16l8EkSbQHJtiKoc1HVEa6TQ9f3BXHnKstP3qbC9w7Cd7OajMgop96dhL7jnzmUt9G/255LBsm62HIaz+RiGXuI+4U0MGUmFm5w6lcPrdHNvaLOOLa/e/ZkIUy8t2eSU/kwD63HXhihS3FZQn4ofvpbORbsQXa42NiOhITl5xEwh/+QYJaxGbkpvje0+pc50LaCYO3On4rZB5QKVmdHRnHnxS90MVRLTH1fhR35y1Ov22giB2SAEmjG6g==",
      dataType: "EncOTPStorage",
      index: 0,
      keyId: "c23dfc5d-8c28-490f-8830-438919f59648",
    },
    "a2e85f36-7b19-4c0d-b4f2-5e6a8d1c7f03": {
      data: "U2FsdGVkX1/yKstNzcMHtjywnbs5qMv+kFTr6oA9vilkqQ4VHnlan8zDHufa88jn9+JS/x7nDYj0mCOJh7XMn4lCY91iS9Ir6WKWUvB2zKheLM3K5R6u57IW6++pSQIlFh6isTpTrwrHr1HsF+0dWJC+dQLWL6jSJACfqARyXHn5HedTv2P0gl2Jq3ASOflxNPvzeFmtdsGSqWsjywh5PLpeCWyX1or/0z46uh2dmN575ZxMBJJbKvKmGCRzWFa/5TH1E9aZxATv6Tt2Pdet8Xbahj7um7knx3AeCnLIgMivKqxSPJskwShkDnvbyIy66+Igc0KAnvmEPsCtMah7dxqsGVpr8WWA9LqVmnOhVVIPqBDVeNMfpk6wdOzvv3N4C0OJW+IOk2A+d4fAGLGm0cyCAryTAC7fi7e3Mk+qo3aYC0fVAOvt1Xhli+LjqFDM",
      dataType: "EncOTPStorage",
      index: 2,
      keyId: "c23dfc5d-8c28-490f-8830-438919f59648",
    },
    "c23dfc5d-8c28-490f-8830-438919f59648": {
      dataType: "Key",
      hash: "$argon2id$v=19$m=19456,t=2,p=1$MjY4ZjVkZDdlMDcyYTQwNjhiNWJhNDMwZjdiZTc$rWvj3gOuxHtsr2jcIKPhnPjpMyOBcvhHes/b1gqSpg4",
      id: "c23dfc5d-8c28-490f-8830-438919f59648",
      salt: "91cc9bb566167bee19ede865b41a9ef4",
      version: 3,
    },
    "c74d1b28-9e63-4a7f-8c05-3f2b6e9a4d04": {
      data: "U2FsdGVkX1+51VzGNgLJ9ELIfgxdJVbPZQ6SXALD0NWeV1e11pDonzT0Rq8s/i00+FYiaQwc0T8orlayvNcTIUZAo6Kmw+ajNxgNddVGfMDlD475Ye/tterePaUK7Y3YnGm2HzjD9j80m7tqzGCjiluSjb5GXuVGqHFJxSNvQOJgBv1q6nXJ6PGdJwLRg77Hm2AWnP/ygHHvbAwc0pLHVh9EOM0AUC1jBywfwMQIH3T7svL+9XzhSq/f2ABGw/qU/EC3snfpmkKRwfgi7sw1XWM7+A79GZyrlnFKkAZe1ziIL5wyfMgZ47XpdnRCnX+QXiAtrA5aOpvN790uUPHdUQ/kx4Mu4PzDVfgyNBvV3L8=",
      dataType: "EncOTPStorage",
      index: 3,
      keyId: "c23dfc5d-8c28-490f-8830-438919f59648",
    },
  },
};
