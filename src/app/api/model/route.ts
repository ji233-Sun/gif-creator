import { NextRequest, NextResponse } from "next/server";

/**
 * 图生 3D 代理路由
 * 将图片上传、任务轮询、模型文件转发等请求代理到 Tripo API，服务端持有 API Key。
 */
export async function POST(request: NextRequest) {
  const tripApiKey = process.env.TRIPO_API_KEY;

  if (!tripApiKey) {
    return NextResponse.json(
      { error: "Tripo API key is not configured" },
      { status: 503 }
    );
  }

  try {
    const formData = await request.formData();

    const upstream = await fetch("https://api.tripo3d.ai/v3/generation/image-to-model", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tripApiKey}`,
      },
      body: formData,
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to proxy Tripo request", detail: String(error) },
      { status: 502 }
    );
  }
}
