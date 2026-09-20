import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextSignals } from "../components/context-signals/context-signals";

test("renders each signal with a source link and 'not part of appetite' note", () => {
  const html = renderToStaticMarkup(
    createElement(ContextSignals, {
      signals: [
        {
          source: "Census ACS",
          label: "Median income",
          value: "$68,400",
          url: "https://data.census.gov/x",
          asOf: "2026-09-19",
        },
      ],
    }),
  );
  assert.match(html, /Median income/);
  assert.match(html, /\$68,400/);
  assert.match(html, /href="https:\/\/data\.census\.gov/);
  assert.match(html, /not part of the (carrier )?appetite/i);
});

test("renders nothing when there are no signals", () => {
  const html = renderToStaticMarkup(createElement(ContextSignals, { signals: [] }));
  assert.equal(html, "");
});
