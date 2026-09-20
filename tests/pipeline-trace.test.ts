import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PipelineTrace } from "../components/queue/pipeline-trace";
import type { QueryReasoning } from "../lib/domain/types";

test("PipelineTrace surfaces the decision-trace lines and both panels", () => {
  const html = renderToStaticMarkup(
    createElement(PipelineTrace, { trace: ["Ranked 158 submissions", "3 unresolved"] }),
  );
  assert.match(html, /Query reasoning/);
  assert.match(html, /Decision trace/);
  assert.match(html, /Ranked 158 submissions/);
});

test("PipelineTrace renders query-reasoning steps, fields, unresolved, and fallbacks", () => {
  const queryTrace: QueryReasoning = {
    rootResource: "Policy",
    queueResource: "Submission",
    plannedBy: "heuristic",
    fields: [
      {
        field: "tiv",
        label: "TIV",
        appetiteReason: "capacity",
        schemaPath: "Policy.tiv",
        reason: "name match",
        chosenBy: "heuristic",
        alternatives: [],
      },
    ],
    unresolved: [{ field: "loss", reason: "no matching field" }],
    fallbacks: ["used HQ location"],
    steps: [{ stage: "schema", title: "Discovered schema", detail: "7 resources" }],
  };
  const html = renderToStaticMarkup(createElement(PipelineTrace, { trace: [], queryTrace }));
  assert.match(html, /Discovered schema/);
  assert.match(html, /Policy\.tiv/);
  assert.match(html, /Unresolved/);
  assert.match(html, /used HQ location/);
});

test("PipelineTrace notes when no query reasoning was produced (demo mode)", () => {
  const html = renderToStaticMarkup(createElement(PipelineTrace, { trace: ["demo"] }));
  assert.match(html, /No query reasoning/);
});
