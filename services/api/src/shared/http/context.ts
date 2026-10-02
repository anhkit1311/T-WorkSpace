import type { IncomingMessage, ServerResponse } from "node:http";
import type { initSocketServer } from "../../infrastructure/realtime/socket.js";
export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  io: ReturnType<typeof initSocketServer>;
  pathname: string;
  params: URLSearchParams;
}
