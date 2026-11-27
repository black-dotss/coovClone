import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Cook My Cv",
  description: "Terms of Service and Customer Agreement for Cook My Cv.",
};

export default function TermsOfServicePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 text-zinc-300 space-y-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
      <p className="text-xs text-zinc-400">
        Last Updated: November 20, 2026. Effective Date: November 20, 2026.
      </p>

      <p>
        Welcome to Cook My Cv (accessible at https://coov.space). By accessing or using our website and services, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you must not use our services.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">1. Merchant of Record</h2>
      <p>
        Our order process and international payment processing for digital goods is conducted by our online Merchant of Record, Polar.sh (Polar Software Inc.). Polar provides customer service inquiries and handles all international card transactions, value-added taxes (VAT), invoicing, and compliance for transactions conducted in USD.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">2. Description of Services</h2>
      <p>
        Cook My Cv provides automated candidate career assessment tools, multi-agent hiring committee simulations, applicant tracking system (ATS) scans, role comparisons, truthful resume bullet revisions, and interview preparation simulations.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">3. One Account Per Device Policy</h2>
      <p>
        Each user is permitted only one account per physical device. Creating multiple accounts on a single device to bypass trial limits, abuse promotional allowances, or circumvent quotas is strictly prohibited. Accounts identified in violation of this policy are subject to immediate suspension.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">4. User Accounts and Content Ownership</h2>
      <p>
        You retain full ownership of all CV documents, resumes, job descriptions, and materials you upload to Cook My Cv. By submitting documents, you grant Cook My Cv a non-exclusive license solely to process and analyze your documents and generate your requested reports. We do not sell your personal data or use your private resumes to train public artificial intelligence models.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">5. Subscriptions and Payments</h2>
      <p>
        Cook My Cv provides free trial access as well as paid monthly and yearly subscription plans.
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          International orders (USD): Processed securely through Polar.sh via Credit Card, Apple Pay, or Google Pay. Subscriptions renew automatically unless cancelled before the renewal date.
        </li>
        <li>
          Local Ethiopian orders (ETB): Processed via manual or automated digital transfer verification (Telebirr or Commercial Bank of Ethiopia) through Verify.ET.
        </li>
      </ul>

      <h2 className="text-lg font-bold text-white pt-2">6. Refund Policy</h2>
      <p>
        Refunds are governed strictly by our Refund Policy. Refunds are issued exclusively in the event of verified technical defects or failure to deliver features explicitly promised on our website description, not for personal preference or change of mind. For full details, please read our{" "}
        <Link href="/refund" className="text-blue-400 underline">
          Refund Policy
        </Link>
        .
      </p>

      <h2 className="text-lg font-bold text-white pt-2">7. Prohibited Activities</h2>
      <p>
        You agree not to misuse Cook My Cv services. Prohibited actions include:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Attempting to disrupt or compromise system security or availability.</li>
        <li>Creating multiple accounts per device to claim excess trial evaluations.</li>
        <li>Reverse engineering prompt architectures, models, or backend infrastructure.</li>
        <li>Uploading malicious software, viruses, or illegal materials.</li>
      </ul>

      <h2 className="text-lg font-bold text-white pt-2">8. Disclaimer of Warranties and Limitation of Liability</h2>
      <p>
        Cook My Cv provides evaluation simulations for educational and career preparation purposes only. We do not guarantee interview callbacks, job offers, or hiring outcomes from any employer. The service is provided on an &quot;as is&quot; and &quot;as available&quot; basis without warranties of any kind. To the fullest extent permitted by law, Cook My Cv shall not be liable for any indirect, incidental, or consequential damages.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">9. Privacy</h2>
      <p>
        Your use of our services is also subject to our{" "}
        <Link href="/privacy" className="text-blue-400 underline">
          Privacy Policy
        </Link>
        , which describes how we collect, handle, and protect your information.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">10. Contact Information</h2>
      <p>
        If you have questions regarding these Terms of Service, please contact us:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Website: https://coov.space</li>
        <li>Email: israelashenafi29@gmail.com</li>
        <li>Telegram: @israelashenafi</li>
      </ul>
    </div>
  );
}
