import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  chatGptCookieMaxAge, chatGptCookieName, chatGptCookieOptions, chatGptLocalOrigin,
  chatGptStatus, disconnectChatGpt, startChatGpt,
} from '@/server/chatgpt-session';
import { failure, HttpError, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const startRequest = z.strictObject({ action: z.literal('start') });

function privateResponse(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return response;
}

export function GET(request: NextRequest) {
  try {
    return privateResponse(NextResponse.json(chatGptStatus(request)));
  } catch (error) { return privateResponse(failure(error)); }
}

export async function POST(request: NextRequest) {
  try {
    chatGptLocalOrigin(request);
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      throw new HttpError(415, '请发送 JSON 请求');
    }
    if (!startRequest.safeParse(await readJson(request, 256)).success) {
      throw new HttpError(400, '登录请求格式无效');
    }
    const { url, sessionId } = await startChatGpt(request);
    const response = privateResponse(NextResponse.json({ url }));
    response.cookies.set(chatGptCookieName, sessionId, { ...chatGptCookieOptions, maxAge: chatGptCookieMaxAge });
    return response;
  } catch (error) { return privateResponse(failure(error)); }
}

export function DELETE(request: NextRequest) {
  try {
    disconnectChatGpt(request);
    const response = privateResponse(new NextResponse(null, { status: 204 }));
    response.cookies.set(chatGptCookieName, '', { ...chatGptCookieOptions, maxAge: 0, expires: new Date(0) });
    return response;
  } catch (error) { return privateResponse(failure(error)); }
}
