import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createSqlEngine, listSqlEngines } from "../sqlEngines/index.js";
import { columnNames, parseSchemaSetting, redactMssqlConnectionString, streamRequest } from "../sqlEngines/mssql.js";

// A stand-in for an mssql streaming Request: emits recordset/row/error/done the way the driver does.
// `rows` are objects for convenience; `names` overrides the raw column names (e.g. "" for unnamed).
class FakeRequest extends EventEmitter {
  constructor(rows, { error = null, names = null } = {}) {
    super();
    this.rows = rows;
    this.names = names || Object.keys(rows[0] || { id: 0 });
    this.error = error;
    this.cancelled = false;
    this.paused = false;
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.pump(); }
  cancel() { this.cancelled = true; }
  query() {
    setImmediate(() => {
      // arrayRowMode: columns as an array of metadata, rows as arrays of values.
      assert.equal(this.arrayRowMode, true);
      this.emit("recordset", this.names.map((name, index) => ({ name, index })));
      this.i = 0;
      this.pump();
    });
  }
  pump() {
    while (!this.paused && !this.cancelled && this.i < this.rows.length) this.emit("row", Object.values(this.rows[this.i++]));
    if (this.paused) return;
    if (this.cancelled) {
      const err = new Error("Canceled.");
      err.code = "ECANCEL";
      this.emit("error", err);
    } else if (this.error) {
      this.emit("error", this.error);
    }
    if (!this.finished) { this.finished = true; this.emit("done", {}); }
  }
}

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `n${i}` }));

test("mssql is registered and validates its configuration", () => {
  assert.ok(listSqlEngines().some((e) => e.name === "mssql"));
  assert.throws(() => createSqlEngine("mssql", { env: {} }), /MSSQL_URL.*MSSQL_SERVER \+ MSSQL_DATABASE/);
  assert.throws(() => createSqlEngine("mssql", { env: { MSSQL_SERVER: "h" } }), /MSSQL_DATABASE/);
});

test("mssql describe() never contains credentials", () => {
  const a = createSqlEngine("MSSQL", { env: { MSSQL_SERVER: "db.local", MSSQL_DATABASE: "sales", MSSQL_USER: "u", MSSQL_PASSWORD: "s3cret" } });
  assert.deepEqual(a.describe(), { type: "mssql", location: "mssql://db.local:1433/sales?schema=dbo" });
  assert.equal(a.config.options.encrypt, true);
  assert.equal(a.config.options.trustServerCertificate, false);
  assert.equal(a.config.connectionTimeout, 60000);
  assert.equal(createSqlEngine("mssql", { env: { MSSQL_SERVER: "h", MSSQL_DATABASE: "d", MSSQL_CONNECT_TIMEOUT_MS: "90000" } }).config.connectionTimeout, 90000);

  const b = createSqlEngine("mssql", { env: { MSSQL_URL: "Server=db.local,1433;Database=sales;User Id=u;Password=s3cret;Encrypt=true" } });
  assert.doesNotMatch(b.describe().location, /s3cret|User Id/);
  assert.equal(b.config.server, "db.local");
  assert.equal(b.config.password, "s3cret");
  assert.equal(b.config.connectionTimeout, 60000);

  const c = createSqlEngine("mssql", { env: { MSSQL_SERVER: "h", MSSQL_DATABASE: "d", MSSQL_INSTANCE: "SQLEXPRESS", MSSQL_TRUST_SERVER_CERT: "true" } });
  assert.equal(c.config.options.instanceName, "SQLEXPRESS");
  assert.equal(c.config.options.trustServerCertificate, true);
  assert.match(c.describe().location, /h\\SQLEXPRESS/);

  assert.equal(redactMssqlConnectionString("mssql://u:pw@host:1433/db"), "mssql://host:1433/db");
});

test("mssql schema setting: tables are qualified unless the schema is just dbo", () => {
  assert.deepEqual(parseSchemaSetting(undefined), { allSchemas: false, schemaNames: ["dbo"], qualify: false });
  assert.deepEqual(parseSchemaSetting("DBO"), { allSchemas: false, schemaNames: ["DBO"], qualify: false });
  assert.equal(parseSchemaSetting("Sales").qualify, true);
  assert.deepEqual(parseSchemaSetting("Sales, Production").schemaNames, ["Sales", "Production"]);
  assert.equal(parseSchemaSetting("*").allSchemas, true);
});

test("streamRequest caps rows at maxRows and treats its own cancel as success", async () => {
  const req = new FakeRequest(rows(50));
  const out = await streamRequest(req, "SELECT 1", { maxRows: 10 });
  assert.equal(req.stream, true);
  assert.equal(req.cancelled, true);
  assert.deepEqual(out.columns, ["id", "name"]);
  assert.equal(out.rows.length, 10);
  assert.deepEqual(out.rows[9], { id: 9, name: "n9" });
});

test("streamRequest returns everything under the cap and surfaces real errors", async () => {
  const out = await streamRequest(new FakeRequest(rows(3)), "SELECT 1", { maxRows: 10 });
  assert.equal(out.rows.length, 3);
  const err = Object.assign(new Error("Invalid object name 'nope'."), { code: "EREQUEST" });
  await assert.rejects(streamRequest(new FakeRequest(rows(2), { error: err }), "SELECT 1"), /Invalid object name/);
});

test("streamRequest batches for export with backpressure, header-only for zero rows", async () => {
  const batches = [];
  const req = new FakeRequest(rows(25));
  const out = await streamRequest(req, "SELECT 1", {
    batchSize: 10,
    onBatch: async (columns, batch) => {
      assert.equal(req.paused, batch.length === 10 && batches.length < 2);
      batches.push([columns, batch.length]);
    },
  });
  assert.equal(out.total, 25);
  assert.deepEqual(batches.map((b) => b[1]), [10, 10, 5]);
  assert.deepEqual(batches[0][0], ["id", "name"]);

  const empty = [];
  await streamRequest(new FakeRequest([]), "SELECT 1", { batchSize: 10, onBatch: async (c, b) => empty.push([c, b]) });
  assert.deepEqual(empty, [[["id"], []]]);
});

test("streamRequest renders binary values as hex", async () => {
  const out = await streamRequest(new FakeRequest([{ id: 1, blob: Buffer.from([0xab, 0x01]) }]), "SELECT 1");
  assert.equal(out.rows[0].blob, "0xAB01");
});

test("columnNames names unnamed columns by position and de-duplicates repeats", () => {
  assert.deepEqual(columnNames(["", "Name", "", "Name", "Name"]), ["column1", "Name", "column3", "Name_2", "Name_3"]);
  assert.deepEqual(columnNames(["column1", ""]), ["column1", "column2"]);
  assert.deepEqual(columnNames(["", "column1"]), ["column1", "column1_2"]);
});

test("streamRequest keeps every value for unnamed and duplicate columns", async () => {
  // SELECT COUNT(*), MAX(ListPrice), p.Name, c.Name ... : two unnamed, two "Name".
  const req = new FakeRequest([{ a: 847, b: 3578.27, c: "Road-150", d: "Bikes" }], { names: ["", "", "Name", "Name"] });
  const out = await streamRequest(req, "SELECT 1");
  assert.deepEqual(out.columns, ["column1", "column2", "Name", "Name_2"]);
  assert.deepEqual(out.rows, [{ column1: 847, column2: 3578.27, Name: "Road-150", Name_2: "Bikes" }]);
});
