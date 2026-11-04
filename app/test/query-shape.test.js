import test from "node:test";
import assert from "node:assert/strict";
import { collapsesRows } from "../queryShape.js";

test("collapsesRows: aggregations fold rows, plain selects do not", () => {
  assert.equal(collapsesRows("SELECT product, SUM(totalPrice) FROM t GROUP BY product"), true);
  assert.equal(collapsesRows("SELECT COUNT(*) FROM t"), true);
  assert.equal(collapsesRows("SELECT DISTINCT country FROM t"), true);
  assert.equal(collapsesRows("SELECT * FROM sales_transactions"), false);
  assert.equal(collapsesRows("SELECT customerID, email FROM sales_customers WHERE country = 'USA'"), false);
  assert.equal(collapsesRows("SELECT * FROM t LIMIT 5000"), false);
});
