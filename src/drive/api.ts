import { APP_PROPERTY, FOLDER_NAME } from "./config";
import type { DriveBrowser } from "./state";

const API_URL = "https://www.googleapis.com/drive/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,modifiedTime,properties";
const PAGE_SIZE = 200;
const APP_QUERY = `properties has { key='app' and value='${APP_PROPERTY}' }`;

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  properties?: {
    app?: string;
    browser?: string;
    day?: string;
    accounts?: string;
  };
}

export interface CopyProperties {
  browser: DriveBrowser;
  day: string;
  accounts: number;
}

export class DriveApiError extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(status: number, reason: string, message?: string) {
    super(message ?? `Drive API ${status} ${reason}`);
    this.status = status;
    this.reason = reason;
  }

  get network() {
    return (
      this.status === 0 ||
      this.status >= 500 ||
      this.status === 429 ||
      this.reason === "rateLimitExceeded" ||
      this.reason === "userRateLimitExceeded"
    );
  }

  get quota() {
    return this.reason === "storageQuotaExceeded";
  }
}

interface ApiRequest {
  method?: string;
  headers?: { [name: string]: string };
  body?: string;
}

async function apiError(response: Response) {
  const body = await response.json().catch(() => null);
  return new DriveApiError(
    response.status,
    body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "",
    body?.error?.message,
  );
}

function query(params: { [name: string]: string }) {
  return new URLSearchParams(params).toString();
}

export class DriveApi {
  private readonly token: (rejected?: string) => Promise<string>;

  constructor(token: (rejected?: string) => Promise<string>) {
    this.token = token;
  }

  private async request(url: string, init: ApiRequest = {}) {
    let token = await this.token();
    let response = await this.send(url, init, token);
    if (response.status === 401) {
      token = await this.token(token);
      response = await this.send(url, init, token);
    }
    if (!response.ok) {
      throw await apiError(response);
    }
    return response;
  }

  private async send(url: string, init: ApiRequest, token: string) {
    try {
      return await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      throw new DriveApiError(0, "network", String(error));
    }
  }

  async email() {
    const response = await this.request(
      `${API_URL}/about?${query({ fields: "user(emailAddress)" })}`,
    );
    const about = await response.json();
    return typeof about?.user?.emailAddress === "string"
      ? (about.user.emailAddress as string)
      : undefined;
  }

  async findFolder() {
    const files = await this.list(
      `mimeType='${FOLDER_TYPE}' and name='${FOLDER_NAME}' and trashed=false and ${APP_QUERY}`,
    );
    return files[0]?.id;
  }

  async folderExists(id: string) {
    try {
      const response = await this.request(
        `${API_URL}/files/${encodeURIComponent(id)}?${query({ fields: "id,trashed" })}`,
      );
      const file = await response.json();
      return file?.trashed !== true;
    } catch (error) {
      if (error instanceof DriveApiError && error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  async createFolder() {
    const response = await this.request(
      `${API_URL}/files?${query({ fields: "id" })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: FOLDER_NAME,
          mimeType: FOLDER_TYPE,
          properties: { app: APP_PROPERTY },
        }),
      },
    );
    return (await response.json()).id as string;
  }

  listCopies(folderId: string) {
    return this.list(
      `'${folderId.replace(/['\\]/g, "\\$&")}' in parents and trashed=false and ${APP_QUERY}`,
    );
  }

  private async list(q: string) {
    const files: DriveFile[] = [];
    let pageToken = "";
    do {
      const params: { [name: string]: string } = {
        q,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: String(PAGE_SIZE),
        spaces: "drive",
      };
      if (pageToken) {
        params.pageToken = pageToken;
      }
      const response = await this.request(`${API_URL}/files?${query(params)}`);
      const page = await response.json();
      files.push(...((page?.files as DriveFile[]) ?? []));
      pageToken = page?.nextPageToken ?? "";
    } while (pageToken);
    return files;
  }

  async upload(
    folderId: string,
    name: string,
    content: string,
    properties: CopyProperties,
    fileId?: string,
  ) {
    const metadata: { [name: string]: unknown } = {
      properties: {
        app: APP_PROPERTY,
        browser: properties.browser,
        day: properties.day,
        accounts: String(properties.accounts),
      },
    };
    if (!fileId) {
      metadata.name = name;
      metadata.parents = [folderId];
      metadata.mimeType = "application/json";
    }
    const boundary = `2fauthenticator-${crypto.randomUUID()}`;
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      content,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const response = await this.request(
      `${UPLOAD_URL}/files${fileId ? `/${encodeURIComponent(fileId)}` : ""}?${query({ uploadType: "multipart", fields: "id" })}`,
      {
        method: fileId ? "PATCH" : "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    return (await response.json()).id as string;
  }

  async download(id: string) {
    const response = await this.request(
      `${API_URL}/files/${encodeURIComponent(id)}?${query({ alt: "media" })}`,
    );
    return await response.text();
  }

  async trash(id: string) {
    await this.request(
      `${API_URL}/files/${encodeURIComponent(id)}?${query({ fields: "id" })}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
    );
  }
}
