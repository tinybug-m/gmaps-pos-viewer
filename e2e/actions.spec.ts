import { expect, test, type APIRequestContext, type Request } from "@playwright/test";
import { callCount, leadVersion, signIn, state } from "./helpers";

/*
 * Server actions are public POST endpoints. These tests capture a real
 * "log a call" request from the UI and replay it outside the UI: with no
 * cookie, with a forged cookie, as a supervisor, and against a lead the
 * caller doesn't own. A positive replay first proves the replay itself works,
 * so the rejections can't pass by accident.
 */

interface Captured {
  url: string;
  headers: Record<string, string>;
  args: [Record<string, unknown>];
}

let captured: Captured;

function replay(api: APIRequestContext, leadId: string, version: number, extraHeaders: Record<string, string> = {}) {
  const [input] = captured.args;
  return api.post(captured.url, {
    headers: { ...captured.headers, ...extraHeaders },
    data: JSON.stringify([{ ...input, leadId, version }]),
    maxRedirects: 0,
  });
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, "callerA");
  const leadId = state.leads.callerA[1];
  await page.goto(`/leads/${leadId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Voicemail/ }).click();
  const request: Promise<Request> = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const req = await request;
  await expect(page.getByText(/Call saved/)).toBeVisible();

  const h = req.headers();
  captured = {
    url: req.url(),
    // Only what Next needs to route the action; never the session cookie.
    headers: Object.fromEntries(
      ["next-action", "next-router-state-tree", "content-type", "accept"].filter((k) => h[k]).map((k) => [k, h[k]]),
    ),
    args: JSON.parse(req.postData() ?? "[]"),
  };
  expect(captured.args[0]).toMatchObject({ leadId, outcome: "voicemail" });
  await context.close();
});

test("replaying as the owner with a fresh version works (control)", async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(await context.newPage(), "callerA");
  const leadId = state.leads.callerA[1];
  const before = await callCount(leadId);
  const res = await replay(context.request, leadId, await leadVersion(leadId));
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('"ok":true');
  expect(await callCount(leadId)).toBe(before + 1);
  await context.close();
});

test("without a session cookie the request never reaches the action", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: new URL(captured.url).origin });
  const leadId = state.leads.callerA[1];
  const before = await callCount(leadId);
  const res = await replay(api, leadId, await leadVersion(leadId));
  expect(res.status()).toBe(307);
  expect(res.headers().location).toContain("/login");
  expect(await callCount(leadId)).toBe(before);
  await api.dispose();
});

test("a forged session cookie gets past the proxy but not the action", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: new URL(captured.url).origin });
  const leadId = state.leads.callerA[1];
  const before = await callCount(leadId);
  const res = await replay(api, leadId, await leadVersion(leadId), {
    cookie: "better-auth.session_token=forged-token.forged-signature",
  });
  expect(await res.text()).not.toContain('"ok":true');
  expect(res.headers()["x-action-redirect"] ?? "").toContain("/login");
  expect(await callCount(leadId)).toBe(before);
  await api.dispose();
});

test("a supervisor's session can't log calls", async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(await context.newPage(), "supervisor");
  const leadId = state.leads.callerA[1];
  const before = await callCount(leadId);
  const res = await replay(context.request, leadId, await leadVersion(leadId));
  expect(await res.text()).toContain('"ok":false');
  expect(await callCount(leadId)).toBe(before);
  await context.close();
});

test("a caller can't log a call on someone else's lead by changing the id", async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(await context.newPage(), "callerA");
  const leadId = state.leads.callerB[0];
  const before = await callCount(leadId);
  const res = await replay(context.request, leadId, await leadVersion(leadId));
  const body = await res.text();
  expect(body).toContain('"ok":false');
  expect(body).not.toContain("E2E Plumbing 4");
  expect(await callCount(leadId)).toBe(before);
  await context.close();
});
