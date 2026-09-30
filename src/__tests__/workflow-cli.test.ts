import { describe, it, expect } from "vitest";
import { parseWorkflowList, workflowRunArgs, runIcodeCli } from "../workflow/cli";
const source = { id: "demo", source: "project" as const, title: "示例", path: "/tmp/demo.py" };
describe("workflow CLI contract", () => {
  it("validates discovered sources and rejects malformed or option-like ids", () => {
    expect(parseWorkflowList(JSON.stringify({ workflows: [source] }))).toEqual([source]);
    expect(() => parseWorkflowList('{"workflows":[null]}')).toThrow();
    expect(() => parseWorkflowList(JSON.stringify({ workflows: [{ ...source, id: "--help" }] }))).toThrow();
    expect(() => parseWorkflowList('{}')).toThrow();
  });
  it("preserves literal input including leading dashes, shell syntax and Chinese", () => {
    const input = '--trust\n你好 `echo leak` $(touch /tmp/never)';
    expect(workflowRunArgs(source, input, 12)).toEqual(["workflow", "run", "demo", `--input=${input}`, "--timeout", "12", "--json", "--trust"]);
    expect(workflowRunArgs({ ...source, source: "builtin" }, "", 1)).not.toContain("--trust");
    expect(() => workflowRunArgs(source, "", NaN)).toThrow();
  });
  it("captures Unicode and failure output without shell interpolation", async () => {
    const result = await runIcodeCli(process.execPath, ["-e", "process.stdout.write('你好');process.stderr.write('failure');process.exitCode=1"], process.cwd(), new AbortController().signal, 5000);
    expect(result).toEqual({ stdout: "你好", stderr: "failure", code: 1, cancelled: false });
  });
  it("cancels a running child", async () => {
    const controller = new AbortController();
    const promise = runIcodeCli(process.execPath, ["-e", "setInterval(()=>{},1000)"], process.cwd(), controller.signal, 5000);
    setTimeout(() => controller.abort(), 100);
    expect((await promise).cancelled).toBe(true);
  });
  it("enforces timeout and handles spawn failure", async () => {
    await expect(runIcodeCli(process.execPath, ["-e", "setInterval(()=>{},1000)"], process.cwd(), new AbortController().signal, 50)).rejects.toThrow("timed out");
    await expect(runIcodeCli("/nonexistent/icode", [], process.cwd(), new AbortController().signal, 500)).rejects.toThrow();
  });
  it("does not spawn after cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await runIcodeCli("/nonexistent/icode", [], process.cwd(), controller.signal, 500)).cancelled).toBe(true);
  });
});
