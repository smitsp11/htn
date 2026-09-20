import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountTab } from "../components/case/account-tab";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget } from "./fixtures/domain/submissions";

test("account tab renders signals and a context-only disclaimer", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(AccountTab, { submission }));
  assert.match(html, /signal/i);
  assert.match(html, /not.*scored|context only/i);
  assert.match(html, new RegExp(submission.id));
});
