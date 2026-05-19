import { serve } from "https://deno.land";

serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1. 提供一个基础的健康检查页面
  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response("Deno Universal AI Forwarder is active.", { status: 200 });
  }

  // 2. 动态提取真实的 AI 提供商目标 URL
  // 我们采用路径拼接解析，如：https://deno-app.dev
  // url.pathname.slice(1) 会拿到 "https://deepseek.com"
  let targetUrl = url.pathname.slice(1);

  // 兼容性修饰：如果 9Router 发出的路径中少了一个斜杠（例如变成 https:/api...），自动补齐
  if (targetUrl.startsWith("http:/") && !targetUrl.startsWith("http://")) {
    targetUrl = targetUrl.replace("http:/", "http://");
  } else if (targetUrl.startsWith("https:/") && !targetUrl.startsWith("https://")) {
    targetUrl = targetUrl.replace("https:/", "https://");
  }

  // 加上可能存在的 Query 参数（如 ?stream=true 等）
  if (url.search) {
    targetUrl += url.search;
  }

  // 验证提取出来的 URL 是否合法
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    return new Response(
      JSON.stringify({ error: { message: "Deno 转发器无法解析上游大模型 URL。正确格式：域名/https://target.com" } }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  // 3. 【核心隐私清洗】：严格过滤 Headers，彻底隐藏 9Router 真实的客户端源 IP
  const cleanHeaders = new Headers();

  // 严格白名单机制：只复制大模型需要的鉴权、内容类型和客户端基础头
  // 坚决不复制 X-Forwarded-For、Via、Proxy-Connection 等特征头
  const allowedHeaders = [
    "authorization",
    "content-type",
    "accept",
    "accept-encoding",
    "user-agent",
    // OpenAI 专属
    "openai-organization",
    "openai-project",
    // Anthropic Claude 专属
    "x-api-key",
    "anthropic-version",
    "anthropic-beta",
    // Mistral / Azure 等其他厂商可能需要的通用头
    "api-key",
    "x-client-id"
  ];

  for (const [key, value] of req.headers.entries()) {
    if (allowedHeaders.includes(key.toLowerCase())) {
      cleanHeaders.set(key, value);
    }
  }

  // 4. 重写 Host 头：让目标大模型服务器确信请求是由 Deno 的云端服务器直接发起的直接请求
  try {
    const parsedTarget = new URL(targetUrl);
    cleanHeaders.set("host", parsedTarget.host);
  } catch (_) {
    // 忽略解析异常
  }

  // 5. 原样绑定包体，透传给上游
  const body = req.method === "GET" || req.method === "HEAD" ? null : req.body;

  // 6. 执行边缘跨域转发（请求在目标大模型看来，完全来自 Deno 节点 IP）
  try {
    console.log(`[Deno 纯净转发] 正在代发请求 ➔ ${targetUrl}`);
    const upstreamResponse = await fetch(targetUrl, {
      method: req.method,
      headers: cleanHeaders,
      body: body,
      redirect: "follow",
    });

    // 7. 将响应原样吐回给 9Router（完美支持 chunk 流与 SSE）
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: upstreamResponse.headers,
    });
  } catch (err) {
    console.error("[Deno 纯净转发] 边缘中转失败:", err);
    return new Response(
      JSON.stringify({ error: { message: "Deno Edge Forwarder Transit Failed" } }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
});
