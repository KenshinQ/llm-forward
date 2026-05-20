Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1. 提供一个基础的健康检查页面
  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response("Deno Universal AI Forwarder is active.", { status: 200 });
  }

  let targetUrl = url.toString();

  // 验证提取出来的 URL 是否合法
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    console.log("received url:", targetUrl);
    return new Response(
      JSON.stringify({ error: { message: "Deno 转发器无法解析上游大模型 URL。正确格式：域名https://target.com" } }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const originHost = req.headers.get("x-origin-host") || "";
  // 2. 【核心隐私清洗】：严格过滤 Headers，彻底隐藏 9Router 真实的客户端源 IP
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

  cleanHeaders.set("host", originHost);
  const originURL = new URL(req.url);
  originURL.host = originHost;
  originURL.hostname = originHost;
  const originUrl = originURL.toString();

  // 5. 原样绑定包体，透传给上游
  const body = req.method === "GET" || req.method === "HEAD" ? null : req.body;

  // 6. 执行边缘跨域转发（请求在目标大模型看来，完全来自 Deno 节点 IP）
  try {
    console.log(`[Deno 纯净转发] 正在代发请求 ➔ ${originUrl}`);
    const upstreamResponse = await fetch(originUrl, {
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
