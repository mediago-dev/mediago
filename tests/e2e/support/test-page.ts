import { createServer } from "node:http";

const ERROR_LIMIT = 512;

export interface StartedTestPage {
  url: string;
  close(): Promise<void>;
}

function fixtureHTML(sampleURL: string): string {
  const serializedURL = JSON.stringify(sampleURL).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MediaGo E2E Fixture</title>
  </head>
  <body>
    <main><h1>MediaGo E2E Fixture</h1></main>
    <script>
      window.fixtureMediaLoaded = false;
      fetch(${serializedURL})
        .then((response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.arrayBuffer();
        })
        .then(() => { window.fixtureMediaLoaded = true; })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          window.fixtureMediaLoaded = message.slice(0, ${ERROR_LIMIT});
        });
    </script>
  </body>
</html>`;
}

export async function startTestPage(
  sampleURL: string,
): Promise<StartedTestPage> {
  const html = Buffer.from(fixtureHTML(sampleURL));
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/") {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": "10",
      });
      response.end("Not Found\n");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(html.length),
      "Cache-Control": "no-store",
    });
    response.end(html);
  });
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => reject(error);
    server.once("error", handleError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", handleError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Fixture page did not bind to a loopback TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      server.closeAllConnections();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
