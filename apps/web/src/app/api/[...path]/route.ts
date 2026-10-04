import { NextRequest, NextResponse } from "next/server";
import { events, links } from "@/lib/fixtures";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };
const dataMode = () => process.env.DATA_MODE ?? "fixture";
const responseHeaders = () => ({ "X-Data-Mode": dataMode(), "Cache-Control": "no-store" });

/**
 * My Feed's demo profile (FastAPI owns the local profile file). Which method may use which
 * path: GET /me, /me/feed, /interests; PUT /me/interests, /me/feedback/:id; POST
 * /me/reading-list/:id, /me/interactions; DELETE /me, /me/reading-list/:id.
 */
function profileRoute(method: string, path: string[]) {
  const [head, sub] = path;
  if (head === "interests") return method === "GET" && path.length === 1;
  if (head !== "me") return false;
  if (path.length === 1) return method === "GET" || method === "DELETE";
  if (path.length === 2) return (sub === "feed" && method === "GET") || (sub === "interests" && method === "PUT") || (sub === "interactions" && method === "POST");
  if (path.length === 3) return (sub === "feedback" && method === "PUT") || (sub === "reading-list" && (method === "POST" || method === "DELETE"));
  return false;
}

async function forward(request: NextRequest, path: string[], method: string) {
  const headers = responseHeaders();
  try {
    const base = (process.env.API_BASE_URL ?? "http://127.0.0.1:43124").replace(/\/$/, "");
    const url = `${base}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
    const body = method === "GET" || method === "DELETE" ? undefined : await request.text();
    const upstream = await fetch(url, {
      method, body, cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: body ? { "Content-Type": request.headers.get("Content-Type") ?? "application/json" } : undefined,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...headers, "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "FastAPI is unavailable. Check API_BASE_URL and start the backend." }, { status: 502, headers });
  }
}

/** Profile reads and writes only work against FastAPI; fixture mode has no profile. */
async function profile(request: NextRequest, context: Context, method: string) {
  const { path } = await context.params;
  if (!profileRoute(method, path)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (dataMode() !== "api") return NextResponse.json({ error: "My Feed needs DATA_MODE=api and FastAPI." }, { status: 503, headers: responseHeaders() });
  return forward(request, path, method);
}

export async function GET(request: NextRequest, context: Context) {
  const { path } = await context.params;
  if (profileRoute("GET", path)) return profile(request, context, "GET");
  const isFeed = path[0] === "feed" && (path.length === 1 || (path.length === 2 && path[1] === "pins"));
  const allowed = isFeed || ((path[0] === "health" || path[0] === "links") && path.length === 1) ||
    (path[0] === "events" && (path.length <= 2 || (path.length === 3 && path[2] === "links")));
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const mode = dataMode();
  const headers = responseHeaders();
  if (mode === "fixture") {
    if (isFeed) return NextResponse.json({ error: "Feed ranking requires DATA_MODE=api and FastAPI. Use fixture=1 for sample events." }, { status: 503, headers });
    if (path[0] === "health") return NextResponse.json({ status: "ok", mode, backendConnected: false }, { headers });
    if (path[0] === "links") return NextResponse.json(links, { headers });
    if (path.length === 1) return NextResponse.json({
      generatedAt: new Date().toISOString(),
      sourceStatus: { usgs: "fixture", firms: "fixture", gdelt: "fixture" },
      events, nextCursor: null,
    }, { headers });
    const event = events.find((item) => item.id === path[1]);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404, headers });
    return NextResponse.json(path.length === 2 ? event : links.filter(
      (link) => link.sourceId === event.id || link.targetId === event.id,
    ), { headers });
  }
  if (mode !== "api") return NextResponse.json({ error: "DATA_MODE must be fixture or api" }, { status: 500, headers });
  return forward(request, path, "GET");
}

export const POST = (request: NextRequest, context: Context) => profile(request, context, "POST");
export const PUT = (request: NextRequest, context: Context) => profile(request, context, "PUT");
export const DELETE = (request: NextRequest, context: Context) => profile(request, context, "DELETE");
