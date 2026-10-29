import * as sinon from "sinon";

const FOLDER_TYPE = "application/vnd.google-apps.folder";

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  properties: { [name: string]: string };
  trashed: boolean;
  modifiedTime: string;
  content: string;
}

export interface FakeRequest {
  method: string;
  url: URL;
  body: string;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function apiError(status: number, reason: string) {
  return json(status, {
    error: { code: status, message: reason, errors: [{ reason }] },
  });
}

function parseMultipart(body: string, contentType: string) {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? "";
  const parts = body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) =>
      part.slice(part.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""),
    );
  return { metadata: JSON.parse(parts[0]), content: parts[1] ?? "" };
}

export class FakeDrive {
  files = new Map<string, FakeFile>();
  requests: FakeRequest[] = [];
  token = "access-token";
  email = "user@example.com";
  failures: {
    match: (request: FakeRequest) => boolean;
    status: number;
    reason: string;
  }[] = [];
  private counter = 0;
  private clock = Date.parse("2026-10-01T10:00:00Z");

  install() {
    sinon.replace(
      window,
      "fetch",
      sinon.fake((input: RequestInfo | URL, init?: RequestInit) =>
        this.handle(String(input), init ?? {}),
      ) as unknown as typeof fetch,
    );
    return this;
  }

  addFile(fields: Partial<FakeFile>) {
    const file: FakeFile = {
      id: `file-${++this.counter}`,
      name: "",
      mimeType: "application/json",
      parents: [],
      properties: {},
      trashed: false,
      modifiedTime: new Date((this.clock += 1000)).toISOString(),
      content: "",
      ...fields,
    };
    this.files.set(file.id, file);
    return file;
  }

  addFolder(fields: Partial<FakeFile> = {}) {
    return this.addFile({
      name: "2FAuthenticator",
      mimeType: FOLDER_TYPE,
      properties: { app: "2fauthenticator" },
      ...fields,
    });
  }

  copies() {
    return [...this.files.values()].filter(
      (file) => file.mimeType !== FOLDER_TYPE,
    );
  }

  uploads() {
    return this.requests.filter((request) =>
      request.url.pathname.startsWith("/upload/"),
    );
  }

  fail(
    match: (request: FakeRequest) => boolean,
    status: number,
    reason: string,
  ) {
    this.failures.push({ match, status, reason });
  }

  private async handle(input: string, init: RequestInit): Promise<Response> {
    const headers = (init.headers ?? {}) as { [name: string]: string };
    const request: FakeRequest = {
      method: init.method ?? "GET",
      url: new URL(input),
      body: typeof init.body === "string" ? init.body : String(init.body ?? ""),
    };
    this.requests.push(request);

    const failure = this.failures.find((item) => item.match(request));
    if (failure) {
      this.failures.splice(this.failures.indexOf(failure), 1);
      return apiError(failure.status, failure.reason);
    }
    if (headers.Authorization !== `Bearer ${this.token}`) {
      return apiError(401, "authError");
    }

    const path = request.url.pathname;
    const params = request.url.searchParams;
    if (path === "/drive/v3/about") {
      return json(200, { user: { emailAddress: this.email } });
    }
    if (path === "/drive/v3/files" && request.method === "GET") {
      return json(200, { files: this.query(params.get("q") ?? "") });
    }
    if (path === "/drive/v3/files" && request.method === "POST") {
      const metadata = JSON.parse(request.body);
      return json(200, { id: this.addFile({ ...metadata, parents: [] }).id });
    }
    const fileId = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(path)?.[1];
    const file = fileId
      ? this.files.get(decodeURIComponent(fileId))
      : undefined;
    if (path === "/upload/drive/v3/files" && request.method === "POST") {
      const { metadata, content } = parseMultipart(
        request.body,
        headers["Content-Type"],
      );
      return json(200, { id: this.addFile({ ...metadata, content }).id });
    }
    if (fileId && !file) {
      return apiError(404, "notFound");
    }
    if (file && path.startsWith("/upload/") && request.method === "PATCH") {
      const { metadata, content } = parseMultipart(
        request.body,
        headers["Content-Type"],
      );
      Object.assign(file, metadata, {
        content,
        modifiedTime: new Date((this.clock += 1000)).toISOString(),
      });
      return json(200, { id: file.id });
    }
    if (file && request.method === "PATCH") {
      Object.assign(file, JSON.parse(request.body));
      return json(200, { id: file.id });
    }
    if (file && params.get("alt") === "media") {
      return new Response(file.content, { status: 200 });
    }
    if (file) {
      return json(200, { id: file.id, trashed: file.trashed });
    }
    return apiError(400, "badRequest");
  }

  private query(q: string) {
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const folder = q.includes(`mimeType='${FOLDER_TYPE}'`);
    return [...this.files.values()]
      .filter(
        (file) =>
          !file.trashed &&
          file.properties.app === "2fauthenticator" &&
          (folder
            ? file.mimeType === FOLDER_TYPE
            : file.mimeType !== FOLDER_TYPE) &&
          (!parent || file.parents.includes(parent)),
      )
      .map(({ id, name, modifiedTime, properties }) => ({
        id,
        name,
        modifiedTime,
        properties,
      }));
  }
}
