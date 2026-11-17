import { NextRequest, NextResponse } from "next/server";

/**
 * LLM 代理路由
 * 将浏览器端的 fx Agent 请求转发到 Vercel AI Gateway，并在服务端注入密钥。
 * 浏览器网络面板中不应出现任何上游密钥。
 */
export async function POST(request: NextRequest) {
  const gatewayUrl = process.env.VERCEL_AI_GATEWAY_URL;
  const gatewayKey = process.env.VERCEL_AI_GATEWAY_KEY;

  if (!gatewayUrl || !gatewayKey) {
    return NextResponse.json(
      { error: "LLM proxy is not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();

    const upstream = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to proxy LLM request", detail: String(error) },
      { status: 502 }
    );
  }
}
