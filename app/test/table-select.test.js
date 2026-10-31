import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTables, questionWords } from "../tableSelect.js";
import { selectRelevantKnowledge } from "../knowledge.js";

const col = (...names) => names.map((name) => ({ name, type: "text" }));
function bigSchema() {
  const s = {
    "sales.salesorderheader": col("salesorderid", "customerid", "totaldue", "orderdate", "onlineorderflag", "territoryid"),
    "sales.salesorderdetail": col("salesorderid", "productid", "orderqty", "unitprice"),
    "sales.customer": col("customerid", "personid", "storeid"),
    "sales.salesterritory": col("territoryid", "name"),
    "person.person": col("businessentityid", "firstname", "lastname"),
    "production.product": col("productid", "name", "listprice", "productsubcategoryid"),
    "production.productsubcategory": col("productsubcategoryid", "productcategoryid", "name"),
    "production.productcategory": col("productcategoryid", "name"),
    "humanresources.employee": col("businessentityid", "jobtitle"),
  };
  for (let i = 0; i < 20; i++) s[`misc.filler${i}`] = col("a", "b");
  return s;
}

test("questionWords drops filler and plural endings", () => {
  assert.deepEqual(questionWords("How many orders were placed online?"), ["order", "placed", "online"]);
});

test("small schemas pass through unchanged", () => {
  const small = { orders: col("id"), items: col("id") };
  const r = selectTables("how many orders", small);
  assert.equal(r.pruned, false);
  assert.equal(r.schema, small);
});

test("big schema: picks tables by name and column words, keeps the filler out", () => {
  const r = selectTables("What is the total amount due by sales territory name?", bigSchema(), null, { pruneAbove: 20 });
  assert.equal(r.pruned, true);
  assert.ok(r.tables.includes("sales.salesorderheader"), r.tables.join());
  assert.ok(r.tables.includes("sales.salesterritory"), r.tables.join());
  assert.ok(r.tables.length <= 10);
  assert.ok(!r.tables.some((t) => t.startsWith("misc.")));
});

test("follows ...id columns to the table they point to", () => {
  const r = selectTables("Which product has the highest list price?", bigSchema(), null, { pruneAbove: 20 });
  assert.ok(r.tables.includes("production.product"));
  // product -> productsubcategoryid -> productsubcategory
  assert.ok(r.tables.includes("production.productsubcategory"), r.tables.join());
});

test("descriptions of a chosen table are kept even if the question never names it", async () => {
  const knowledge = { descriptions: { "salesorderheader.status": "1 = In process; 5 = Shipped", "employee.jobtitle": "role" }, expressions: {}, examples: [], instructions: [] };
  const without = await selectRelevantKnowledge(knowledge, "how many orders are shipped", null, null);
  assert.deepEqual(Object.keys(without.descriptions), []);
  const withTables = await selectRelevantKnowledge(knowledge, "how many orders are shipped", null, null, { relevantTables: ["sales.salesorderheader"] });
  assert.deepEqual(Object.keys(withTables.descriptions), ["salesorderheader.status"]);
});

test("off by default", () => {
  assert.equal(selectTables("total amount due", bigSchema()).pruned, false);
});

test("nothing matches: the whole schema is kept", () => {
  const r = selectTables("zzzz qqqq", bigSchema(), null, { pruneAbove: 20 });
  assert.equal(r.pruned, false);
});
