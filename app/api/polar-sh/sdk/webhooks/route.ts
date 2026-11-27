export { POST } from "@/app/api/webhooks/polar/route";

export async function GET(): Promise<Response> {
  return Response.json({
    status: "active",
    endpoint: "/api/polar-sh/sdk/webhooks",
    provider: "Polar.sh",
    method: "POST",
    timestamp: new Date().toISOString(),
    message: "Polar.sh payment webhook listener is active and listening for POST events.",
  });
}
