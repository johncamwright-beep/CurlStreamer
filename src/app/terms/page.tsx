import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service | CurlStreamer",
  description:
    "Terms for using CurlStreamer team, scoring, coaching and broadcast features.",
  alternates: { canonical: "https://www.curlstreamer.app/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <section>
        <h2>The service</h2>
        <p>
          CurlStreamer is operated by John Wright. These terms cover its
          website, Windows Studio and connected team features. Contact{" "}
          <a href="mailto:hello@curlstreamer.app">hello@curlstreamer.app</a> for
          help. Use of the service is subject to these terms and our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </section>
      <section>
        <h2>Accounts and team authority</h2>
        <p>
          Provide accurate account information and protect your sign-in and
          device access. Only connect a YouTube channel, invite a member,
          publish team information, change a score or send a report when you
          have permission to do so. Team owners and administrators manage access
          to their team; invitations and camera/scorer links should be shared
          only with intended participants.
        </p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>
          You retain your rights in the logos, photos, team information and
          other content you provide. You allow CurlStreamer and its service
          providers to store, process and display that content as needed to
          deliver the features you use. You are responsible for obtaining the
          rights and permissions needed to publish or broadcast it, including
          permissions for people appearing in images or recordings. Do not
          submit unlawful content or use the service to harass others, bypass
          access controls or interfere with its operation.
        </p>
      </section>
      <section>
        <h2>YouTube and other services</h2>
        <p>
          CurlStreamer uses YouTube API Services. By using its YouTube features,
          you agree to the{" "}
          <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>
          . Google/YouTube services also operate under their own{" "}
          <a href="https://policies.google.com/privacy">Privacy Policy</a>.
          CurlStreamer is independent of Google and YouTube.
        </p>
        <p>
          You choose the connected channel and broadcast visibility. Connecting
          a channel grants the access described on Google&apos;s consent screen;
          it does not start a broadcast by itself. Disconnect through YouTube
          Settings or revoke permission in your Google account. A disconnection
          does not remove recordings from YouTube. Other linked services and
          equipment remain subject to their own terms and capabilities.
        </p>
      </section>
      <section>
        <h2>Availability and reports</h2>
        <p>
          CurlStreamer is under active development. Features may change, and a
          successful broadcast depends on cameras, your computer, network access
          and third-party services. Keep a separate record when a score or
          recording is critical. Coaching reports, including AI-generated
          commentary when enabled, are aids for review; check them against the
          actual game records before relying on or sharing them.
        </p>
      </section>
      <section>
        <h2>Paid features</h2>
        <p>
          Any paid plan or add-on will show its price, billing terms and
          applicable cancellation/refund information before purchase. These
          terms do not create a charge or subscription. Contact support about
          existing purchases or access issues.
        </p>
      </section>
      <section>
        <h2>Stopping use and changes</h2>
        <p>
          You may stop using the service and request account or personal-data
          deletion as described in the Privacy Policy. We may restrict access
          needed to address misuse, security incidents or legal requirements.
          Material changes to these terms will be identified with an updated
          revision date and communicated where appropriate. Questions can be
          sent to{" "}
          <a href="mailto:hello@curlstreamer.app">hello@curlstreamer.app</a>.
        </p>
      </section>
    </LegalPage>
  );
}
