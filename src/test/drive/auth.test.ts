import "mocha";
import * as chai from "chai";
import "chai/register-should";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { DriveApi } from "../../drive/api";
import {
  DriveAuthError,
  getAccessToken,
  parseRedirect,
  pkceChallenge,
  signIn,
} from "../../drive/auth";
import { DRIVE_SCOPE, DRIVE_SESSION } from "../../drive/config";
import {
  CONNECTION_ID,
  driveRecord,
  resetDrive,
  storeDriveRecord,
  storedDriveRecord,
} from "../drive-helper";
import { resetStorage } from "../storage-helper";
import { FakeDrive } from "./fake-drive";

chai.use(sinonChai);
mocha.setup("bdd");

const CHROME_REDIRECT =
  "https://fghognhaimenkmcpmohoogammffofkgn.chromiumapp.org/";
const FIREFOX_REDIRECT = "https://0123abcd.extensions.allizom.org/";

async function storeSession(expiresIn: number) {
  await chrome.storage.session.set({
    [DRIVE_SESSION]: {
      accessToken: "stored-token",
      expiresAt: Date.now() + expiresIn,
      connectionId: CONNECTION_ID,
    },
  });
}

async function sessionToken() {
  return (
    await chrome.storage.session.get<{
      [DRIVE_SESSION]?: { accessToken: string };
    }>(DRIVE_SESSION)
  )[DRIVE_SESSION]?.accessToken;
}

