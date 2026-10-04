import Link from "next/link";
import { Wordmark } from "@/components/brand";
import StarrySky from "@/components/starry-sky";

/** First stop for a new (demo) user: no account creation, just a way in. */
export default function Welcome() {
  return <main className="welcome" aria-labelledby="welcome-title">
    <StarrySky />
    <div className="welcome-card">
      <Wordmark size={34} className="welcome-wordmark" />
      <h1 id="welcome-title">The world&apos;s news, on one globe.</h1>
      <p className="welcome-lede">Follow what matters to you: earthquakes and elections, markets and matches. Your feed learns from what you save and read.</p>
      <Link className="welcome-cta" href="/welcome/interests">Get started</Link>
      <p className="welcome-note">Takes about 30 seconds. You can change your interests at any time.</p>
    </div>
  </main>;
}
