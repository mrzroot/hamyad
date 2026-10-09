import type { McpServer, RpcResponse } from "./server.js";

/** Newline-delimited JSON-RPC over stdin/stdout (MCP stdio transport). */
export function runStdio(server: McpServer, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  return new Promise((resolve) => {
    let buf = "";
    let chain = Promise.resolve();
    const send = (r: RpcResponse | RpcResponse[] | undefined) => {
      if (r === undefined || (Array.isArray(r) && !r.length)) return;
      output.write(JSON.stringify(r) + "\n");
    };
    const onLine = (line: string) => {
      line = line.trim();
      if (!line) return;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }
      chain = chain.then(async () => {
        if (Array.isArray(msg)) {
          const res = (await Promise.all(msg.map((m) => server.handle(m)))).filter(Boolean) as RpcResponse[];
          send(res);
        } else if (msg && "method" in msg) send(await server.handle(msg));
        // responses from the client (no method) are ignored: we never send requests
      });
    };
    input.setEncoding?.("utf8");
    input.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    input.on("end", () => {
      if (buf.trim()) onLine(buf);
      chain.then(() => resolve());
    });
  });
}
