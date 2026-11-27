import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Cook My Cv",
  description: "Privacy Policy and data governance standards for Cook My Cv.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 text-zinc-300 space-y-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
      <p className="text-xs text-zinc-400">
        Last Updated: November 20, 2026. Effective Date: November 20, 2026.
      </p>

      <p>
        Cook My Cv (https://coov.space) is committed to protecting your privacy and confidential career documents. This Privacy Policy explains what personal information we collect, how it is handled, and your rights regarding your data.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">1. Information We Collect</h2>
      <p>We collect only the information necessary to provide our evaluation services:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          Account Information: Your email address, display name, and authentication credentials provided during registration or login.
        </li>
        <li>
          Uploaded Documents: Resumes, CVs (PDF, DOCX, or text), and target job descriptions uploaded for assessment.
        </li>
        <li>
          Evaluation History: Generated reports, persona discussion transcripts, ATS scoring rubrics, and bullet revision suggestions.
        </li>
        <li>
          Device and Security Signals: Cryptographic device tokens, browser fingerprints, and IP addresses used strictly to enforce our one-device-one-account policy and prevent trial abuse.
        </li>
        <li>
          Payment Records: For USD payments, card numbers and billing details are collected directly by Polar.sh (Merchant of Record). We do not store credit card numbers on our servers. For ETB payments, transaction references and sender receipts are processed through Verify.ET.
        </li>
      </ul>

      <h2 className="text-lg font-bold text-white pt-2">2. How We Use Your Information</h2>
      <p>Your information is used solely for the following purposes:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Generating multi-agent committee evaluations, ATS keyword scans, and mock interview questions.</li>
        <li>Delivering your evaluation reports and downloadable PDF exports.</li>
        <li>Enforcing device restrictions, quota management, and account integrity.</li>
        <li>Responding to your customer support and refund requests.</li>
      </ul>

      <h2 className="text-lg font-bold text-white pt-2">3. No Training on Your Private Documents</h2>
      <p>
        We do not sell, rent, or trade your personal data. We do not use your private resumes, CVs, or interview transcripts to train publicly available AI foundation models. All third-party inference processors (such as Google Gemini) operate under strict enterprise confidentiality agreements.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">4. Data Deletion and Retention</h2>
      <p>
        You have the right to request deletion of your uploaded documents and account at any time. When you remove a document or delete your account, your data is permanently expunged from our operational databases.
      </p>

      <h2 className="text-lg font-bold text-white pt-2">5. Cookies and Local Storage</h2>
      <p>
        We use essential cookies and browser local storage strictly required for user authentication, maintaining your active session, preserving device registration security, and saving UI preferences (such as theme selection).
      </p>

      <h2 className="text-lg font-bold text-white pt-2">6. Related Policies</h2>
      <p>
        Please review our{" "}
        <Link href="/terms" className="text-blue-400 underline">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/refund" className="text-blue-400 underline">
          Refund Policy
        </Link>
        .
      </p>

      <h2 className="text-lg font-bold text-white pt-2">7. Contact Information</h2>
      <p>
        For questions or requests regarding your personal data and privacy rights, reach out to us:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Website: https://coov.space</li>
        <li>Email: israelashenafi29@gmail.com</li>
        <li>Telegram: @israelashenafi</li>
      </ul>
    </div>
  );
}
