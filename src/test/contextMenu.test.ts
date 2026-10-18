import "mocha";
import * as chai from "chai";
import * as sinon from "sinon";
import * as sinonChai from "sinon-chai";

import { updateContextMenu } from "../contextMenu";
import { UserSettings } from "../models/settings";
import { resetStorage } from "./storage-helper";

chai.should();
chai.use(sinonChai);
mocha.setup("bdd");

type ClickListener = (
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
) => void;

describe("updateContextMenu", () => {
  let clickListeners: ClickListener[];
  let createMenuItem: sinon.SinonSpy;
  let createWindow: sinon.SinonSpy;

  beforeEach(async () => {
    clickListeners = [];
    createMenuItem = sinon.fake();
    ((chrome as unknown) as { contextMenus: unknown }).contextMenus = {
      create: createMenuItem,
      removeAll: sinon.fake(),
      onClicked: {
        addListener: (listener: ClickListener) => clickListeners.push(listener),
        hasListener: (listener: ClickListener) =>
          clickListeners.indexOf(listener) !== -1,
      },
    };
    sinon.replace(
      chrome.permissions,
      "contains",
      sinon.fake(
        (
          permissions: chrome.permissions.Permissions,
          callback?: (result: boolean) => void
        ) => {
          callback?.(true);
          return Promise.resolve(true);
        }
      ) as typeof chrome.permissions.contains
    );
    createWindow = sinon.fake.resolves(undefined);
    sinon.replace(
      chrome.windows,
      "create",
      createWindow as typeof chrome.windows.create
    );
    await resetStorage({ enableContextMenu: true });
  });

  afterEach(async () => {
    delete ((chrome as unknown) as { contextMenus?: unknown }).contextMenus;
    await resetStorage();
  });

  it("should open one window per click after several updates", async () => {
    await updateContextMenu();
    await updateContextMenu();
    await updateContextMenu();

    for (const listener of clickListeners) {
      listener({ menuItemId: "otpContextMenu", editable: false, pageUrl: "" }, {
        url: "https://example.com/",
        title: "Example",
      } as chrome.tabs.Tab);
    }

    createWindow.should.have.been.calledOnce;
    clickListeners.should.have.lengthOf(1);
  });

  it("should create the menu item before settings are loaded", async () => {
    UserSettings.items = {};

    await updateContextMenu();

    createMenuItem.should.have.been.calledOnce;
  });
});
