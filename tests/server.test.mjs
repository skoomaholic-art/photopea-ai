import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../scripts/dev-server.mjs";

const input = {
  provider: "grok",
  prompt: "Точный тестовый текст",
  inputImage: "data:image/png;base64,iVBORw0KGgo=",
  n: 3,
};
async function serve(
  t,
  env = {},
  fetchImpl = () => {
    throw new Error("Unexpected external request");
  },
) {
  const server = createAppServer({ env, fetchImpl });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const base = "http://127.0.0.1:" + server.address().port;
  return (path, options = {}) => fetch(base + path, options);
}
const post = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
test("config/health disclose booleans, not secrets, and do not contact providers", async (t) => {
  const get = await serve(t, { XAI_API_KEY: "test-secret-do-not-expose" });
  for (const path of ["/api/config", "/api/health"]) {
    const r = await get(path);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.xaiConfigured, true);
    assert.equal(data.aiEnabled, false);
    assert.equal(data.upstreamChecked, false);
    assert.ok(!JSON.stringify(data).includes("test-secret"));
  }
});
test("server cannot serve env, Git data, server source, or traversal", async (t) => {
  const get = await serve(t);
  for (const path of [
    "/.env",
    "/.env.example",
    "/.git/config",
    "/scripts/dev-server.mjs",
    "/assets/../scripts/dev-server.mjs",
    "/assets/%2e%2e/%2e%2e/.env",
  ])
    assert.equal((await get(path)).status, 404, path);
  assert.equal((await get("/index.html")).status, 200);
  assert.equal((await get("/api/unknown")).status, 404);
});
test("API reports missing keys, disabled billing, wrong model and malformed requests", async (t) => {
  let get = await serve(t);
  assert.equal((await get("/api/ai/generate", post(input))).status, 503);
  assert.equal((await get("/api/posters?query=Title")).status, 503);
  get = await serve(t, { XAI_API_KEY: "fake" });
  assert.equal((await get("/api/ai/generate", post(input))).status, 403);
  get = await serve(t, {
    XAI_API_KEY: "fake",
    AI_REQUESTS_ENABLED: "true",
    XAI_IMAGE_MODEL: "unknown",
  });
  assert.equal((await get("/api/ai/generate", post(input))).status, 400);
  assert.equal(
    (await get("/api/ai/generate", post({ ...input, provider: "unknown" })))
      .status,
    400,
  );
  assert.equal(
    (
      await get(
        "/api/ai/generate",
        post({ ...input, inputImage: "https://private.invalid" }),
      )
    ).status,
    400,
  );
});
test("upstream 401/403/404/429/500 are normalized without leaking details", async (t) => {
  for (const [status, expected] of [
    [401, 401],
    [403, 403],
    [404, 404],
    [429, 429],
    [500, 502],
  ]) {
    const get = await serve(
      t,
      { XAI_API_KEY: "fake", AI_REQUESTS_ENABLED: "true" },
      async () =>
        new Response(
          JSON.stringify({ error: { message: "secret-upstream-value" } }),
          { status },
        ),
    );
    const r = await get("/api/ai/generate", post(input));
    assert.equal(r.status, expected);
    assert.ok(!(await r.text()).includes("secret-upstream-value"));
  }
});
test("credits and timeout have explicit recoverable responses", async (t) => {
  for (const message of [
    "Account doesn't have enough credits",
    "Account doesn't have enough balance",
    "Not enough credits",
    "Quota exceeded",
  ]) {
    const get = await serve(
      t,
      { XAI_API_KEY: "fake", AI_REQUESTS_ENABLED: "true" },
      async () =>
        new Response(JSON.stringify({ error: { message } }), { status: 429 }),
    );
    const r = await get("/api/ai/generate", post(input));
    assert.equal(r.status, 402);
    assert.match((await r.json()).message, /закончились доступные кредиты/);
  }
  const get = await serve(
    t,
    { XAI_API_KEY: "fake", AI_REQUESTS_ENABLED: "true", API_TIMEOUT_MS: "10" },
    async (_u, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
  );
  assert.equal((await get("/api/ai/generate", post(input))).status, 504);
});
test("Grok/GPT adapters send reference images through official edit APIs using only fake fetch", async (t) => {
  for (const provider of ["grok", "gpt"]) {
    let calls = 0;
    const get = await serve(
      t,
      {
        XAI_API_KEY: "fake",
        OPENAI_API_KEY: "fake",
        AI_REQUESTS_ENABLED: "true",
      },
      async (url, options) => {
        calls++;
        assert.ok(String(url).endsWith("/v1/images/edits"));
        assert.equal(options.method, "POST");
        if (provider === "grok") {
          const b = JSON.parse(options.body);
          assert.equal(b.image.url, input.inputImage);
          assert.equal(b.n, 3);
        } else {
          assert.ok(options.body.get("image") instanceof Blob);
          assert.equal(options.body.get("background"), "transparent");
          assert.equal(options.body.has("input_fidelity"), false);
        }
        return new Response(
          JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
        );
      },
    );
    const r = await get("/api/ai/generate", post({ ...input, provider }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).images.length, 1);
    assert.equal(calls, 1);
  }
});
test("TMDB title/year lookup handles missing images and uses original-quality image proxy", async (t) => {
  const seen = [];
  const get = await serve(t, { TMDB_READ_ACCESS_TOKEN: "fake" }, async (u) => {
    u = new URL(u);
    seen.push(u);
    return new Response(
      JSON.stringify({
        results: [
          {
            id: 1,
            title: "Фильм",
            original_title: "Film",
            poster_path: "/test.jpg",
            release_date: "2026-01-01",
          },
          { id: 2, title: "No image" },
        ],
      }),
    );
  });
  const r = await get(
    "/api/posters?query=" +
      encodeURIComponent("Фильм") +
      "&year=2026&type=movie",
  );
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.results.length, 1);
  assert.match(b.results[0].imageUrl, /size=original/);
  assert.equal(seen[0].searchParams.get("query"), "Фильм");
  assert.equal(seen[0].searchParams.get("primary_release_year"), "2026");
  assert.equal(
    (
      await get(
        "/api/tmdb-image?path=" + encodeURIComponent("https://private.invalid"),
      )
    ).status,
    400,
  );
});
test("cross-origin requests rejected and password gate is enforced", async (t) => {
  let get = await serve(t);
  assert.equal(
    (await get("/api/config", { headers: { Origin: "https://evil.invalid" } }))
      .status,
    403,
  );
  get = await serve(t, { APP_ACCESS_PASSWORD: "test-only" });
  assert.equal((await get("/api/config")).status, 401);
  assert.equal(
    (
      await get("/api/config", {
        headers: {
          Authorization:
            "Basic " + Buffer.from("user:test-only").toString("base64"),
        },
      })
    ).status,
    200,
  );
});
test("TMDB official image variants retain resolution and reject invalid title IDs", async (t) => {
  const get = await serve(t, { TMDB_READ_ACCESS_TOKEN: "fake" }, async (u) => {
    assert.equal(new URL(u).pathname, "/3/movie/42/images");
    return new Response(
      JSON.stringify({
        posters: [
          { file_path: "/small.jpg", width: 500, height: 750, iso_639_1: "ru" },
          {
            file_path: "/large.jpg",
            width: 2000,
            height: 3000,
            iso_639_1: "en",
          },
          { file_path: "/small.jpg", width: 500, height: 750 },
        ],
      }),
    );
  });
  const r = await get("/api/posters/images?type=movie&id=42");
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.results.length, 2);
  assert.equal(data.results[0].quality, "2000 × 3000");
  assert.equal(data.results[1].language, "ru");
  assert.equal(
    (await get("/api/posters/images?type=invalid&id=42")).status,
    400,
  );
});
