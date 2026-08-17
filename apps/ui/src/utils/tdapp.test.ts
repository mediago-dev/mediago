import { afterEach, expect, test, vi } from "vitest";

interface ScriptDouble {
  async: boolean;
  src: string;
}

function installDocumentDouble(): ScriptDouble[] {
  const appendedScripts: ScriptDouble[] = [];
  const head = {
    appendChild(script: ScriptDouble) {
      appendedScripts.push(script);
    },
  };

  vi.stubGlobal("document", {
    createElement(tagName: string) {
      if (tagName !== "script")
        throw new Error(`Unexpected ${tagName} element`);
      return { async: false, src: "" } satisfies ScriptDouble;
    },
    getElementsByTagName(tagName: string) {
      if (tagName !== "head") throw new Error(`Unexpected ${tagName} lookup`);
      return [head];
    },
  });

  return appendedScripts;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

test.each([undefined, "", "   "])(
  "does not load analytics without a nonempty app ID (%s)",
  async (appId) => {
    const appendedScripts = installDocumentDouble();
    vi.stubEnv("APP_TD_APPID", appId);
    vi.stubEnv("APP_VERSION", "3.5.0");
    vi.resetModules();

    const { tdApp } = await import("./tdapp");
    tdApp.init();

    expect(appendedScripts).toStrictEqual([]);
  },
);

test("loads analytics for a configured app ID", async () => {
  const appendedScripts = installDocumentDouble();
  vi.stubEnv("APP_TD_APPID", "analytics-app");
  vi.stubEnv("APP_VERSION", "3.5.0");
  vi.resetModules();

  const { tdApp } = await import("./tdapp");
  tdApp.init();

  expect(appendedScripts).toStrictEqual([
    {
      async: true,
      src: "https://jic.talkingdata.com/app/h5/v1?appid=analytics-app&vn=3.5.0&vc=3.5.0",
    },
  ]);
});