function tokenResponse(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function caught(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("The promise did not fail.");
}

describe("Drive authorization", () => {
  let launch: sinon.SinonStub;
  let redirect: string;

  beforeEach(async () => {
    await resetStorage();
    await resetDrive();
    redirect = CHROME_REDIRECT;
    sinon.replace(chrome.identity, "getRedirectURL", () => redirect);
    launch = sinon.stub(chrome.identity, "launchWebAuthFlow");
  });

  afterEach(async () => {
    sinon.restore();
    await resetStorage();
    await resetDrive();
  });

  describe("redirect", () => {
    it("should read the parameters from the fragment and the query", () => {
      const params = parseRedirect(
        `${CHROME_REDIRECT}?code=code#access_token=token&state=state`,
        "state",
      );

      chai.expect(params.get("access_token")).to.equal("token");
      chai.expect(params.get("code")).to.equal("code");
    });

    it("should refuse another state", async () => {
      const error = await caught(
        Promise.resolve().then(() =>
          parseRedirect(
            `${CHROME_REDIRECT}#access_token=token&state=other`,
            "mine",
          ),
        ),
      );

      chai.expect(error).to.be.instanceOf(DriveAuthError);
      (error as DriveAuthError).reason.should.equal("cancelled");
    });

    for (const [code, reason] of [
      ["interaction_required", "signin"],
      ["login_required", "signin"],
      ["consent_required", "signin"],
      ["access_denied", "denied"],
    ]) {
      it(`should read ${code} as ${reason}`, () => {
        chai
          .expect(() =>
            parseRedirect(
              `${CHROME_REDIRECT}#error=${code}&state=state`,
              "state",
            ),
          )
          .to.throw(DriveAuthError)
          .with.property("reason", reason);
      });
    }
  });

  describe("sign in", () => {
    it("should take the token from the redirect in Chrome and Edge", async () => {
      launch.callsFake(async (details: chrome.identity.WebAuthFlowDetails) => {
        const state = new URL(details.url).searchParams.get("state");
        return `${CHROME_REDIRECT}#access_token=token&expires_in=3600&state=${state}`;
      });

      const result = await signIn("web");

      result.session.accessToken.should.equal("token");
      chai.expect(result.refreshToken).to.equal(undefined);
      const details = launch.firstCall
        .args[0] as chrome.identity.WebAuthFlowDetails;
      details.interactive!.should.equal(true);
      const url = new URL(details.url);
      chai.expect(url.searchParams.get("response_type")).to.equal("token");
      chai
        .expect(url.searchParams.get("redirect_uri"))
        .to.equal(CHROME_REDIRECT);
      chai.expect(url.searchParams.get("scope")).to.equal(DRIVE_SCOPE);
      chai.expect(url.searchParams.get("prompt")).to.equal("select_account");
    });

    it("should exchange the code with PKCE through the loopback address in Firefox", async () => {
      redirect = FIREFOX_REDIRECT;
      launch.callsFake(async (details: chrome.identity.WebAuthFlowDetails) => {
        const state = new URL(details.url).searchParams.get("state");
        return `http://127.0.0.1/mozoauth2/0123abcd?code=code&state=${state}`;
      });
      const fetch = sinon.fake.resolves(
        tokenResponse(200, {
          access_token: "token",
          expires_in: 3599,
          refresh_token: "refresh",
        }),
      );
      sinon.replace(window, "fetch", fetch as unknown as typeof window.fetch);

      const result = await signIn("desktop");

      result.session.accessToken.should.equal("token");
      chai.expect(result.refreshToken).to.equal("refresh");
      const url = new URL(
        (launch.firstCall.args[0] as chrome.identity.WebAuthFlowDetails).url,
      );
      chai
        .expect(url.searchParams.get("redirect_uri"))
        .to.equal("http://127.0.0.1/mozoauth2/0123abcd");
      chai.expect(url.searchParams.get("access_type")).to.equal("offline");
      chai
        .expect(url.searchParams.get("code_challenge_method"))
        .to.equal("S256");
      const body = new URLSearchParams(
        String((fetch.firstCall.args[1] as RequestInit).body),
      );
      chai.expect(body.get("grant_type")).to.equal("authorization_code");
      chai.expect(body.get("code")).to.equal("code");
      chai
        .expect(await pkceChallenge(body.get("code_verifier") ?? ""))
        .to.equal(url.searchParams.get("code_challenge"));
    });

    it("should tell a closed window", async () => {
      launch.rejects(new Error("The user did not approve access."));

      const error = await caught(signIn("web"));

      (error as DriveAuthError).reason.should.equal("cancelled");
    });
  });

  describe("access token", () => {
    it("should reuse a token that is still valid", async () => {
      await storeSession(3600 * 1000);

      (await getAccessToken(driveRecord())).should.equal("stored-token");

      launch.should.not.have.been.called;
    });

    it("should not use the token of another connection", async () => {
      await storeSession(3600 * 1000);
      launch.callsFake(async (details: chrome.identity.WebAuthFlowDetails) => {
        const state = new URL(details.url).searchParams.get("state");
        return `${CHROME_REDIRECT}#access_token=renewed&expires_in=3600&state=${state}`;
      });

      (
        await getAccessToken(driveRecord({ connectionId: "another" }))
      ).should.equal("renewed");

      chai.expect(await sessionToken()).to.equal("stored-token");
    });

    it("should renew silently in Chrome and Edge", async () => {
      await storeSession(60 * 1000);
      launch.callsFake(async (details: chrome.identity.WebAuthFlowDetails) => {
        const state = new URL(details.url).searchParams.get("state");
        return `${CHROME_REDIRECT}#access_token=renewed&expires_in=3600&state=${state}`;
      });

      const record = await storeDriveRecord(
        driveRecord({ email: "user@example.com" }),
      );

      (await getAccessToken(record)).should.equal("renewed");

      const details = launch.firstCall
        .args[0] as chrome.identity.WebAuthFlowDetails;
      details.interactive!.should.equal(false);
      details.abortOnLoadForNonInteractive!.should.equal(false);
      const url = new URL(details.url);
      chai.expect(url.searchParams.get("prompt")).to.equal("none");
      chai
        .expect(url.searchParams.get("login_hint"))
        .to.equal("user@example.com");
      chai.expect(await sessionToken()).to.equal("renewed");
    });

    it("should renew once for requests at the same time", async () => {
      launch.callsFake(async (details: chrome.identity.WebAuthFlowDetails) => {
        const state = new URL(details.url).searchParams.get("state");
        await new Promise((resolve) => setTimeout(resolve, 50));
        return `${CHROME_REDIRECT}#access_token=renewed&expires_in=3600&state=${state}`;
      });
      const record = await storeDriveRecord();

      const tokens = await Promise.all([
        getAccessToken(record),
        getAccessToken(record),
      ]);

      tokens.should.deep.equal(["renewed", "renewed"]);
      launch.should.have.been.calledOnce;
    });

    it("should retry later when the silent renewal cannot load the page", async () => {
      launch.rejects(new Error("Authorization page could not be loaded."));

      const error = await caught(getAccessToken(driveRecord()));

      (error as DriveAuthError).reason.should.equal("network");
    });

    it("should keep the refresh token when Google refuses for another reason", async () => {
      sinon.replace(
        window,
        "fetch",
        sinon.fake.resolves(
          tokenResponse(401, { error: "invalid_client" }),
        ) as unknown as typeof window.fetch,
      );
      const record = await storeDriveRecord(
        driveRecord({ client: "desktop", refreshToken: "refresh" }),
      );

      const error = await caught(getAccessToken(record));

      (error as DriveAuthError).reason.should.equal("network");
      chai
        .expect((await storedDriveRecord())?.refreshToken)
        .to.equal("refresh");
    });

    it("should keep the refresh token when Google answers without a token", async () => {
      sinon.replace(
        window,
        "fetch",
        sinon.fake.resolves(
          tokenResponse(200, {}),
        ) as unknown as typeof window.fetch,
      );
      const record = await storeDriveRecord(
        driveRecord({ client: "desktop", refreshToken: "refresh" }),
      );

      const error = await caught(getAccessToken(record));

      (error as DriveAuthError).reason.should.equal("network");
      chai
        .expect((await storedDriveRecord())?.refreshToken)
        .to.equal("refresh");
    });

    it("should ask to sign in when the silent renewal fails", async () => {
      launch.rejects(new Error("User interaction required."));

      const error = await caught(getAccessToken(driveRecord()));

      (error as DriveAuthError).reason.should.equal("signin");
    });

    it("should renew with the refresh token in Firefox", async () => {
      const fetch = sinon.fake.resolves(
        tokenResponse(200, { access_token: "renewed", expires_in: 3599 }),
      );
      sinon.replace(window, "fetch", fetch as unknown as typeof window.fetch);

      (
        await getAccessToken(
          driveRecord({ client: "desktop", refreshToken: "refresh" }),
        )
      ).should.equal("renewed");

      const body = new URLSearchParams(
        String((fetch.firstCall.args[1] as RequestInit).body),
      );
      chai.expect(body.get("grant_type")).to.equal("refresh_token");
      chai.expect(body.get("refresh_token")).to.equal("refresh");
      launch.should.not.have.been.called;
    });

    it("should forget a refresh token that Google refuses", async () => {
      sinon.replace(
        window,
        "fetch",
        sinon.fake.resolves(
          tokenResponse(400, { error: "invalid_grant" }),
        ) as unknown as typeof window.fetch,
      );
      const record = await storeDriveRecord(
        driveRecord({ client: "desktop", refreshToken: "refresh" }),
      );

      const error = await caught(getAccessToken(record));

      (error as DriveAuthError).reason.should.equal("signin");
      chai
        .expect((await storedDriveRecord())?.refreshToken)
        .to.equal(undefined);
    });

    it("should renew once and retry after Drive refuses the token", async () => {
      new FakeDrive().install();
      const token = sinon.stub();
      token.onFirstCall().resolves("old-token");
      token.onSecondCall().resolves("access-token");

      chai
        .expect(await new DriveApi(token).email())
        .to.equal("user@example.com");

      token.should.have.been.calledTwice;
      token.secondCall.should.have.been.calledWith("old-token");
    });
  });
});
