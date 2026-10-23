const { Client, CheckoutAPI, hmacValidator } = require('@adyen/api-library');

const config = {
  apiKey: process.env.ADYEN_API_KEY,
  merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
  clientKey: process.env.ADYEN_CLIENT_KEY,
  hmacKey: process.env.ADYEN_HMAC_KEY,
  environment: (process.env.ADYEN_ENVIRONMENT || 'TEST').toUpperCase(),
  livePrefix: process.env.ADYEN_LIVE_PREFIX,
  // Classic (PAL) endpoint the forward API calls to store the member token.
  forwardBaseUrl: process.env.ADYEN_FORWARD_BASE_URL || 'https://pal-test.adyen.com',
  // Checkout endpoint the forward API calls for the $0 auth on a member token.
  checkoutForwardBaseUrl: process.env.ADYEN_CHECKOUT_FORWARD_BASE_URL || 'https://checkout-test.adyen.com',
};

const missing = ['apiKey', 'merchantAccount', 'clientKey'].filter((key) => !config[key]);
if (missing.length) {
  console.warn(`[adyen] Missing config: ${missing.join(', ')}. Check your .env file.`);
}

const client = new Client({
  apiKey: config.apiKey,
  environment: config.environment,
  ...(config.environment === 'LIVE' && { liveEndpointUrlPrefix: config.livePrefix }),
});
const checkout = new CheckoutAPI(client);
const validator = new hmacValidator();

// ---------- debug logging ----------

const LOG_CALLS = process.env.ADYEN_DEBUG !== 'false';
const SECRET_KEYS = new Set(['credentials', 'X-Api-Key', 'x-api-key']);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      SECRET_KEYS.has(key) && typeof v === 'string' && !v.startsWith('{{') ? `***${v.slice(-4)}` : redact(v),
    ]),
  );
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function logBlock(label, payload) {
  console.log(`[adyen] ${label}\n${JSON.stringify(redact(payload), null, 2)}`);
}

// Logs the request, then the response (or Adyen's error body) for one API call.
async function logged(name, request, call) {
  if (!LOG_CALLS) return call();
  const started = Date.now();
  logBlock(`→ ${name} request`, request);
  try {
    const response = await call();
    logBlock(`← ${name} response (${Date.now() - started}ms)`, response);
    return response;
  } catch (err) {
    logBlock(`✕ ${name} failed (${Date.now() - started}ms)`, {
      statusCode: err.statusCode,
      errorCode: err.errorCode,
      message: err.message,
      responseBody: err.responseBody ? parseJson(err.responseBody) : undefined,
    });
    throw err;
  }
}

// ---------- API calls ----------

function createSession(request) {
  const body = { merchantAccount: config.merchantAccount, ...request };
  return logged('POST /sessions', body, () => checkout.PaymentsApi.sessions(body));
}

function getSessionResult(sessionId, sessionResult) {
  return logged(`GET /sessions/${sessionId}`, { sessionId, sessionResult }, () =>
    checkout.PaymentsApi.getResultOfPaymentSession(sessionId, sessionResult));
}

function listPaymentMethods() {
  const body = { merchantAccount: config.merchantAccount };
  return logged('POST /paymentMethods', body, () => checkout.PaymentsApi.paymentMethods(body));
}

function listStoredPaymentMethods(shopperReference) {
  return logged('GET /storedPaymentMethods', { shopperReference, merchantAccount: config.merchantAccount }, () =>
    checkout.RecurringApi.getTokensForStoredPaymentDetails(shopperReference, config.merchantAccount));
}

function deleteStoredPaymentMethod(storedPaymentMethodId, shopperReference) {
  const request = { storedPaymentMethodId, shopperReference, merchantAccount: config.merchantAccount };
  return logged(`DELETE /storedPaymentMethods/${storedPaymentMethodId}`, request, () =>
    checkout.RecurringApi.deleteTokenForStoredPaymentDetails(storedPaymentMethodId, shopperReference, config.merchantAccount));
}

function submitRedirectDetails(redirectResult) {
  const body = { details: { redirectResult } };
  return logged('POST /payments/details', body, () => checkout.PaymentsApi.paymentsDetails(body));
}

// Uses /forward to replay the stored card (tokenised under `shopperReference`)
// into the classic Recurring storeToken call, creating a regular Adyen token
// owned by the member. The {{...}} placeholders are filled in by Adyen.
function forwardCardToMember({ shopperReference, storedPaymentMethodId, memberId }) {
  const storeTokenBody = {
    card: {
      expiryMonth: '{{expiryMonth}}',
      expiryYear: '{{expiryYear}}',
      holderName: '{{holderName}}',
      number: '{{number}}',
    },
    merchantAccount: config.merchantAccount,
    recurring: { contract: 'ONECLICK' },
    shopperReference: memberId,
  };

  const body = {
    merchantAccount: config.merchantAccount,
    shopperReference,
    storedPaymentMethodId,
    baseUrl: config.forwardBaseUrl,
    request: {
      httpMethod: 'POST',
      urlSuffix: 'pal/servlet/Recurring/v30/storeToken',
      credentials: config.apiKey,
      headers: {
        'X-Api-Key': '{{credentials}}',
        'Content-Type': 'application/json;charset=utf-8',
      },
      body: JSON.stringify(storeTokenBody),
    },
  };

  return logged('POST /forward (storeToken)', body, () => checkout.RecurringApi.forward(body));
}

// Uses /forward to run a $0 authorisation on a member's stored card through
// /payments, so Adyen returns an OPI trans token for that card. The reference
// is "forward-<reservation id>" so its webhook can be matched back.
function forwardZeroAuthForOpiToken({ shopperReference, storedPaymentMethodId, reference, currency, returnUrl }) {
  const paymentBody = {
    amount: { value: 0, currency },
    paymentMethod: {
      type: 'scheme',
      number: '{{number}}',
      expiryMonth: '{{expiryMonth}}',
      expiryYear: '{{expiryYear}}',
    },
    shopperInteraction: 'ContAuth',
    channel: 'web',
    reference,
    merchantAccount: config.merchantAccount,
    returnUrl,
    shopperReference: 'not_provided',
    storePaymentMethod: true,
    recurringProcessingModel: 'CardOnFile',
    additionalData: { 'opi.includeTransToken': true },
  };

  const body = {
    merchantAccount: config.merchantAccount,
    shopperReference,
    storedPaymentMethodId,
    baseUrl: config.checkoutForwardBaseUrl,
    request: {
      httpMethod: 'POST',
      urlSuffix: '/checkout/v71/payments',
      credentials: config.apiKey,
      headers: {
        'X-Api-Key': '{{credentials}}',
        'Content-Type': 'application/json;charset=utf-8',
      },
      body: JSON.stringify(paymentBody),
    },
  };

  return logged('POST /forward ($0 auth /payments)', body, () => checkout.RecurringApi.forward(body));
}

function isValidWebhookItem(item) {
  if (!config.hmacKey) return true;
  try {
    return validator.validateHMAC(item, config.hmacKey);
  } catch {
    return false;
  }
}

module.exports = {
  config,
  createSession,
  getSessionResult,
  listPaymentMethods,
  listStoredPaymentMethods,
  deleteStoredPaymentMethod,
  submitRedirectDetails,
  forwardCardToMember,
  forwardZeroAuthForOpiToken,
  isValidWebhookItem,
};
