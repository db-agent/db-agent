import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRelevantKnowledge } from "../knowledge.js";

const kb = {
  descriptions: {
    "sales_suppliers": "One row per supplier.",
    "sales_suppliers.approved": "'Y' when approved.",
    "sales_transactions.paymentMethod": "visa, mastercard or amex, lowercase.",
    "sales_customers.gender": "female or male, lowercase.",
    "sales_franchises.country": "US here, USA for customers.",
  },
  expressions: { revenue: "SUM(totalPrice)" }, examples: [], instructions: [],
};
const keys = async (question, opts) => Object.keys((await selectRelevantKnowledge(kb, question, null, null, opts)).descriptions);

test("exact (default): prefixed table names are not found from plain words", async () => {
  assert.deepEqual(await keys("How many suppliers are approved?"), []);
  assert.deepEqual(await keys("What is sales_suppliers?"), ["sales_suppliers", "sales_suppliers.approved"]);
});

test("loose: a word from the table or column name finds its notes, plurals ignored", async () => {
  process.env.KNOWLEDGE_MATCH = "loose";
  try {
    const mod = await import("../knowledge.js?loose");
    const run = async (q) => Object.keys((await mod.selectRelevantKnowledge(kb, q, null, null)).descriptions);
    assert.deepEqual(await run("How many suppliers are approved?"), ["sales_suppliers", "sales_suppliers.approved"]);
    assert.deepEqual(await run("How many transactions were paid with visa?"), ["sales_transactions.paymentMethod"]);
    assert.deepEqual(await run("What is the revenue from female customers?"), ["sales_customers.gender"]);
    assert.deepEqual(await run("Which franchise is biggest?"), ["sales_franchises.country"]);
    assert.deepEqual(await run("How is the weather?"), []);
  } finally {
    delete process.env.KNOWLEDGE_MATCH;
  }
});

test("loose: generic prefixes alone do not pull every note", async () => {
  process.env.KNOWLEDGE_MATCH = "loose";
  try {
    const mod = await import("../knowledge.js?loose2");
    assert.deepEqual(Object.keys((await mod.selectRelevantKnowledge(kb, "show me all sales", null, null)).descriptions), []);
  } finally {
    delete process.env.KNOWLEDGE_MATCH;
  }
});
