import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Refund Policy — Cook My Cv",
  description: "Refund Policy and criteria for Cook My Cv plans purchased via Polar.sh and local methods.",
};

export default function RefundPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 text-zinc-300 space-y-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold text-white">Refund Policy</h1>
      <p className="text-xs text-zinc-400">
        Last Updated: November 20, 2026. Effective Date: November 20, 2026.
      </p>

      <p>
        At Cook My Cv (https://coov.space), digital products and subscriptions are delivered immediately upon confirmation. Please read this Refund Policy carefully before making a purchase.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">1. Strict Defect-Only Refund Policy</h2>
      <p>
        Refunds are issued strictly and exclusively in the event of a verified technical defect or failure to deliver the features explicitly promised in our service description.
      </p>
      <p>
        We do not provide refunds for change of mind, personal disinterest, lack of use, or subjective dissatisfaction with career evaluations. You are eligible for a refund only if:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          A verified technical system defect prevented you from accessing the service or generating evaluations.
        </li>
        <li>
          The platform failed to provide features and deliverables explicitly described and promised on our website.
        </li>
        <li>
          You were charged incorrectly or duplicate billing occurred due to a technical error.
        </li>
      </ul>
      <p>
        Refunds will not be granted if you simply decide you no longer want the subscription or if an external employer does not advance your job application.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">2. Merchant of Record (International USD Payments)</h2>
      <p>
        All international USD subscription orders are processed by our Merchant of Record, Polar.sh (Polar Software Inc.). Polar handles transaction processing, sales tax, VAT, and customer billing support. If your refund request meets the strict defect-only criteria above within 14 calendar days of payment, the refund will be credited back to your original payment method (Credit Card, Apple Pay, Google Pay) through Polar.sh.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">3. Local Payments (ETB / Telebirr / CBE)</h2>
      <p>
        For orders completed in Ethiopian Birr (ETB) via Telebirr or Commercial Bank of Ethiopia (CBE), refund requests for verified system failures must be submitted within 7 calendar days of transaction. Please provide your transaction reference SMS and registered email.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">4. How to Submit a Refund Request</h2>
      <p>
        To submit a refund request based on a defect or nondelivery of promised features:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          Send an email to israelashenafi29@gmail.com with the subject line &quot;Refund Request - [Your Account Email]&quot;.
        </li>
        <li>
          Include your receipt number or transaction reference from Polar.sh or your bank.
        </li>
        <li>
          Describe the technical defect or the specific promised feature that failed to function as described.
        </li>
        <li>
          You can also reach out directly via Telegram: @israelashenafi.
        </li>
      </ul>
      <p>
        Our team reviews requests within 24 to 48 hours. Approved refunds are returned to the original payment source within 3 to 7 business days depending on your financial institution.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">5. Cancellations</h2>
      <p>
        You can cancel your subscription at any time through your Profile or Billing settings. After cancellation, you retain full access to all features until the end of your prepaid billing period. No future renewals will occur.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">6. Related Policies</h2>
      <p>
        Please also consult our{" "}
        <Link href="/terms" className="text-blue-400 underline">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-blue-400 underline">
          Privacy Policy
        </Link>
        .
      </p>

      <h2 className="text-lg font-bold text-white pt-2">7. Contact Information</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>Website: https://coov.space</li>
        <li>Email: israelashenafi29@gmail.com</li>
        <li>Telegram: @israelashenafi</li>
      </ul>
    </div>
  );
}
