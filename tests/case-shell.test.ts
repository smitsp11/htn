import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaseView } from "../components/case/case-view";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget } from "./fixtures/domain/submissions";

test("case view renders identity, lane badge, score, and tabs", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(
    createElement(CaseView, { submission, onBack: () => {} }),
  );
  assert.match(html, /Back to queue/);
  assert.match(html, new RegExp(submission.accountName));
  assert.match(html, /Review . next steps|Review/);
  assert.match(html, /Account context/);
  // Property exposure now lives in the Review tab's appetite breakdown, not a
  // separate (redundant) tab.
  assert.doesNotMatch(html, /Property details/);
});
