import { test, describe, before } from "node:test";
import assert from "node:assert";

describe("MultiAgentDebateServer", () => {
  let server: any;
  let transport: any;

  before(async () => {
    process.env.NODE_ENV = "test";
    const mod = await import("../index.js");
    server = new mod.MultiAgentDebateServer();

    transport = {
      onmessage: undefined,
      onclose: undefined,
      onerror: undefined,
      sentMessages: [] as any[],
      async start() {},
      async send(message: any) {
        this.sentMessages.push(message);
      },
      async close() {}
    };

    await mod.server.connect(transport);
  });

  test("should fail on invalid agentId", () => {
    const res = server.process({ round: 1, action: "register", needsMoreRounds: true });
    assert.ok(res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.error, "agentId must be a string");
  });

  test("should fail on invalid round", () => {
    const res = server.process({ agentId: "pro", round: -1, action: "register", needsMoreRounds: true });
    assert.ok(res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.error, "round must be a positive integer");
  });

  test("should fail on missing action", () => {
    const res = server.process({ agentId: "pro", round: 1, needsMoreRounds: true });
    assert.ok(res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.error, "action missing");
  });

  test("should fail on unknown action", () => {
    const res = server.process({ agentId: "pro", round: 1, action: "unknown", needsMoreRounds: true });
    assert.ok(res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.error, "unknown action: unknown");
  });

  test("should fail on missing needsMoreRounds", () => {
    const res = server.process({ agentId: "pro", round: 1, action: "register" });
    assert.ok(res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.error, "needsMoreRounds must be boolean");
  });

  test("should successfully register agents", () => {
    const res = server.process({ agentId: "pro", round: 1, action: "register", needsMoreRounds: true });
    assert.ok(!res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.deepStrictEqual(data.agents, ["pro"]);
    assert.strictEqual(data.totalArguments, 0);

    const res2 = server.process({ agentId: "con", round: 1, action: "register", needsMoreRounds: true });
    assert.ok(!res2.isError);
    const data2 = JSON.parse(res2.content[0].text);
    assert.deepStrictEqual(data2.agents, ["pro", "con"]);
    assert.strictEqual(data2.totalArguments, 0);
  });

  test("should fail to argue/rebut/judge if not registered", () => {
    const res = server.process({ agentId: "unregistered", round: 1, action: "argue", content: "arg", needsMoreRounds: true });
    assert.ok(res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.error, "agent unregistered is not registered – call action:\"register\" first");
  });

  test("should fail to argue without content", () => {
    const res = server.process({ agentId: "pro", round: 1, action: "argue", needsMoreRounds: true });
    assert.ok(res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.error, "content required for this action");
  });

  test("should successfully argue when registered", () => {
    const res = server.process({ agentId: "pro", round: 1, action: "argue", content: "Pro argument round 1", needsMoreRounds: true });
    assert.ok(!res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.totalArguments, 1);
    assert.strictEqual(data.lastAction, "argue");
    assert.strictEqual(data.verdict, null);
  });

  test("should successfully rebut", () => {
    const res = server.process({ agentId: "con", round: 1, action: "rebut", content: "Con rebuttal round 1", targetAgentId: "pro", needsMoreRounds: true });
    assert.ok(!res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.totalArguments, 2);
    assert.strictEqual(data.lastAction, "rebut");
  });

  test("should successfully judge and record verdict", () => {
    // Register judge first
    server.process({ agentId: "judge", round: 1, action: "register", needsMoreRounds: true });

    const res = server.process({
      agentId: "judge",
      round: 1,
      action: "judge",
      content: "pro\nRationale: Pro presented stronger arguments.",
      needsMoreRounds: false
    });
    assert.ok(!res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.totalArguments, 3);
    assert.strictEqual(data.lastAction, "judge");
    assert.deepStrictEqual(data.verdict, {
      for: "pro",
      rationale: "pro\nRationale: Pro presented stronger arguments.",
      round: 1
    });
    assert.strictEqual(data.needsMoreRounds, false);
  });

  test("should catch non-Error exceptions in process", () => {
    // We force validate to throw a string by overriding it temporarily
    const originalValidate = (server as any).validate;
    (server as any).validate = () => { throw "Some string error"; };
    try {
      const res = server.process({ agentId: "pro", round: 1, action: "register", needsMoreRounds: true });
      assert.ok(res.isError);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.error, "Some string error");
    } finally {
      (server as any).validate = originalValidate;
    }
  });

  test("should list tools via JSON-RPC", async () => {
    transport.sentMessages = [];
    await transport.onmessage({
      jsonrpc: "2.0",
      method: "tools/list",
      id: 100
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    assert.strictEqual(transport.sentMessages.length, 1);
    const msg = transport.sentMessages[0];
    assert.strictEqual(msg.id, 100);
    assert.ok(msg.result);
    assert.strictEqual(msg.result.tools[0].name, "multiagentdebate");
  });

  test("should call tool via JSON-RPC", async () => {
    transport.sentMessages = [];
    await transport.onmessage({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "multiagentdebate",
        arguments: {
          agentId: "pro",
          round: 2,
          action: "register",
          needsMoreRounds: true
        }
      },
      id: 101
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    assert.strictEqual(transport.sentMessages.length, 1);
    const msg = transport.sentMessages[0];
    assert.strictEqual(msg.id, 101);
    assert.ok(msg.result);
    assert.ok(!msg.error);
    const data = JSON.parse(msg.result.content[0].text);
    assert.ok(data.agents.includes("pro"));
  });

  test("should error on calling unknown tool via JSON-RPC", async () => {
    transport.sentMessages = [];
    await transport.onmessage({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "nonexistent",
        arguments: {}
      },
      id: 102
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    assert.strictEqual(transport.sentMessages.length, 1);
    const msg = transport.sentMessages[0];
    assert.strictEqual(msg.id, 102);
    assert.ok(msg.result);
    assert.ok(msg.result.isError);
    assert.strictEqual(msg.result.content[0].text, "Unknown tool: nonexistent");
  });
});
