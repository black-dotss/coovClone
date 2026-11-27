import { webhooks } from "@polar-sh/sdk/2026-10";

export const validateEvent = webhooks.validateEvent;
export const PolarWebhookError = webhooks.PolarWebhookError;
export const PolarWebhookVerificationError = webhooks.PolarWebhookVerificationError;
export const PolarWebhookUnknownTypeError = webhooks.PolarWebhookUnknownTypeError;

export default webhooks;
